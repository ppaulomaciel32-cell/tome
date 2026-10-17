import copy
import io
import json
import threading
import time
import unittest
import urllib.request
from datetime import datetime,timedelta
from unittest.mock import Mock,patch
import fakeredis
from tnn.autonomous.store import State
from tnn_viral.config import Config,place
from tnn_viral.state import Store,scheduled,ZONE,digest
from tnn_viral.sources import Sources,forbidden,safe_url,city_in
from tnn_viral.editor import Editor
from tnn_viral.pipeline import Pipeline
from tnn_viral.server import server

def source(city='caucaia',n=1,now=None):
    return {'titulo':'Caucaia anuncia feira de cultura e serviços gratuitos','url':'https://www.caucaia.ce.gov.br/noticia/'+str(n),
      'trecho':'A Prefeitura de Caucaia anunciou uma feira de cultura e serviços gratuitos na praça do município. O comunicado apresenta informações para os moradores sobre os atendimentos disponíveis e a participação das equipes da prefeitura no evento. '+str(n),
      'data':datetime.fromtimestamp(now or time.time(),ZONE).isoformat(),'origem':'official','cidade_detectada':city,'cover_candidato':None,'hash':digest('source-'+str(n))}
def angle():return {'eligible':True,'gatilho':'utilidade','titulos':['Caucaia anuncia feira com serviços gratuitos','Feira de cultura terá serviços gratuitos em Caucaia','Moradores de Caucaia terão feira de serviços'],
  'hook':'A Prefeitura de Caucaia anunciou feira de cultura e serviços gratuitos.','angulo':'Serviços gratuitos de uma feira anunciada pela Prefeitura de Caucaia.','potencial':8,'score_justificativa':'Utilidade local apoiada no comunicado.','evidencia':'A Prefeitura de Caucaia anunciou uma feira de cultura e serviços gratuitos'}

class RadarTests(unittest.TestCase):
    def setUp(self):
        self.now=time.time();self.redis=fakeredis.FakeRedis(decode_responses=True);self.store=Store(self.redis,lambda:self.now)
        self.config=Config(enabled=True,token='a'*64,draft_token='b'*64)
    def test_disabled_config_does_not_require_any_key_or_provider(self):
        self.assertFalse(Config.env({'RADAR_ENABLED':'false','RADAR_SOURCES':'bad'}).enabled)
    def test_fixed_turns_fortaleza_and_no_catchup(self):
        for h,m,label in [(6,30,'manha'),(12,0,'tarde'),(18,30,'noite')]:
            now=datetime(2026,10,17,h,m,tzinfo=ZONE).timestamp();job,key=scheduled(now)
            self.assertEqual(job['turno'],label);self.assertIn('20261017',key)
            self.assertIsNone(scheduled(now+60));self.assertTrue(self.store.enqueue(job,key)['queued']);self.assertTrue(self.store.enqueue(job,key)['duplicate'])
            self.store.client.delete(self.store.prefix+'scanning')
        self.assertIsNotNone(scheduled(datetime(2026,10,17,10,20,tzinfo=ZONE).timestamp(),True))
        self.assertIsNone(scheduled(datetime(2026,10,17,10,21,tzinfo=ZONE).timestamp(),True))
    def test_manual_and_cron_race_produces_one_job_and_recovery_keeps_it(self):
        job={'kind':'scan','city':None,'turno':'demanda'}
        self.assertTrue(self.store.enqueue(job,'manual')['queued']);self.assertTrue(self.store.enqueue(job,'cron')['busy'])
        claimed=self.store.next();self.store.recover();recovered=self.store.next();self.assertEqual(claimed,recovered)
        self.store.finish(recovered);self.assertIsNone(self.store.next())
    def test_cost_is_shared_with_redaction_and_hard_limited(self):
        shared=State(self.redis,lambda:self.now)
        self.assertTrue(shared.reserve('tavily',2,3));self.assertTrue(self.store.reserve('tavily',10,2,3));self.assertFalse(self.store.reserve('tavily',10,2,3))
        self.assertEqual(shared.used('tavily'),2)
    def test_intensive_window_and_daily_limit_are_atomic(self):
        for n in range(3):self.assertTrue(self.store.candidate(str(n),True,12))
        self.assertFalse(self.store.candidate('4',True,12));self.now+=7201
        self.assertTrue(self.store.candidate('4',True,12));self.assertFalse(self.store.candidate('4',False,12))
        self.assertFalse(self.store.candidate('5',False,4))
    def test_hard_filter_and_contextual_exception(self):
        for text in ['Homem morreu em acidente fatal','Confusão termina em morte','Afogamento no litoral','Facção ameaça moradores','Bala perdida atinge criança','Vítima não resistiu']:
            self.assertTrue(forbidden(text),text)
        self.assertFalse(forbidden('Projeto violência zero no bairro promove cultura e prevenção'))
    def test_source_is_dated_regional_and_never_a_private_download(self):
        collector=Sources(self.config,self.store);raw=source();data={'title':raw['titulo'],'url':raw['url'],'content':raw['trecho'],'published_date':raw['data']}
        self.assertIsNotNone(collector.normalize(data,'web',['caucaia'],self.now,24))
        self.assertIsNone(collector.normalize({**data,'published_date':''},'web',['caucaia'],self.now,24))
        self.assertIsNone(collector.normalize(data,'web',['fortaleza'],self.now,24))
        self.assertIsNone(collector.normalize(data,'instagram',['caucaia'],self.now,24))
        self.assertIsNotNone(collector.normalize({**data,'url':'https://www.instagram.com/p/publico'},'instagram',['caucaia'],self.now,24))
        for url in ['http://example.com/x','https://127.0.0.1/x','https://user:pass@example.com/x','https://example.com:8443/x']:self.assertFalse(safe_url(url))
        self.assertFalse(city_in('Prefeitura de Croatá inaugura escola em Croatá','croata'))
        self.assertTrue(city_in('Distrito de Croatá em São Gonçalo do Amarante recebe feira','croata'))
        self.assertEqual(place('SÃO GONÇALO DO AMARANTE'),'sao-goncalo');self.assertIsNone(place('Arenoso'))
    def test_editor_rejects_invented_number_vague_hype_and_score_under_seven(self):
        original=source();self.assertIsNotNone(Editor.validate(angle(),original))
        for change in [{'potencial':6},{'hook':'A feira vai atender 99999 pessoas em Caucaia.'},{'angulo':'A cidade inteira está falando da feira de Caucaia.'},{'evidencia':'Trecho que não existe na fonte original.'}]:
            self.assertIsNone(Editor.validate({**angle(),**change},original),change)
    def fixture_pipeline(self):
        sources=Mock();sources.collect.return_value=[source(n=n,now=self.now) for n in range(1,5)]
        editor=Mock();editor.write.return_value={k:v for k,v in angle().items() if k!='eligible'};editor.tokens=100
        api=Mock();saved=[];calls=[]
        def call(p=None):
            calls.append(copy.deepcopy(p))
            if p and p['action']=='save':
                saved.extend(copy.deepcopy(p['items']));return {'items':[{**row,'numero':i+1,'revisao':1,'status':'pending'} for i,row in enumerate(p['items'])]}
            return {'ok':True}
        api.call.side_effect=call;relay=Mock();relay.call.return_value={'connected':True,'groupConfigured':True}
        pipeline=Pipeline(self.config,self.store,sources,editor,api,relay,now=lambda:self.now,sleep=lambda _:None)
        return pipeline,api,relay,editor,sources,saved,calls
    def test_scan_sends_at_most_three_in_one_batch_and_never_publishes(self):
        p,api,relay,editor,sources,saved,calls=self.fixture_pipeline();job={'kind':'scan','id':str(__import__('uuid').uuid4()),'turno':'demanda','city':'caucaia'}
        result=p.run(job);self.assertEqual(result['delivered'],3);self.assertEqual(len(saved),3)
        previews=[c for c in relay.call.call_args_list if c.args[0]=='/radar/preview'];self.assertEqual(len(previews),1)
        self.assertEqual(p.run(job)['status'],'duplicate');self.assertEqual(editor.write.call_count,3)
        self.assertNotIn('ingest',json.dumps(calls));self.assertTrue(all(row['localidade']=='regiao' for row in saved))
    def test_violent_source_never_calls_gemini_or_arrives_in_group(self):
        p,api,relay,editor,sources,saved,calls=self.fixture_pipeline();sources.collect.return_value=[{**source(),'titulo':'Homem morreu em acidente fatal em Caucaia'}]
        self.assertEqual(p.run({'kind':'scan','id':str(__import__('uuid').uuid4()),'turno':'manha','city':None})['delivered'],0)
        editor.write.assert_not_called();self.assertEqual(saved,[])
    def test_already_published_source_is_discarded_before_gemini(self):
        p,api,relay,editor,sources,saved,calls=self.fixture_pipeline();sources.collect.return_value=[source()]
        previous=api.call.side_effect
        api.call.side_effect=lambda body: {'hashes':[source()['hash']]} if body.get('action')=='seen' else previous(body)
        self.assertEqual(p.run({'kind':'scan','id':str(__import__('uuid').uuid4()),'turno':'manha'})['delivered'],0)
        editor.write.assert_not_called();self.assertEqual(saved,[])
    def test_daily_limit_stops_before_search_and_generation(self):
        import dataclasses
        p,api,relay,editor,sources,*_=self.fixture_pipeline();p.c=dataclasses.replace(self.config,daily=0)
        self.assertEqual(p.run({'kind':'scan','id':str(__import__('uuid').uuid4()),'turno':'manha'})['status'],'quota_limit')
        editor.write.assert_not_called();sources.collect.assert_not_called();relay.call.assert_not_called()
    def test_approval_only_hands_off_to_existing_draft_pipeline(self):
        p,api,relay,editor,*_=self.fixture_pipeline();id=str(__import__('uuid').uuid4())
        item={**source(),'id':id,'titulos':angle()['titulos'],'titulo_escolhido':0,'angulo':angle()['angulo'],'fonte_url':source()['url'],'gatilho':'utilidade'}
        api.get.return_value=item;api.call.side_effect=lambda body:{'ok':True,'item':item}
        relay.call.return_value={'jobId':str(__import__('uuid').uuid4()),'revision':1,'receipt':'c'*64,'signature':'d'*64}
        job={'kind':'decision','id':str(__import__('uuid').uuid4()),'decision':{'id':id,'revision':1,'action':'approve','receipt':'c'*64}}
        self.assertEqual(p.run(job)['status'],'decided');editor.write.assert_not_called()
        self.assertEqual(relay.call.call_args.args[0],'/radar/handoff')
        self.assertNotIn('tnn_ingest',str(api.call.call_args_list))
    def test_disconnected_whatsapp_blocks_paid_provider_calls(self):
        p,api,relay,editor,sources,*_=self.fixture_pipeline();relay.call.return_value={'connected':False,'groupConfigured':True}
        self.assertEqual(p.run({'kind':'scan','id':str(__import__('uuid').uuid4()),'turno':'manha'})['status'],'awaiting_whatsapp');sources.collect.assert_not_called()
    def test_expired_correction_does_not_spend_gemini(self):
        p,api,relay,editor,*_=self.fixture_pipeline();item=source(now=self.now-90000)
        api.get.return_value={'fonte_data':item['data']}
        command={'id':str(__import__('uuid').uuid4()),'kind':'decision','decision':{'id':str(__import__('uuid').uuid4()),'action':'correct','receipt':'c'*64}}
        self.assertEqual(p.run(command)['status'],'expired');editor.write.assert_not_called()
    def test_http_disabled_and_token_protected(self):
        for config,expected in [(Config(),503),(self.config,401)]:
            srv=server(config,self.store,Mock(),('127.0.0.1',0));thread=threading.Thread(target=srv.serve_forever,daemon=True);thread.start()
            try:
                with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen('http://127.0.0.1:'+str(srv.server_port)+'/state')
                self.assertEqual(error.exception.code,expected)
            finally:srv.shutdown();srv.server_close()

if __name__=='__main__':unittest.main()
