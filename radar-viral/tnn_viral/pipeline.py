import json
import time
import uuid
from datetime import datetime,timezone
from tnn.core import AgentError
from .config import PLACES
from .sources import forbidden

class Pipeline:
    def __init__(self,config,store,sources,editor,api,relay,now=time.time,sleep=time.sleep):
        self.c=config;self.s=store;self.sources=sources;self.editor=editor;self.api=api;self.relay=relay;self.now=now;self.sleep=sleep
    def retry(self,fn):
        for attempt in range(3):
            try:return fn()
            except AgentError as error:
                if not error.retryable or attempt==2:raise
                self.sleep(2**attempt)
    def memo(self,job,data=None):
        key=self.s.prefix+'job:'+job['id']
        if data is None:return json.loads(self.s.client.get(key) or '{}')
        self.s.client.set(key,json.dumps(data,ensure_ascii=False),ex=7*86400)
    def run(self,job):
        if not self.c.enabled:return {'status':'disabled'}
        lock=self.s.client.lock(self.s.prefix+'worker',timeout=660,blocking=False)
        if not lock.acquire(blocking=False):return {'status':'busy'}
        try:return self.scan(job) if job['kind']=='scan' else self.decide(job)
        finally:
            if lock.owned():lock.release()
    def scan(self,job):
        memo=self.memo(job);metrics=memo.get('metrics',{'n_coletadas':0,'n_descartadas_filtro':0,'n_pontuadas':0,'n_entregues':0,'custo_aproximado_tokens':0})
        if memo.get('finished'):return {'status':'duplicate'}
        if not memo.get('proposed') and not self.s.available(self.c.intensive,self.c.daily):
            self.api.call({'action':'run','id':job['id'],'turno':job['turno'],'status':'skipped','code':'quota_limit','metrics':metrics})
            return {'status':'quota_limit'}
        state=self.relay.call('/pipeline-state')
        if not state.get('connected') or not state.get('groupConfigured'):return {'status':'awaiting_whatsapp'}
        self.retry(lambda:self.api.call({'action':'run','id':job['id'],'turno':job['turno'],'status':'running','metrics':metrics}))
        deadline=time.monotonic()+260
        try:
            if 'sources' not in memo:
                memo['sources']=self.sources.collect(job,self.now())[:150];metrics['n_coletadas']=len(memo['sources']);self.memo(job,memo)
            if 'seen' not in memo:
                memo['seen']=self.retry(lambda:self.api.call({'action':'seen','items':[{'hash':s['hash'],'url':s['url']} for s in memo['sources']]})).get('hashes',[])
                self.memo(job,memo)
            proposed=memo.setdefault('proposed',[]);attempted=memo.setdefault('attempted',[])
            for source in memo['sources']:
                if len(proposed)>=3 or time.monotonic()>deadline-50:break
                if not self.s.available(self.c.intensive,self.c.daily):break
                if source['hash'] in attempted:continue
                attempted.append(source['hash']);self.memo(job,memo)
                if source['hash'] in memo['seen']:metrics['n_descartadas_filtro']+=1;continue
                if forbidden(source['titulo']+' '+source['trecho']):metrics['n_descartadas_filtro']+=1;continue
                if not self.s.reserve('gemini',self.c.gemini_daily,self.c.global_gemini):break
                # Reserva antes da chamada. Resposta incerta não gera outra chamada após crash.
                try:angle=self.editor.write(source)
                except AgentError:continue
                metrics['n_pontuadas']+=1;metrics['custo_aproximado_tokens']+=max(0,self.editor.tokens)
                if not angle:metrics['n_descartadas_filtro']+=1;continue
                if not self.s.candidate(source['hash'],self.c.intensive,self.c.daily):continue
                city=source['cidade_detectada'];angle.pop('evidencia',None)
                proposed.append({'id':str(uuid.uuid4()),'dedupe_hash':source['hash'],'turno':job['turno'],
                  'cidade':PLACES[city][0],'localidade':PLACES[city][1],**angle,'fonte_url':source['url'],
                  'fonte_titulo':source['titulo'],'fonte_trecho':source['trecho'],'fonte_data':source['data'],
                  'cover_candidato':source.get('cover_candidato')})
                memo['metrics']=metrics;self.memo(job,memo)
            if 'saved' not in memo:
                memo['saved']=self.retry(lambda:self.api.call({'action':'save','runId':job['id'],'items':proposed})).get('items',[]);self.memo(job,memo)
            if memo['saved']:
                fields=('id','numero','revisao','turno','cidade','localidade','gatilho','titulos','hook','angulo','fonte_url','potencial','score_justificativa')
                self.relay.call('/radar/preview',{'runId':job['id'],'turno':job['turno'],'items':[{k:p[k] for k in fields} for p in memo['saved']]})
                for p in memo['saved']:
                    city=next((c for c,v in PLACES.items() if v[0]==p['cidade']),None)
                    if city:self.s.client.set(self.s.prefix+'city:'+city,'1',ex=6*3600)
                metrics['n_entregues']=len(memo['saved'])
            self.retry(lambda:self.api.call({'action':'run','id':job['id'],'turno':job['turno'],'status':'completed','code':'ok' if metrics['n_entregues'] else 'no_candidates','metrics':metrics}))
            memo['finished']=True;memo['metrics']=metrics;self.memo(job,memo)
            return {'status':'completed','delivered':metrics['n_entregues']}
        except Exception:
            memo['metrics']=metrics;self.memo(job,memo)
            try:self.api.call({'action':'run','id':job['id'],'turno':job['turno'],'status':'failed','code':'stage_failed','metrics':metrics})
            except Exception:pass
            return {'status':'failed'}
    def decide(self,job):
        p=job['decision'];memo=self.memo(job)
        if memo.get('finished'):return {'status':'duplicate'}
        old=self.retry(lambda:self.api.get(p['id']))
        if 'result' not in memo:
            if p['action']=='correct':
                stamp=datetime.fromisoformat(old['fonte_data'].replace('Z','+00:00')).timestamp()
                if self.now()-stamp>86400:
                    self.api.call({'action':'expire','id':p['id']});self.relay.call('/radar/notice',{'id':p['id'],'code':'expired','receipt':p['receipt']});return {'status':'expired'}
                if 'edit' not in memo:
                    if memo.get('generation_started'):
                        self.relay.call('/radar/notice',{'id':p['id'],'receipt':p['receipt'],'code':'correction_failed'});return {'status':'correction_uncertain'}
                    if not self.s.reserve('gemini',self.c.gemini_daily,self.c.global_gemini):
                        self.relay.call('/radar/notice',{'id':p['id'],'receipt':p['receipt'],'code':'correction_failed'});return {'status':'quota_limit'}
                    memo['generation_started']=True;self.memo(job,memo)
                    city=next(c for c,v in PLACES.items() if v[0]==old['cidade'])
                    source={'titulo':old['fonte_titulo'],'trecho':old['fonte_trecho'],'url':old['fonte_url'],'data':old['fonte_data'],'cidade_detectada':city}
                    edit=self.editor.write(source,p.get('instruction',''))
                    if not edit:
                        self.relay.call('/radar/notice',{'id':p['id'],'receipt':p['receipt'],'code':'correction_failed'});return {'status':'correction_refused'}
                    edit.pop('evidencia',None);memo['edit']=edit;self.memo(job,memo)
            memo['result']=self.retry(lambda:self.api.call({**p,**({'edit':memo['edit']} if p['action']=='correct' else {})}));self.memo(job,memo)
        result=memo['result']
        if not result.get('ok'):
            self.relay.call('/radar/notice',{'id':p['id'],'receipt':p['receipt'],'code':'expired' if result.get('code')=='expired' else 'conflict'});return {'status':'declined'}
        item=result['item']
        if p['action']=='approve':
            # Este comando apenas gera rascunho. Nunca chama ingestão nem APROVAR texto.
            handoff=self.relay.call('/radar/handoff',{'id':item['id'],'revision':p['revision'],'receipt':p['receipt'],
              'title':item['titulos'][item['titulo_escolhido']],'angle':item['angulo'],'url':item['fonte_url'],'trigger':item['gatilho']})
            self.retry(lambda:self.api.call({'action':'link','id':item['id'],**handoff}))
        elif p['action']=='correct':
            keys=('id','numero','revisao','turno','cidade','localidade','gatilho','titulos','hook','angulo','fonte_url','potencial','score_justificativa')
            self.relay.call('/radar/preview',{'runId':job['id'],'turno':'demanda','items':[{k:item[k] for k in keys}]})
        else:self.relay.call('/radar/notice',{'id':p['id'],'receipt':p['receipt'],'code':'rejected'})
        memo['finished']=True;self.memo(job,memo);return {'status':'decided'}
