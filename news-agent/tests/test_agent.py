import copy
import hashlib
import hmac
import io
import json
import os
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from tnn.core import AgentError,Settings,fingerprint,parse_article,preview_html
from tnn.art import render_story,default_photo,headline_lines,FONT
from tnn.pipeline import Pipeline
from tnn.providers import Drael,Search
from tnn.web import Bot,valid_signature

ARTICLE={'slug':'ponte-interditada','titulo':'Ponte interditada após chuva na Taíba',
 'resumo':'A interdição foi informada pela Prefeitura; equipes acompanham a situação.',
 'texto':'Segundo a Prefeitura, uma ponte foi interditada na Taíba após a chuva.\n\nO comunicado informa que equipes acompanham a situação.\n\nConforme a Defesa Civil, o trecho permanece sinalizado.\n\nOs órgãos ainda não informaram o prazo de liberação.',
 'localidade':'taiba','capa_hint':'Foto enviada pela redação'}
SOURCES=[{'title':'Prefeitura informa interdição','url':'https://prefeitura.example/nota','content':ARTICLE['texto'],'published_date':'2026-10-09'},
 {'title':'Defesa Civil informa sinalização','url':'https://defesa.example/nota','content':ARTICLE['texto']+' Nota independente.','published_date':'2026-10-09'}]

class MemoryStore:
 def __init__(self):self.jobs={};self.dedup={};self.last_ids={};self.messages=set();self.queue=[];self.commands={};self.photos={};self.failures={}
 def save(self,j):self.jobs[j['id']]=copy.deepcopy(j)
 def get(self,id):return copy.deepcopy(self.jobs.get(id))
 def create(self,sender,headline,media_id,audio_id,fp):
  if fp in self.dedup:return self.get(self.dedup[fp]),False
  j={'id':str(uuid.uuid4()),'sender':sender,'headline':headline,'media_id':media_id,'audio_id':audio_id,'fingerprint':fp,'status':'queued','created':time.time(),'revision':int(time.time()*1000),'sources':[],'approved':False}
  self.save(j);self.dedup[fp]=j['id'];self.last_ids[sender]=j['id'];self.queue.append(j['id']);return j,True
 def last(self,sender):return self.get(self.last_ids.get(sender))
 def seen(self,id):old=id in self.messages;self.messages.add(id);return old
 def unsee(self,id):self.messages.discard(id)
 def recent_inbound(self,sender):pass
 def pending_photo(self,sender,media_id=None):
  if media_id:self.photos[sender]=media_id;return media_id
  return self.photos.pop(sender,'')
 def command(self,id,text):self.commands.setdefault(id,[]).append(text)
 def take_commands(self,id):return self.commands.pop(id,[])
 def enqueue(self,id):self.queue.append(id)
 def preview(self,job,html):self.preview_content=html;return 'a'*43
 def fail_count(self,stage,failed):self.failures[stage]=self.failures.get(stage,0)+1 if failed else 0;return self.failures[stage]

class WA:
 def __init__(self,events):self.events=events
 def text(self,sender,text,key):self.events.append(('text',text))
 def image(self,sender,data,key):self.events.append(('image',len(data)))
 def media(self,id,max_bytes=0):return self.photo
class Sources:
 def __init__(self):self.calls=0;self.sources=copy.deepcopy(SOURCES)
 def search(self,headline):self.calls+=1;return self.sources
class Writer:
 def __init__(self):self.calls=0;self.fail=False
 def write(self,*args):
  self.calls+=1
  if self.fail:raise AgentError('Teste de rede.',True)
  a=copy.deepcopy(ARTICLE)
  if args[2]:a['titulo']='Título corrigido da mesma pauta'
  return a
class Cloud:
 def cover(self,*args):return 'https://res.cloudinary.com/dalwymbky/image/upload/test.jpg'
class Ingest:
 def __init__(self,events):self.events=events;self.payloads=[];self.is_live=True
 def log(self,*args):pass
 def publish(self,p):
  self.payloads.append(copy.deepcopy(p));self.events.append(('publish',p['titulo']))
  return {'id':'id','slug':'ponte-interditada','url':'https://news.example/noticia/ponte-interditada/','revision':p['revision'],'deploy_requested':True}
 def live(self,*args):return self.is_live
 def list(self):return []
class Transcriber:
 def transcribe(self,data):return ARTICLE['titulo']

class AgentTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'DATA_DIR':self.tmp.name});self.env.start()
  self.events=[];self.store=MemoryStore();self.wa=WA(self.events);self.sources=Sources();self.writer=Writer();self.ingest=Ingest(self.events)
  out=io.BytesIO();default_photo().save(out,'JPEG');self.wa.photo=out.getvalue()
  self.settings=Settings(False,'https://bot.example','https://news.example',0,0)
  self.pipeline=Pipeline(self.store,self.wa,self.sources,self.writer,Cloud(),self.ingest,Transcriber(),self.settings,sleep=lambda t:None)
  self.bot=Bot(self.store,self.wa,self.ingest,['5585999999999'],'123')
 def tearDown(self):self.env.stop();self.tmp.cleanup()
 def submit(self,photo=True,id='message-1',sender='5585999999999'):
  message={'id':id,'from':sender,'type':'image' if photo else 'text','timestamp':str(int(time.time()))}
  if photo:message['image']={'id':'media-1','caption':ARTICLE['titulo']}
  else:message['text']={'body':'MANCHETE: '+ARTICLE['titulo']}
  self.bot.message(message);return self.store.last(sender)
 def test_complete_mock_pipeline_order_and_image(self):
  j=self.submit();self.pipeline.process(j['id']);self.assertEqual(self.store.get(j['id'])['status'],'done')
  types=[e[0] for e in self.events];self.assertLess(types.index('image'),types.index('publish'))
  preview_index=next(i for i,e in enumerate(self.events) if e[0]=='text' and e[1].startswith('Matéria pronta:'))
  self.assertLess(preview_index,types.index('publish'));self.assertTrue(self.events[-1][1].startswith('No ar:'))
  self.assertIn('noindex',self.store.preview_content);self.assertEqual(len(self.ingest.payloads),1)
 def test_duplicate_five_minutes_and_72h(self):
  self.submit();self.submit(id='message-2');self.assertEqual(len(self.store.jobs),1)
  self.assertEqual(self.events[-1][1],'Já estou trabalhando nisso')
 def test_repeated_meta_message_does_not_duplicate(self):
  self.submit();self.submit();self.assertEqual(len(self.store.jobs),1);self.assertEqual(len(self.events),1)
 def test_missing_photo_uses_default_and_warns(self):
  j=self.submit(False);self.pipeline.process(j['id']);self.assertEqual(len(self.ingest.payloads),1)
  self.assertTrue(any('sem foto' in str(e[1]) for e in self.events))
 def test_unauthorized_number_never_creates_job(self):
  self.submit(sender='5585888888888');self.assertFalse(self.store.jobs);self.assertEqual(self.events[-1][1],'Número não autorizado')
 def test_weak_sources_warn_before_writing_and_approval_resumes(self):
  self.sources.sources=self.sources.sources[:1];j=self.submit();self.pipeline.process(j['id'])
  self.assertEqual(self.writer.calls,0);self.assertEqual(len(self.ingest.payloads),0)
  self.assertEqual(self.store.get(j['id'])['status'],'awaiting_sources')
  self.store.command(j['id'],'APROVAR');self.pipeline.process(j['id']);self.assertEqual(len(self.ingest.payloads),1)
 def test_network_failure_retries_twice_and_does_not_publish(self):
  self.writer.fail=True;j=self.submit();self.pipeline.process(j['id'])
  self.assertEqual(self.writer.calls,3);self.assertEqual(len(self.ingest.payloads),0)
  self.assertEqual(self.store.get(j['id'])['status'],'failed')
 def test_approval_mode_waits_and_correction_keeps_sources(self):
  self.settings.require_approval=True;j=self.submit();self.pipeline.process(j['id'])
  self.assertEqual(len(self.ingest.payloads),0);self.assertEqual(self.store.get(j['id'])['status'],'awaiting_approval')
  self.store.command(j['id'],'CORRIGIR troque o título');self.pipeline.process(j['id'])
  self.store.command(j['id'],'APROVAR');self.pipeline.process(j['id'])
  self.assertEqual(self.sources.calls,1);self.assertEqual(self.writer.calls,2)
  self.assertEqual(self.ingest.payloads[-1]['titulo'],'Título corrigido da mesma pauta')
 def test_correction_after_publication_reuses_job_and_source_hash(self):
  j=self.submit();self.pipeline.process(j['id']);self.store.command(j['id'],'CORRIGIR troque o título');self.pipeline.process(j['id'])
  a,b=self.ingest.payloads;self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(a['source_hash'],b['source_hash']);self.assertGreater(b['revision'],a['revision']);self.assertEqual(self.sources.calls,1)
 def test_deploy_not_ready_never_sends_live_url(self):
  self.ingest.is_live=False;j=self.submit();self.pipeline.process(j['id'])
  self.assertEqual(self.store.get(j['id'])['status'],'awaiting_deploy')
  self.assertFalse(any(str(e[1]).startswith('No ar:') for e in self.events))
 def test_status_and_list_commands_do_not_create_jobs(self):
  j=self.submit();self.bot.command(j['sender'],'STATUS','status-1')
  self.assertIn('na fila',self.events[-1][1]);self.bot.command(j['sender'],'LISTAR','list-1')
  self.assertIn('Ainda não há',self.events[-1][1]);self.assertEqual(len(self.store.jobs),1)
 def test_three_failed_jobs_trigger_stage_alert(self):
  self.writer.fail=True
  for number in range(3):
   j,_=self.store.create('5585999999999','Pauta '+str(number),'media-1','',str(number))
   self.pipeline.process(j['id'])
  self.assertEqual(len(self.ingest.payloads),0)
  self.assertTrue(any('3 falhas consecutivas em redacao' in str(e[1]) for e in self.events))
 def test_photo_then_text_and_audio(self):
  m={'id':'image-only','from':'5585999999999','type':'image','image':{'id':'media-1'}};self.bot.message(m)
  self.bot.message({'id':'audio','from':m['from'],'type':'audio','audio':{'id':'audio-1'}})
  j=self.store.last(m['from']);self.assertEqual(j['media_id'],'media-1');self.pipeline.process(j['id'])
  self.assertTrue(self.store.get(j['id'])['transcribed'])
 def test_webhook_signature_and_payload_tampering(self):
  body=b'{"object":"whatsapp_business_account"}';secret='test-secret'
  sig='sha256='+hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
  self.assertTrue(valid_signature(body,sig,secret));self.assertFalse(valid_signature(body+b' ',sig,secret));self.assertFalse(valid_signature(body,sig,''))
 def test_json_validation_blocks_unsupported_numbers(self):
  bad=copy.deepcopy(ARTICLE);bad['texto']=bad['texto'].replace('uma ponte','99 pontes')
  with self.assertRaises(AgentError):parse_article(json.dumps(bad),SOURCES)
 def test_preview_escapes_database_and_model_output(self):
  a=copy.deepcopy(ARTICLE);a['titulo']='<script>bad()</script>';html=preview_html(a,'https://example.com/i',SOURCES)
  self.assertNotIn('<script>bad()</script>',html);self.assertIn('&lt;script&gt;',html)
 def test_story_dimensions_weight_and_long_headline(self):
  a=copy.deepcopy(ARTICLE);a['titulo']='Notícia importante da região ' * 10
  data=render_story(a,default_photo());im=Image.open(io.BytesIO(data));self.assertEqual(im.size,(1080,1920));self.assertEqual(im.format,'PNG');self.assertLess(len(data),1500000)
 def test_drael_adapter_uses_confirmed_host_no_server_tools_and_json_validation(self):
  captured={}
  class Fake:
   def json(self,url,payload,headers,**kwargs):captured.update(url=url,payload=payload);return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(ARTICLE)}}]}
  with patch.dict(os.environ,{'DRAEL_API_KEY':'test-only'}):a=Drael(Fake()).write(ARTICLE['titulo'],SOURCES)
  self.assertEqual(captured['url'],'https://drael.sh/v1/chat/completions');self.assertEqual(captured['payload']['model'],'drael-v1');self.assertEqual(captured['payload']['tools'],[]);self.assertEqual(captured['payload']['temperature'],.3);self.assertEqual(a['localidade'],'taiba')

if __name__=='__main__':unittest.main()
