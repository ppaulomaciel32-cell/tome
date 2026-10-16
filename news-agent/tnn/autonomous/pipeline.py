"""Somente pesquisa -> rascunho privado -> prévia. Não contém ingestão/publicação."""
import time
import uuid
import os
from ..core import AgentError,normalize
from .collection import digest,similar,local_score,accepted
from .store import QuotaLimit

class Pipeline:
    def __init__(self,config,state,collector,writer,drafts,bridge,now=time.time,sleep=time.sleep,covers=None):
        self.covers=covers;self.config=config;self.state=state;self.collector=collector;self.writer=writer;self.drafts=drafts;self.bridge=bridge;self.now=now;self.sleep=sleep
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
            try:rows=self.retry(lambda:self.collector.feeds(self.now()))
            except AgentError:
                if not c.tavily_free and not os.getenv('TNN_MONITORS_FILE'):raise
                rows=[]
            if c.tavily_free:
                try:rows+=self.collector.discover(self.now())
                except AgentError:pass  # Sem Tavily, os feeds continuam funcionando.
            if os.getenv('TNN_MONITORS_FILE'):
                monitored=self.collector.monitors(self.now());rows=monitored+rows
                for item in monitored[:3]:
                    try:self.bridge.call('/monitor-alert',{'hash':item['observed_hash'],'title':item['title'],'url':item['url']})
                    except AgentError:pass
            known=context.get('seen',[])
            candidates=[r for r in rows if local_score(r['title'],r['content'])>=6 and not any(
                s['hash'] in (digest(r['url']+r.get('observed_hash','')),digest(normalize(r['title']))) or (not r.get('observed_hash') and similar(r['title'],s['titulo'],.75)) for s in known)]
            if not candidates: self.state.reset('coleta');status='skipped';code='no_candidates';return {'status':code}
            # Uma pauta fraca não pode travar o ciclo: tenta as próximas, sem avisar o grupo a cada rodada.
            candidate=sources=None
            for row in candidates[:4]:
                found=self.retry(lambda:self.collector.enrich(row,rows,self.now()))
                if accepted(found): candidate,sources=row,found;break
            if not sources:
                self.state.reset('coleta')
                status='skipped';code='weak_sources';return {'status':code}
            seen=[{'hash':digest(normalize(candidate['title'])+candidate.get('observed_hash','')),'tipo':'titulo','titulo':candidate['title']}]+[
                {'hash':digest(s['url']+s.get('observed_hash','')),'tipo':'url','titulo':s['title']} for s in sources]
            if self.retry(lambda:self.drafts.call({'action':'seen','hashes':[s['hash'] for s in seen]})).get('seen'):
                self.state.reset('coleta')
                status='skipped';code='already_seen';return {'status':code}
            self.state.reset('coleta');stage='redacao'
            self.report_stage(cycle,stage,len(context['drafts']))
            def write():
                if not self.state.reserve('gemini',c.gemini_daily): raise QuotaLimit('Cota local de redação atingida.')
                return self.writer.write(candidate['title'],sources)
            draft=self.retry(write);draft['id']=str(uuid.uuid4());self.state.reset('redacao');stage='rascunho'
            cover=None
            if self.covers and self.covers.enabled:
                # Sem foto do editor: foto oficial da fonte (Divulgação); se não houver, arte do jornal.
                found=None
                try: found=self.covers.source_photo(sources,self.collector.public)
                except Exception: found=None
                if found: draft['capa_url'],draft['capa_credito']=found;cover='source'
                else:
                    try: draft['capa_url']=self.covers.art(draft['titulo'],draft['localidade']);cover='art'
                    except Exception: draft.pop('capa_url',None)
            self.report_stage(cycle,stage,len(context['drafts']))
            if not lock.owned() or self.now()-started>660: raise AgentError('Ciclo excedeu o tempo disponível.')
            result=self.retry(lambda:self.drafts.call({'action':'save','cycle_id':cycle,'draft':draft,'seen':seen,'max_pending':c.max_pending}))
            if not result.get('saved'): status='skipped';code=result.get('reason','already_seen');return {'status':code}
            draft_id=result['id'];self.state.reset('rascunho');stage='previa'
            self.report_stage(cycle,stage,len(context['drafts'])+1)
            self.bridge.call('/preview',{'id':draft_id,'revision':1,'titulo':draft['titulo'],'resumo':draft['resumo'],
                'localidade':draft['localidade'],'sources':[{'name':s['name'],'url':s['url']} for s in sources],
                **({'investigative':True} if candidate.get('investigative') else {}),
                **({'single':'official'} if len(sources)==1 else {}),
                **({'cover':cover,'coverUrl':draft['capa_url']} if cover else {}),
                **({'coverCredit':draft['capa_credito']} if cover=='source' else {})})
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

