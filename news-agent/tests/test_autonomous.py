"""Sem chamadas pagas, WhatsApp real ou publicações. Redis em memória com Lua real."""
import copy
import dataclasses
import json
import os
import time
import unittest
from datetime import datetime,timezone,timedelta
from unittest.mock import Mock,patch
import fakeredis
from tnn.core import AgentError
from tnn.autonomous.config import Config,Source
from tnn.autonomous.collection import Collector,PublicFetch,parse_feed,canonical,similar,clean,digest
from tnn.autonomous.store import State
from tnn.autonomous.writer import Writer
from tnn.autonomous.pipeline import Pipeline

SOURCE=Source('orgao-a','Órgão A','https://a.example/feed',('a.example',),'orgao-a')
SOURCE_B=Source('orgao-b','Órgão B','https://b.example/feed',('b.example',),'orgao-b')
TITLE='Ponte da Taíba passa por vistoria após chuva'
NOW=time.time()
ROWS=[{'id':s.id,'name':s.name,'publisher_group':s.publisher_group,'title':TITLE,'url':'https://'+s.domains[0]+'/ponte',
       'content':('Segundo o órgão, a vistoria da ponte considera as condições locais e a segurança dos moradores. '*12 if i==0 else 'Uma equipe de especialistas analisa a estrutura e orienta os trabalhadores responsáveis pela manutenção preventiva do trecho. '*10),
       'published_date':datetime.fromtimestamp(NOW,timezone.utc).isoformat()} for i,s in enumerate((SOURCE,SOURCE_B))]

def article():
    # Texto sintético, repetido apenas para testar tamanho e evidências; nunca é pauta real.
    paragraph=('Segundo o órgão, esta é uma simulação de redação para conferir o funcionamento do sistema e de seus controles privados. '
        'O material de teste apresenta informações fictícias e não deve ser publicado como notícia, relato de apuração ou orientação aos leitores. '
        'A revisão confere tamanho, atribuição de fontes e preservação dos dados antes de liberar qualquer etapa do trabalho, com acompanhamento humano em todas as decisões editoriais da redação local neste exercício controlado. Esta simulação existe somente para demonstrar os testes locais de revisão.')
    body='\n\n'.join([paragraph]*4)
    return {'titulo':TITLE,'resumo':'A redação confere as fontes antes de preparar o rascunho privado.','texto':body,'localidade':'taiba','slug':'teste','capa_hint':'',
        'evidencias':[{'campo':x,'fonte_id':SOURCE.id,'trecho':ROWS[0]['content'][:80]} for x in ['titulo','resumo','paragrafo_1','paragrafo_2','paragrafo_3','paragrafo_4']]}

class AutonomousTests(unittest.TestCase):
    def setUp(self):
        self.state=State(fakeredis.FakeRedis(decode_responses=True))
        self.config=Config(enabled=True,gemini_free=True,sources=(SOURCE,SOURCE_B))
        self.collector=Mock();self.collector.feeds.return_value=copy.deepcopy(ROWS);self.collector.enrich.return_value=copy.deepcopy(ROWS)
        self.writer=Mock();self.writer.write.return_value={**article(),'fontes':copy.deepcopy(ROWS)}
        self.bridge=Mock();self.bridge.call.return_value={'connected':True,'groupConfigured':True}
        self.actions=[]
        def remote(payload=None):
            if payload is None:return {'drafts':[],'seen':[]}
            self.actions.append(copy.deepcopy(payload))
            if payload['action']=='begin':return {'started':True}
            if payload['action']=='seen':return {'seen':False}
            if payload['action']=='save':return {'saved':True,'id':payload['draft']['id']}
            return {'ok':True}
        self.drafts=Mock();self.drafts.call.side_effect=remote
        self.pipeline=Pipeline(self.config,self.state,self.collector,self.writer,self.drafts,self.bridge,sleep=lambda _:None)
    def test_private_pipeline_saves_before_preview_and_never_publishes(self):
        result=self.pipeline.once();self.assertEqual(result['status'],'draft_created')
        self.assertEqual([p['action'] for p in self.actions],['begin','seen','save','finish'])
        self.assertEqual(self.actions[-1]['status'],'completed')
        preview=next(c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/preview')
        self.assertEqual(preview['id'],self.actions[2]['draft']['id'])
        self.assertEqual(preview['revision'],1)
        self.assertFalse(any('publish' in p['action'] for p in self.actions))
    def test_stage_observations_follow_the_real_pipeline_without_publication(self):
        self.assertEqual(self.pipeline.once()['status'],'draft_created')
        updates=[c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/cycle-status']
        self.assertEqual([p['stage'] for p in updates],['coleta','redacao','rascunho','previa','previa'])
        self.assertEqual(updates[-1]['state'],'completed')
        self.assertFalse(any(p.get('action')=='publish' for p in self.actions))
    def test_optional_stage_observation_failure_does_not_discard_complete_draft(self):
        def bridge(path,p=None):
            if path=='/cycle-status' and p.get('stage')=='redacao':raise AgentError('telemetry fixture')
            return {'connected':True,'groupConfigured':True}
        self.bridge.call.side_effect=bridge
        self.assertEqual(self.pipeline.once()['status'],'draft_created')
        self.assertTrue(any(p['action']=='save' for p in self.actions))
    def test_disabled_or_unconfirmed_free_tier_or_single_owner_source_never_calls_services(self):
        for cfg in (dataclasses.replace(self.config,enabled=False),dataclasses.replace(self.config,gemini_free=False),dataclasses.replace(self.config,sources=(SOURCE,))):
            self.pipeline.config=cfg;self.assertEqual(self.pipeline.once()['status'],'awaiting_configuration')
        self.drafts.call.assert_not_called();self.writer.write.assert_not_called();self.bridge.call.assert_not_called()
    def test_missing_group_stops_before_database_search_or_generation(self):
        self.bridge.call.return_value={'connected':False,'groupConfigured':False}
        self.assertEqual(self.pipeline.once()['status'],'awaiting_whatsapp');self.collector.feeds.assert_not_called();self.drafts.call.assert_not_called()
    def test_concurrent_worker_cannot_enter_existing_lock(self):
        lock=self.state.lock();lock.acquire(blocking=False)
        try:self.assertEqual(self.pipeline.once()['status'],'busy');self.writer.write.assert_not_called()
        finally:lock.release()
    def test_weak_source_warns_before_writing_and_never_saves(self):
        self.collector.enrich.return_value=ROWS[:1]
        self.assertEqual(self.pipeline.once()['status'],'weak_sources');self.writer.write.assert_not_called()
        self.assertEqual([p['action'] for p in self.actions],['begin','finish'])
        self.assertIn('/notice',[c.args[0] for c in self.bridge.call.call_args_list])
    def test_duplicate_checked_in_persistent_store_before_generation(self):
        remote=self.drafts.call.side_effect
        self.drafts.call.side_effect=lambda p=None:{'seen':True} if p and p['action']=='seen' else remote(p)
        self.assertEqual(self.pipeline.once()['status'],'already_seen');self.writer.write.assert_not_called()
    def test_full_queue_pauses_without_collecting(self):
        remote=self.drafts.call.side_effect
        self.drafts.call.side_effect=lambda p=None:{'started':False,'reason':'queue_full'} if p and p['action']=='begin' else remote(p)
        self.assertEqual(self.pipeline.once()['status'],'queue_full');self.collector.feeds.assert_not_called()
    def test_retry_two_times_then_failure_no_save(self):
        self.collector.feeds.side_effect=AgentError('fixture',True)
        self.assertEqual(self.pipeline.once()['status'],'collect_failed');self.assertEqual(self.collector.feeds.call_count,3)
        self.writer.write.assert_not_called();self.assertEqual(self.actions[-1]['status'],'failed')
    def test_ambiguous_generation_not_repeated(self):
        self.writer.write.side_effect=AgentError('Resposta incerta',False)
        self.assertEqual(self.pipeline.once()['status'],'write_failed');self.assertEqual(self.writer.write.call_count,1)
        self.assertFalse(any(p['action']=='save' for p in self.actions))
    def test_failed_group_preview_preserves_complete_private_draft_without_retry(self):
        self.bridge.call.side_effect=lambda path,p=None: (_ for _ in ()).throw(AgentError('incerto')) if path=='/preview' else {'connected':True,'groupConfigured':True}
        self.assertEqual(self.pipeline.once()['status'],'preview_failed')
        self.assertEqual(sum(c.args[0]=='/preview' for c in self.bridge.call.call_args_list),1)
        self.assertTrue(any(p['action']=='save' for p in self.actions));self.assertEqual(self.actions[-1]['stage'],'previa')
    def test_third_consecutive_failure_sends_one_fixed_alert(self):
        self.collector.feeds.side_effect=AgentError('private-provider-data',False)
        for _ in range(4):self.pipeline.once()
        alerts=[c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/notice']
        self.assertEqual(len(alerts),1);self.assertEqual(alerts[0]['code'],'collect_failed')
        self.assertNotIn('private-provider-data',json.dumps(alerts))
    def test_daily_monthly_atomic_limits_and_zero_disable(self):
        self.assertTrue(self.state.reserve('tavily',2,3));self.assertTrue(self.state.reserve('tavily',2,3));self.assertFalse(self.state.reserve('tavily',2,3))
        self.state.now=lambda:time.time()+86400
        self.assertTrue(self.state.reserve('tavily',2,3));self.assertFalse(self.state.reserve('tavily',2,3))
        self.assertFalse(self.state.reserve('other',0,5))
    def test_generation_budget_is_reserved_on_every_retry(self):
        self.pipeline.config=dataclasses.replace(self.config,gemini_daily=1)
        self.writer.write.side_effect=AgentError('retry',True)
        self.assertEqual(self.pipeline.once()['status'],'quota_limit');self.assertEqual(self.writer.write.call_count,1)
        self.assertEqual(self.actions[-1]['status'],'skipped')
    def test_three_enrichment_failures_trigger_alert_even_if_feeds_work(self):
        self.collector.enrich.side_effect=AgentError('fixture',False)
        for _ in range(3):self.pipeline.once()
        alerts=[c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/notice']
        self.assertEqual(len(alerts),1);self.assertEqual(alerts[0]['code'],'collect_failed')
    def test_rss_rejects_xxe_private_host_stale_and_missing_dates(self):
        with self.assertRaises(AgentError):parse_feed(b'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss>&x;</rss>',SOURCE,NOW)
        rows=parse_feed(('<rss><channel><item><title>'+TITLE+'</title><link>https://a.example/news?utm_source=wa</link><pubDate>'+ROWS[0]['published_date']+'</pubDate><description>Texto</description></item><item><title>Sem data</title><link>https://a.example/old</link></item></channel></rss>').encode(),SOURCE,NOW)
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['url'],'https://a.example/news')
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(AgentError):PublicFetch().get('https://a.example/news',SOURCE.domains)
        with self.assertRaises(AgentError):PublicFetch().get('https://evil.example/news',SOURCE.domains)
        stale=('<rss><item><title>Antiga</title><link>https://a.example/old</link><pubDate>2020-01-01T00:00:00Z</pubDate></item></rss>').encode()
        self.assertEqual(parse_feed(stale,SOURCE,NOW),[])
    def test_copied_sources_and_same_publisher_do_not_count_twice(self):
        self.assertEqual(len(Collector.independent([ROWS[0],{**ROWS[1],'content':ROWS[0]['content']} ])),1)
        self.assertEqual(len(Collector.independent([ROWS[0],{**ROWS[1],'publisher_group':SOURCE.publisher_group}])),1)
        self.assertEqual(len(Collector.independent(ROWS)),2)
    def test_rss_two_sources_does_not_spend_tavily_credits(self):
        cfg=dataclasses.replace(self.config,tavily_free=True);net=Mock();collector=Collector(cfg,self.state,net=net)
        self.assertEqual(len(collector.enrich(ROWS[0],copy.deepcopy(ROWS),NOW)),2);net.json.assert_not_called()
    def test_writer_rejects_short_text_fake_evidence_or_invented_number(self):
        fake=Mock();valid=article();fake.generate.return_value=json.dumps(valid)
        writer=Writer(fake);self.assertEqual(writer.write(TITLE,ROWS)['localidade'],'taiba')
        for change in ({'texto':'Curto.\n\nTeste.\n\nTeste.\n\nSegundo fonte.'},{'titulo':'Ponte recebe 98457 pessoas'},{'evidencias':[{'campo':'titulo','fonte_id':'evil','trecho':'inventado'}]}):
            fake.generate.return_value=json.dumps({**valid,**change})
            with self.assertRaises(AgentError):writer.write(TITLE,ROWS)
    def test_config_refuses_auto_publish_and_unreviewed_model(self):
        with patch.dict(os.environ,{'AGENTE_REQUER_APROVACAO':'false'}):
            with self.assertRaises(AgentError):Config.env()
        with patch.dict(os.environ,{'AGENTE_REQUER_APROVACAO':'true','GEMINI_MODEL':'another-model'}):
            with self.assertRaises(AgentError):Config.env()

if __name__=='__main__':unittest.main()
