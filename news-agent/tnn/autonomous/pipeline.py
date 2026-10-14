"""Somente pesquisa -> rascunho privado -> prévia. Não contém ingestão/publicação."""
import time
import uuid
from ..core import AgentError,normalize
from .collection import digest,similar,local_score,accepted
from .store import QuotaLimit

class Pipeline:
    def __init__(self,config,state,collector,writer,drafts,bridge,now=time.time,sleep=time.sleep):
        self.config=config;self.state=state;self.collector=collector;self.writer=writer;self.drafts=drafts;self.bridge=bridge;self.now=now;self.sleep=sleep
    def retry(self,fn,allow_expired=False):
        for attempt in range(3):
            if not allow_expired and self.now()>getattr(self,'deadline',float('inf')): raise AgentError('Tempo disponível do ciclo esgotado.')
            try: return fn()
            except AgentError as error:
                if not error.retryable or attempt==2: raise
                self.sleep(2**attempt)
    def report_stage(self,cycle,stage,pending):
        # Telemetria opcional: sua falha não gera nem publica uma matéria.
        try: self.bridge.call('/cycle-status',{'state':'running','cycleId':cycle,'stage':stage,'pending':min(10,pending)})
        except Exception: pass
    def once(self):
        c=self.config
        if not c.enabled or not c.gemini_free or len({s.publisher_group for s in c.sources})<2:
            return {'status':'awaiting_configuration'}
        lock=self.state.lock()
        if not lock.acquire(blocking=False): return {'status':'busy'}
        cycle=str(uuid.uuid4());started=self.now();stage='coleta';code='ok';status='completed';draft_id=None;begun=False
        self.deadline=started+660
        try:
            connected=self.bridge.call('/pipeline-state')
            if not connected.get('connected') or not connected.get('groupConfigured'): return {'status':'awaiting_whatsapp'}
            context=self.retry(lambda:self.drafts.call())
            start=self.retry(lambda:self.drafts.call({'action':'begin','id':cycle,'max_pending':c.max_pending}))
            if not start.get('started'):
                if start.get('reason')=='queue_full': self.bridge.call('/cycle-status',{'state':'queue_full','cycleId':cycle,'pending':len(context['drafts'])})
                return {'status':start.get('reason','cycle_exists')}
            begun=True
            self.bridge.call('/cycle-status',{'state':'running','stage':'coleta','cycleId':cycle,'pending':len(context['drafts'])})
            rows=self.retry(lambda:self.collector.feeds(self.now()))
            known=context.get('seen',[])
            candidates=[r for r in rows if local_score(r['title'])>0 and not any(
                s['hash'] in (digest(r['url']),digest(normalize(r['title']))) or similar(r['title'],s['titulo'],.75) for s in known)]
            if not candidates: self.state.reset('coleta');status='skipped';code='no_candidates';return {'status':code}
            # Uma pauta fraca não pode travar o ciclo: tenta as próximas, sem avisar o grupo a cada rodada.
            candidate=sources=None
            for row in candidates[:4]:
                found=self.retry(lambda:self.collector.enrich(row,rows,self.now()))
                if accepted(found): candidate,sources=row,found;break
            if not sources:
                self.state.reset('coleta')
                status='skipped';code='weak_sources';return {'status':code}
            seen=[{'hash':digest(normalize(candidate['title'])),'tipo':'titulo','titulo':candidate['title']}]+[
                {'hash':digest(s['url']),'tipo':'url','titulo':s['title']} for s in sources]
            if self.retry(lambda:self.drafts.call({'action':'seen','hashes':[s['hash'] for s in seen]})).get('seen'):
                self.state.reset('coleta')
                status='skipped';code='already_seen';return {'status':code}
            self.state.reset('coleta');stage='redacao'
            self.report_stage(cycle,stage,len(context['drafts']))
            def write():
                if not self.state.reserve('gemini',c.gemini_daily): raise QuotaLimit('Cota local de redação atingida.')
                return self.writer.write(candidate['title'],sources)
            draft=self.retry(write);draft['id']=str(uuid.uuid4());self.state.reset('redacao');stage='rascunho'
            self.report_stage(cycle,stage,len(context['drafts']))
            if not lock.owned() or self.now()-started>660: raise AgentError('Ciclo excedeu o tempo disponível.')
            result=self.retry(lambda:self.drafts.call({'action':'save','cycle_id':cycle,'draft':draft,'seen':seen,'max_pending':c.max_pending}))
            if not result.get('saved'): status='skipped';code=result.get('reason','already_seen');return {'status':code}
            draft_id=result['id'];self.state.reset('rascunho');stage='previa'
            self.report_stage(cycle,stage,len(context['drafts'])+1)
            self.bridge.call('/preview',{'id':draft_id,'revision':1,'titulo':draft['titulo'],'resumo':draft['resumo'],
                'localidade':draft['localidade'],'sources':[{'name':s['name'],'url':s['url']} for s in sources],
                **({'single':'official'} if len(sources)==1 else {})})
            self.state.reset('previa');return {'status':'draft_created','id':draft_id}
        except QuotaLimit:
            status='skipped';code='quota_limit';return {'status':code}
        except Exception:
            status='failed';code={'coleta':'collect_failed','redacao':'write_failed','rascunho':'store_failed','previa':'preview_failed'}[stage]
            try:
                failures=self.state.failure(stage)
                if failures==3: self.bridge.call('/notice',{'cycleId':cycle,'code':code})
            except Exception: pass
            # Só códigos fixos: nunca texto da exceção, conteúdo privado ou token.
            return {'status':code,'id':draft_id}
        finally:
            if begun:
                duration=min(900000,max(0,int((self.now()-started)*1000)))
                try: self.retry(lambda:self.drafts.call({'action':'finish','id':cycle,'status':status,'stage':stage,'code':code,'duration_ms':duration}),allow_expired=True)
                except Exception: status='failed';code='store_failed'
                try: self.bridge.call('/cycle-status',{'state':status,'stage':stage,'cycleId':cycle,'pending':min(10,len(context['drafts'])+int(bool(draft_id))),'code':code})
                except Exception: pass
            try:
                if lock.owned(): lock.release()
            except Exception: pass

