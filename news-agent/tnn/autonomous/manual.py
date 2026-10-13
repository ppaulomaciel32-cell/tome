"""Comandos privados do grupo. Texto gera rascunho; só prova assinada aprova."""
import json
import os
import re
import time
import uuid
from ..core import AgentError,normalize
from ..providers import Net
from .collection import digest
from .store import QuotaLimit

class Editorial:
    def __init__(self,net=None):
        self.net=net or Net();self.url=os.getenv('TNN_EDITORIAL_URL','');self.token=os.getenv('TNN_EDITORIAL_TOKEN','')
        self.configured=bool(re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co/functions/v1/tnn-editorial',self.url) and re.fullmatch(r'[a-f0-9]{64}',self.token))
    def ready(self):
        if not self.configured:return False
        try:return self.net.json(self.url+'?action=capabilities',headers={'x-editorial-token':self.token},timeout=10).get('approval') is True
        except AgentError:return False
    def decide(self,job):
        if not self.configured:raise AgentError('A aprovação editorial ainda não está configurada.')
        return self.net.json(self.url,{'action':job['kind'],'draft_id':job['draftId'],'revision':job['revision'],
            'receipt':job['receipt'],'editor_hash':job['editorHash'],'signature':job['signature']},
            {'x-editorial-token':self.token},timeout=25,max_bytes=10000)
    def live(self,result):
        # A URL retornada deve ser do jornal; redirects são bloqueados pelo Net.
        if not re.fullmatch(r'https://tomezap\.com\.br/noticia/[a-z0-9]+(?:-[a-z0-9]+)*/',result.get('url','')):return False
        try:
            html=self.net.request(result['url'],headers={'Cache-Control':'no-cache'},timeout=8,max_bytes=2000000).decode('utf-8')
            return result.get('revision')==1 and 'name="tnn-agent-revision" content="1"' in html
        except AgentError:return False

class Manual:
    def __init__(self,config,state,collector,writer,drafts,bridge,editorial,now=time.time):
        self.config=config;self.state=state;self.collector=collector;self.writer=writer;self.drafts=drafts;self.bridge=bridge;self.editorial=editorial;self.now=now
        self.prefix=state.prefix+'manual:';self.ready=False;self.checked=0
    def report(self,job,stage,state='running',code='ok'):
        try:self.bridge.call('/cycle-status',{'cycleId':job['id'],'state':state,'stage':stage,'pending':0,'code':code})
        except Exception:pass
    def cache(self,id,data):self.state.client.set(self.prefix+id,json.dumps(data,ensure_ascii=False),ex=7*86400)
    def retry(self,fn):
        for attempt in range(3):
            try:return fn()
            except AgentError as error:
                if not error.retryable or attempt==2:raise
                time.sleep(2**attempt)
    def check_deploy(self):
        if getattr(self,'last_deploy_check',0)+30>self.now():return
        self.last_deploy_check=self.now()
        for key in list(self.state.client.scan_iter(match=self.prefix+'deploy:*',count=20))[:10]:
            data=json.loads(self.state.client.get(key) or '{}');p=data.get('publication',{})
            if not p.get('deploy_requested') and data.get('hook_attempts',0)<3:
                data['hook_attempts']=data.get('hook_attempts',0)+1
                try:p=self.editorial.decide(data['job']);data['publication']=p
                except AgentError:pass
                self.state.client.set(key,json.dumps(data),ex=7*86400)
            if self.editorial.live(p):
                try:
                    self.bridge.call('/publication-status',{'id':data['job']['id'],'draftId':data['job']['draftId'],'url':p['url']})
                    self.state.client.delete(key)
                except AgentError:pass
            break  # Um probe por rodada; não atrasar toda a fila.
    def one(self):
        if not self.config.manual_enabled:return False
        self.check_deploy()
        if self.now()-self.checked>60:
            self.ready=self.editorial.ready();self.checked=self.now()
        answer=self.bridge.call('/commands/claim',{'publisherReady':self.ready})
        job=answer.get('command')
        if not job:return False
        lock=self.state.lock()
        if not lock.acquire(blocking=False):return False
        try:
            result=self.process(job)
            self.bridge.call('/commands/result',{'id':job['id'],'lease':job['lease'],**result})
        except Exception:
            # Resultados incertos ficam na fila; reexecução usa cache e IDs persistentes.
            pass
        finally:
            if lock.owned():lock.release()
        return True
    def process(self,job):
        raw=self.state.client.get(self.prefix+job['id']);memo=json.loads(raw) if raw else {}
        if memo.get('result'):return memo['result']
        result=None
        try:
            if job['kind'] in ('approve','reject'):
                if job['kind']=='approve' and not self.ready:return {'code':'awaiting_configuration'}
                if not memo.get('publication'):
                    memo['publication']=self.retry(lambda:self.editorial.decide(job));self.cache(job['id'],memo)
                p=memo['publication']
                if job['kind']=='reject':result={'code':'rejected','draftId':job['draftId']}
                else:
                    if self.editorial.live(p):result={'code':'live','draftId':job['draftId'],'url':p['url']}
                    else:
                        # Deixa uma conferência pendente, sem bloquear o trabalhador.
                        self.state.client.set(self.prefix+'deploy:'+job['draftId'],json.dumps({'publication':p,'job':job}),ex=7*86400)
                        result={'code':'publication_pending','draftId':job['draftId'],'url':p['url']}
                return result
            if not self.config.gemini_free or len({s.publisher_group for s in self.config.sources})<2:return {'code':'awaiting_configuration'}
            context=self.retry(lambda:self.drafts.call())
            if context.get('capabilities',{}).get('manual') is not True:return {'code':'awaiting_configuration'}
            if not memo.get('started'):
                begin=self.retry(lambda:self.drafts.call({'action':'manual_begin','id':job['id'],'receipt':job['receipt'],'max_pending':self.config.max_pending}))
                if not begin.get('started'):return {'code':begin.get('reason','failed')}
                memo['started']=True;self.cache(job['id'],memo)
            if not memo.get('sources'):
                self.report(job,'coleta');sources=self.collector.manual(job['text'],self.now())
                if len(sources)<2:result={'code':'weak_sources'};return result
                memo['sources']=sources
                # Deduplicação da pauta e das URLs antes de gastar geração.
                memo['seen']=[{'hash':digest(normalize(job['text'])),'tipo':'titulo','titulo':job['text'][:500]}]+[
                    {'hash':digest(s['url']),'tipo':'url','titulo':s['title']} for s in sources]
                if self.drafts.call({'action':'seen','hashes':[s['hash'] for s in memo['seen']]}).get('seen'):
                    result={'code':'already_seen'};return result
                self.cache(job['id'],memo)
            if not memo.get('draft'):
                # Se a geração ficou incerta, não gastar cota novamente após crash.
                if memo.get('generation_started'):result={'code':'failed'};return result
                if not self.state.reserve('gemini',self.config.gemini_daily):result={'code':'quota_limit'};return result
                memo['generation_started']=True;self.cache(job['id'],memo);self.report(job,'redacao')
                memo['draft']=self.writer.write(job['text'],memo['sources']);memo['draft']['id']=str(uuid.uuid4());self.cache(job['id'],memo)
            if not memo.get('saved'):
                self.report(job,'rascunho')
                saved=self.retry(lambda:self.drafts.call({'action':'save','cycle_id':job['id'],'draft':memo['draft'],'seen':memo['seen'],'max_pending':self.config.max_pending}))
                if not saved.get('saved'):result={'code':saved.get('reason','failed')};return result
                memo['saved']=saved['id'];self.cache(job['id'],memo)
            draft=memo['draft'];self.report(job,'previa')
            self.bridge.call('/preview',{'id':memo['saved'],'revision':1,'titulo':draft['titulo'],'resumo':draft['resumo'],'localidade':draft['localidade'],
                'sources':[{'name':s['name'],'url':s['url']} for s in memo['sources']]})
            result={'code':'draft_ready','draftId':memo['saved']};return result
        except QuotaLimit:result={'code':'quota_limit'};return result
        except Exception:
            # Pode ter sido uma resposta de banco incerta: manter payload permite replay seguro.
            result={'code':'failed',**({'draftId':memo['saved']} if memo.get('saved') else {})};return result
        finally:
            if result:
                memo['result']=result;self.cache(job['id'],memo)
                if job['kind']=='pauta' and memo.get('started'):
                    code={'draft_ready':'ok','failed':'internal_error'}.get(result['code'],result['code'])
                    try:self.drafts.call({'action':'finish','id':job['id'],'status':'completed' if result['code']=='draft_ready' else 'skipped','stage':'previa' if result['code']=='draft_ready' else 'coleta','code':code,'duration_ms':0})
                    except Exception:pass
                    self.report(job,'fim','completed' if result['code']=='draft_ready' else 'skipped',code)

