"""Comandos privados do grupo. Texto gera rascunho; só prova assinada aprova."""
import json
import os
import re
import time
import uuid
import base64
from pathlib import Path
from datetime import datetime,timezone
from ..core import AgentError,normalize
from ..providers import Net
from .collection import digest,accepted
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
            'receipt':job['receipt'],'editor_hash':job['editorHash'],'signature':job['signature'],
            **({'not_before':datetime.fromtimestamp(job['notBefore']/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')} if job.get('notBefore') else {})},
            {'x-editorial-token':self.token},timeout=25,max_bytes=10000)
    def live(self,result):
        # A URL retornada deve ser do jornal; redirects são bloqueados pelo Net.
        if not re.fullmatch(r'https://tomezap\.com\.br/noticia/[a-z0-9]+(?:-[a-z0-9]+)*/',result.get('url','')):return False
        try:
            html=self.net.request(result['url'],headers={'Cache-Control':'no-cache'},timeout=8,max_bytes=2000000).decode('utf-8')
            return result.get('revision')==1 and 'name="tnn-agent-revision" content="1"' in html
        except AgentError:return False

class Manual:
    def __init__(self,config,state,collector,writer,drafts,bridge,editorial,now=time.time,covers=None):
        self.config=config;self.state=state;self.collector=collector;self.writer=writer;self.drafts=drafts;self.bridge=bridge;self.editorial=editorial;self.now=now;self.covers=covers
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
    def cover(self,job,draft):
        """Foto do editor ou arte do jornal. Falha de capa nunca derruba a pauta."""
        if not self.covers or not self.covers.enabled:return None,None
        if job.get('photo'):
            try:
                url=self.covers.photo(self.bridge.media(job['receipt']))
                try:self.bridge.call('/media/release',{'receipt':job['receipt']})
                except Exception:pass
                credit=' '.join(str(job.get('credit') or '').split())[:120]
                return {'capa_url':url,'capa_credito':credit if len(credit)>=2 else 'Foto enviada à Redação Tome Nota'},'photo'
            except Exception:pass
        try:return {'capa_url':self.covers.art(draft['titulo'],draft['localidade'])},'art'
        except Exception:return None,None
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
                    self.send_story(data['job']['draftId'],p['url'])
                    self.state.client.delete(key)
                except AgentError:pass
            break  # Um probe por rodada; não atrasar toda a fila.
    def send_story(self,draft_id,url):
        """Peça editorial a partir da capa própria; nunca busca imagem de outro portal."""
        try:
            from ..art import render_story
            from PIL import Image
            draft=self.drafts.fetch(draft_id);photo=None
            match=re.fullmatch(r'https://bot\.tomezap\.com\.br/imagens/([a-f0-9]{32})-1600\.jpg',draft.get('capa_url',''))
            if match and self.covers and self.covers.enabled:
                file=Path(self.covers.directory)/(match[1]+'-1600.jpg')
                if file.is_file():
                    with Image.open(file) as image:photo=image.convert('RGB')
            raw=render_story(draft,photo=photo)
            self.bridge.call('/stories',{'draftId':draft_id,'url':url,'png':base64.b64encode(raw).decode()})
            return True
        except Exception:return False  # Publicação não é desfeita por falha da arte.
    def one(self):
        if not self.config.manual_enabled:return False
        self.check_deploy()
        if self.now()-self.checked>60:
            self.ready=self.editorial.ready();self.checked=self.now()
        try:quota={'used':self.state.used('gemini'),'limit':self.config.gemini_daily}
        except Exception:quota=None
        answer=self.bridge.call('/commands/claim',{'publisherReady':self.ready,**({'quota':quota} if quota else {})})
        job=answer.get('command')
        if not job:return False
        lock=self.state.lock()
        if not lock.acquire(blocking=False):return False
        try:
            result=self.process(job)
            self.bridge.call('/commands/result',{'id':job['id'],'lease':job['lease'],**result})
            if result.get('code')=='live':self.send_story(job['draftId'],result['url'])
        except Exception:
            # Resultados incertos ficam na fila; reexecução usa cache e IDs persistentes.
            pass
        finally:
            if lock.owned():lock.release()
        return True
    def edit(self,job,memo):
        """Correção antes de aprovar: nasce um rascunho novo e o antigo é retirado da fila."""
        if job.get('mode') not in ('title','direct','photo') and not self.config.gemini_free:return {'code':'awaiting_configuration'}
        context=self.retry(lambda:self.drafts.call())
        if context.get('capabilities',{}).get('manual') is not True:return {'code':'awaiting_configuration'}
        if not memo.get('old'):
            memo['old']=self.retry(lambda:self.drafts.fetch(job['draftId']));self.cache(job['id'],memo)
        old=memo['old']
        if not memo.get('started'):
            begin=self.retry(lambda:self.drafts.call({'action':'manual_begin','id':job['id'],'receipt':job['receipt'],'max_pending':self.config.max_pending}))
            if not begin.get('started'):return {'code':begin.get('reason','edit_failed') if begin.get('reason')=='queue_full' else 'edit_failed','draftId':job['draftId']}
            memo['started']=True;self.cache(job['id'],memo)
        if not memo.get('draft'):
            if job.get('mode')=='title':new=self.writer.retitle(old,job['text'])
            elif job.get('mode')=='direct':new=self.writer.direct(old,job['fields'])
            elif job.get('mode')=='photo':new={k:old[k] for k in ('slug','titulo','resumo','texto','localidade','fontes','evidencias')}
            else:
                # Mesma regra da pauta: resposta incerta não gasta cota duas vezes.
                if memo.get('generation_started'):return {'code':'edit_failed','draftId':job['draftId']}
                if not self.state.reserve('gemini',self.config.gemini_daily):return {'code':'quota_limit'}
                memo['generation_started']=True;self.cache(job['id'],memo);self.report(job,'redacao')
                new=self.writer.correct(old,job['text'])
            new['id']=str(uuid.uuid4())
            if old.get('capa_url'):
                if old.get('capa_credito'):new['capa_url']=old['capa_url'];new['capa_credito']=old['capa_credito'];memo['cover']='photo'
                else:
                    # Arte do jornal traz a manchete: refazer quando a manchete muda.
                    try:new['capa_url']=self.covers.art(new['titulo'],new['localidade']) if self.covers and self.covers.enabled else old['capa_url']
                    except Exception:new['capa_url']=old['capa_url']
                    memo['cover']='art'
            if job.get('mode')=='photo':
                fields,kind=self.cover(job,new)
                if kind!='photo':raise AgentError('A foto não pôde ser validada; mantenha o rascunho anterior.')
                new.update(fields);memo['cover']='photo'
            memo['draft']=new
            # Revisão da mesma pauta: registros próprios, sem esbarrar na deduplicação da original.
            memo['seen']=[{'hash':digest('correcao:'+job['receipt']+':titulo'),'tipo':'titulo','titulo':new['titulo'][:500]}]+[
                {'hash':digest('correcao:'+job['receipt']+':'+str(i)),'tipo':'url','titulo':s['title'][:500]} for i,s in enumerate(new['fontes'])]
            self.cache(job['id'],memo)
        if not memo.get('saved'):
            self.report(job,'rascunho')
            saved=self.retry(lambda:self.drafts.call({'action':'save','cycle_id':job['id'],'draft':memo['draft'],'seen':memo['seen'],'max_pending':self.config.max_pending}))
            if not saved.get('saved'):return {'code':'queue_full' if saved.get('reason')=='queue_full' else 'edit_failed','draftId':job['draftId']}
            memo['saved']=saved['id'];self.cache(job['id'],memo)
        if not memo.get('retired'):
            # A assinatura da ponte cobre exatamente a rejeição do rascunho antigo por esta mensagem.
            try:self.editorial.decide({**job,'kind':'reject'})
            except Exception:pass
            memo['retired']=True;self.cache(job['id'],memo)
        draft=memo['draft'];self.report(job,'previa');sources=draft['fontes']
        self.bridge.call('/preview',{'id':memo['saved'],'revision':1,'titulo':draft['titulo'],'resumo':draft['resumo'],'localidade':draft['localidade'],
            'sources':[{'name':s['name'],'url':s['url']} for s in sources],'replaces':job['draftId'],
            **({'single':'owner' if sources[0].get('owner') else 'official'} if len(sources)==1 else {}),
            **({'cover':memo['cover'],'coverUrl':draft['capa_url']} if memo.get('cover') and draft.get('capa_url') else {})})
        return {'code':'draft_ready','draftId':memo['saved']}
    def process(self,job):
        raw=self.state.client.get(self.prefix+job['id']);memo=json.loads(raw) if raw else {}
        if memo.get('result'):return memo['result']
        result=None
        try:
            if job['kind']=='edit':
                try:result=self.edit(job,memo)
                except QuotaLimit:result={'code':'quota_limit'}
                except Exception:result={'code':'edit_failed','draftId':job['draftId']}
                return result
            if job['kind'] in ('approve','reject'):
                if job['kind']=='approve' and not self.ready:return {'code':'awaiting_configuration'}
                if not memo.get('publication'):
                    memo['publication']=self.retry(lambda:self.editorial.decide(job));self.cache(job['id'],memo)
                p=memo['publication']
                if job['kind']=='reject':result={'code':'rejected','draftId':job['draftId']}
                else:
                    if self.editorial.live(p):
                        # Stories é enviado depois da confirmação do resultado na ponte.
                        result={'code':'live','draftId':job['draftId'],'url':p['url']}
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
                if not accepted(sources):result={'code':'weak_sources'};return result
                memo['sources']=sources
                # Deduplicação da pauta e das URLs antes de gastar geração.
                memo['seen']=[{'hash':digest(normalize(job['text'])),'tipo':'titulo','titulo':job['text'][:500]}]+[
                    # Material do editor não tem URL própria: a deduplicação usa o conteúdo.
                    {'hash':digest('material:'+normalize(s['content']) if s.get('owner') else s['url']),'tipo':'url','titulo':s['title']} for s in sources]
                if self.drafts.call({'action':'seen','hashes':[s['hash'] for s in memo['seen']]}).get('seen'):
                    result={'code':'already_seen'};return result
                self.cache(job['id'],memo)
            if not memo.get('draft'):
                # Se a geração ficou incerta, não gastar cota novamente após crash.
                if memo.get('generation_started'):result={'code':'failed'};return result
                if not self.state.reserve('gemini',self.config.gemini_daily):result={'code':'quota_limit'};return result
                memo['generation_started']=True;self.cache(job['id'],memo);self.report(job,'redacao')
                memo['draft']=self.writer.write(job['text'],memo['sources']);memo['draft']['id']=str(uuid.uuid4());self.cache(job['id'],memo)
            if not memo.get('cover_done'):
                fields,kind=self.cover(job,memo['draft'])
                if fields:memo['draft'].update(fields);memo['cover']=kind
                memo['cover_done']=True;self.cache(job['id'],memo)
            if not memo.get('saved'):
                self.report(job,'rascunho')
                saved=self.retry(lambda:self.drafts.call({'action':'save','cycle_id':job['id'],'draft':memo['draft'],'seen':memo['seen'],'max_pending':self.config.max_pending}))
                if not saved.get('saved'):result={'code':saved.get('reason','failed')};return result
                memo['saved']=saved['id'];self.cache(job['id'],memo)
            draft=memo['draft'];self.report(job,'previa')
            self.bridge.call('/preview',{'id':memo['saved'],'revision':1,'titulo':draft['titulo'],'resumo':draft['resumo'],'localidade':draft['localidade'],
                'sources':[{'name':s['name'],'url':s['url']} for s in memo['sources']],
                **({'single':'owner' if memo['sources'][0].get('owner') else 'official'} if len(memo['sources'])==1 else {}),
                **({'cover':memo['cover'],'coverUrl':draft['capa_url']} if memo.get('cover') else {})})
            result={'code':'draft_ready','draftId':memo['saved']};return result
        except QuotaLimit:result={'code':'quota_limit'};return result
        except Exception:
            # Pode ter sido uma resposta de banco incerta: manter payload permite replay seguro.
            result={'code':'failed',**({'draftId':memo['saved']} if memo.get('saved') else {})};return result
        finally:
            if result:
                memo['result']=result;self.cache(job['id'],memo)
                if job['kind'] in ('pauta','edit') and memo.get('started'):
                    code={'draft_ready':'ok','failed':'internal_error','edit_failed':'write_failed','awaiting_configuration':'internal_error'}.get(result['code'],result['code'])
                    try:self.drafts.call({'action':'finish','id':job['id'],'status':'completed' if result['code']=='draft_ready' else 'skipped','stage':'previa' if result['code']=='draft_ready' else 'coleta','code':code,'duration_ms':0})
                    except Exception:pass
                    self.report(job,'fim','completed' if result['code']=='draft_ready' else 'skipped',code)

