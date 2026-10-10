import json
import os
import random
import time
from pathlib import Path
from .art import default_photo, jpeg_bytes, photo_from_bytes, render_story
from .core import AgentError, LOCALS, Settings, clean_error, https, preview_html

class Pipeline:
    def __init__(self,store,whatsapp,search,writer,cloud,ingest,transcriber,settings=None,sleep=time.sleep):
        self.store=store;self.wa=whatsapp;self.search=search;self.writer=writer
        self.cloud=cloud;self.ingest=ingest;self.transcriber=transcriber
        self.settings=settings or Settings.env();self.sleep=sleep
        self.data=Path(os.getenv('DATA_DIR','/data'))
    def audit(self,job,stage,status,duration=0,error=''):
        try: self.ingest.log(job,stage,status,duration,error)
        except Exception:
            record={'job_id':job['id'],'etapa':stage,'status':status,'duracao_ms':int(duration),'erro':error}
            if hasattr(self.store,'r'): self.store.r.rpush('tnn:audit',json.dumps(record))
    def run_stage(self,job,stage,fn):
        job['stage']=stage;self.store.save(job)
        for attempt in range(3):
            start=time.monotonic()
            try:
                result=fn()
                self.audit(job,stage,'ok',(time.monotonic()-start)*1000)
                self.store.fail_count(stage,False)
                return result
            except Exception as exc:
                message=clean_error(exc)
                self.audit(job,stage,'retry' if attempt<2 and getattr(exc,'retryable',False) else 'error',
                           (time.monotonic()-start)*1000,message)
                if attempt==2 or not getattr(exc,'retryable',False):
                    failures=self.store.fail_count(stage,True)
                    if failures>=3:
                        try: self.wa.text(job['sender'],f'Alerta: {failures} falhas consecutivas em {stage}. {message}',f"alert:{job['id']}:{stage}")
                        except Exception: pass
                    raise
                self.sleep(2**attempt+random.uniform(0,.4))
    def commands(self,job):
        correction=False
        for text in self.store.take_commands(job['id']):
            if text=='APROVAR': job['approved']=True
            elif text.startswith('CORRIGIR '):
                job['correction']=text[9:].strip();job['previous']=job.get('article')
                job['revision']=max(int(time.time()*1000),job['revision']+1)
                job['approved']=False
                for key in ('article','story_path','preview','sent_preview','publish_result','final_sent'):
                    job.pop(key,None)
                correction=True
        self.store.save(job)
        return correction
    def process(self,id):
        job=self.store.get(id)
        if not job:return
        changed=self.commands(job)
        if job['status']=='done' and not changed:return
        try:
            if not https(self.settings.public_url): raise AgentError('O endereço HTTPS de preview ainda não foi configurado.')
            folder=self.data/'jobs'/job['id'];folder.mkdir(parents=True,exist_ok=True,mode=0o700)
            job['status']='processing';self.store.save(job)
            if job.get('audio_id') and not job.get('transcribed'):
                audio=self.run_stage(job,'audio_download',lambda:self.wa.media(job['audio_id']))
                job['headline']=self.run_stage(job,'transcricao',lambda:self.transcriber.transcribe(audio))
                job['transcribed']=True;self.store.save(job)
            if not job.get('sources'):
                job['sources']=self.run_stage(job,'coleta',lambda:self.search.search(job['headline']))
                self.store.save(job)
            if not job['sources']: raise AgentError('Não encontrei fonte confiável para sustentar essa pauta. Envie outra manchete ou fontes.')
            if len(job['sources'])<2 and not job.get('approved'):
                self.wa.text(job['sender'],'Fonte fraca: encontrei apenas uma fonte confiável. Não comecei a redação. Responda APROVAR para prosseguir com essa fonte ou CORRIGIR com uma orientação.',f"weak:{id}:{job['revision']}")
                job['status']='awaiting_sources';self.store.save(job);return
            self.commands(job)
            if not job.get('article'):
                job['article']=self.run_stage(job,'redacao',lambda:self.writer.write(job['headline'],job['sources'],job.get('correction',''),job.get('previous')))
                self.store.save(job)
            photo_path=folder/'photo.jpg'
            if photo_path.exists(): photo=photo_from_bytes(photo_path.read_bytes())
            elif job.get('media_id'):
                raw=self.run_stage(job,'foto',lambda:self.wa.media(job['media_id'],5000000))
                photo=photo_from_bytes(raw);photo_path.write_bytes(jpeg_bytes(photo))
            else:
                photo=default_photo();photo_path.write_bytes(jpeg_bytes(photo))
                self.wa.text(job['sender'],'A pauta chegou sem foto. Vou usar a capa padrão do Tome Nota News.',f'no-photo:{id}')
            if not job.get('cover_url'):
                job['cover_url']=self.run_stage(job,'capa',lambda:self.cloud.cover(photo_path.read_bytes(),id));self.store.save(job)
            if not job.get('story_path'):
                story=self.run_stage(job,'arte',lambda:render_story(job['article'],photo))
                path=folder/f"stories_{job['article']['slug']}_{job['revision']}.png"
                path.write_bytes(story);job['story_path']=str(path);self.store.save(job)
            if not job.get('preview'):
                token=self.store.preview(job,preview_html(job['article'],job['cover_url'],job['sources']))
                job['preview']=self.settings.public_url+'/preview/'+token;self.store.save(job)
            if not job.get('sent_preview'):
                self.run_stage(job,'resposta_arte',lambda:self.wa.image(job['sender'],Path(job['story_path']).read_bytes(),f"story:{id}:{job['revision']}"))
                end='Aguardando APROVAR.' if self.settings.require_approval and not job.get('approved') else 'Publicando...'
                article=job['article']
                text=(f"Matéria pronta:\nTítulo: {article['titulo']}\nLocalidade: {LOCALS[article['localidade']]}\nFontes: {len(job['sources'])}\nResumo: {article['resumo']}\nPreview: {job['preview']}\n{end}")
                self.run_stage(job,'resposta_preview',lambda:self.wa.text(job['sender'],text,f"preview:{id}:{job['revision']}"))
                job['sent_preview']=True;self.store.save(job)
            if self.commands(job): self.store.enqueue(id);return
            if self.settings.require_approval and not job.get('approved'):
                job['status']='awaiting_approval';self.store.save(job);return
            if not job.get('publish_result') or not job['publish_result'].get('deploy_requested'):
                for _ in range(self.settings.grace_seconds):
                    self.sleep(1)
                    if self.commands(job): self.store.enqueue(id);return
                payload={**job['article'],'job_id':id,'source_hash':job['fingerprint'],
                    'revision':job['revision'],'cover_url':job['cover_url'],'gerada_por':'ia',
                    'fontes':[{'titulo':s['title'],'url':s['url'],'data':s.get('published_date','')} for s in job['sources']]}
                def publish():
                    result=self.ingest.publish(payload)
                    job['publish_result']=result;self.store.save(job)
                    if not result.get('deploy_requested'):
                        raise AgentError('A matéria foi salva, mas o rebuild está pendente.',True)
                    return result
                job['publish_result']=self.run_stage(job,'ingestao',publish);self.store.save(job)
            result=job['publish_result']
            if not https(result.get('url','')): raise AgentError('A ingestão não retornou um endereço válido.')
            job['status']='awaiting_deploy';self.store.save(job)
            deadline=time.monotonic()+self.settings.build_wait_seconds
            while True:
                try: live=self.ingest.live(result['url'],result['revision'])
                except AgentError: live=False
                if live: break
                if self.commands(job):self.store.enqueue(id);return
                if time.monotonic()>=deadline:
                    self.wa.text(job['sender'],'A matéria completa foi salva, mas ainda não confirmei a página no ar. Envie STATUS para conferir novamente.',f"deploy-pending:{id}:{job['revision']}")
                    return
                self.sleep(5)
            if not job.get('final_sent'):
                self.run_stage(job,'resposta_final',lambda:self.wa.text(job['sender'],f"No ar: {result['url']}\nCompartilhar: {result['url']}",f"final:{id}:{result['revision']}"))
                job['final_sent']=True
            job['status']='done';self.store.save(job)
        except Exception as exc:
            message=clean_error(exc)
            job['status']='publication_pending' if job.get('publish_result') else 'failed'
            job['error']=message;self.store.save(job)
            try:self.wa.text(job['sender'],f"Pauta {id[:8]}: {message}",f"error:{id}:{job['revision']}:{job.get('stage','setup')}")
            except Exception:pass
