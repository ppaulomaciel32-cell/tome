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
from tnn.autonomous.collection import Collector,PublicFetch,parse_feed,canonical,similar,clean,digest,local_score,listing_links,printed_date
from tnn.autonomous.store import State
from tnn.autonomous.writer import Writer,anchor
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
    def test_weak_source_stops_before_writing_never_saves_and_does_not_spam_group(self):
        self.collector.enrich.return_value=ROWS[:1]
        self.assertEqual(self.pipeline.once()['status'],'weak_sources');self.writer.write.assert_not_called()
        self.assertEqual([p['action'] for p in self.actions],['begin','finish'])
        self.assertNotIn('/notice',[c.args[0] for c in self.bridge.call.call_args_list])
    def test_weak_first_candidate_does_not_block_the_next_one(self):
        other={**ROWS[0],'title':'Escola do Pecém abre vagas para curso técnico','url':'https://a.example/escola'}
        self.collector.feeds.return_value=[copy.deepcopy(ROWS[0]),other]
        self.collector.enrich.side_effect=lambda row,rows,now:ROWS[:1] if row['url']==ROWS[0]['url'] else copy.deepcopy(ROWS)
        self.assertEqual(self.pipeline.once()['status'],'draft_created');self.assertEqual(self.collector.enrich.call_count,2)
        self.assertEqual(self.writer.write.call_args.args[0],other['title'])
    def test_automatic_cycle_ignores_stories_without_a_local_mention(self):
        far={**ROWS[0],'title':'Ministério Público do Ceará empossa promotora em Fortaleza','content':'Segundo o órgão, a posse ocorreu em Fortaleza. '*10,'url':'https://a.example/fortaleza'}
        self.collector.feeds.return_value=[far]
        self.assertEqual(self.pipeline.once()['status'],'no_candidates');self.collector.enrich.assert_not_called();self.writer.write.assert_not_called()
    def test_single_official_source_becomes_a_draft_marked_as_single(self):
        official=[{**ROWS[0],'official':True}];self.collector.enrich.return_value=copy.deepcopy(official)
        self.writer.write.return_value={**article(),'fontes':copy.deepcopy(official)}
        self.assertEqual(self.pipeline.once()['status'],'draft_created')
        preview=next(c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/preview')
        self.assertEqual(preview['single'],'official');self.assertEqual(len(preview['sources']),1)
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
    def test_single_source_mode_allows_shorter_text_and_hides_internal_flags_from_model(self):
        fake=Mock();short='Segundo o órgão, a vistoria da ponte considera as condições locais e a segurança dos moradores. '*3
        valid={**article(),'texto':'\n\n'.join([short.strip()]*4)}
        fake.generate.return_value=json.dumps(valid);writer=Writer(fake)
        with self.assertRaises(AgentError):writer.write(TITLE,ROWS)  # duas fontes: mínimo de 300 palavras
        official=[{**ROWS[0],'official':True}]
        self.assertEqual(writer.write(TITLE,official)['fontes'],official)
        sent=fake.generate.call_args.args[1]
        self.assertEqual(sent['modo'],'fonte_unica_oficial');self.assertNotIn('official',sent['fontes'][0]);self.assertNotIn('publisher_group',sent['fontes'][0])
        self.assertEqual(Writer.mode([{**ROWS[0],'owner':True}]),'material_redacao');self.assertEqual(Writer.mode(ROWS),'multiplas_fontes')
    def test_evidence_may_quote_the_source_title_and_is_trimmed_to_a_literal_span(self):
        source=ROWS[0]
        self.assertEqual(anchor(TITLE,source),TITLE)
        joined=source['content'][:96].strip()+' Além disso, o prefeito prometeu uma ponte nova em dezembro.'
        self.assertEqual(anchor(joined,source),source['content'][:96].strip())
        for bad in ('Paráfrase livre que não aparece em lugar nenhum da fonte.','curto',None,'x'*600):self.assertIsNone(anchor(bad,source))
        fake=Mock();valid=article();valid['evidencias'][0]['trecho']=TITLE;valid['evidencias'][1]['trecho']=joined
        fake.generate.return_value=json.dumps(valid);draft=Writer(fake).write(TITLE,ROWS)
        self.assertEqual(draft['evidencias'][1]['trecho'],source['content'][:96].strip())
    def test_local_mention_in_body_counts_and_correction_reuses_every_guard(self):
        self.assertEqual(local_score('Governo entrega nova adutora'),0)
        self.assertGreater(local_score('Governo entrega nova adutora','A obra atende moradores do Pecém e da Taíba.'),local_score('Governo do Ceará entrega adutora'))
        self.assertGreater(local_score('Pecém recebe nova adutora'),local_score('Governo entrega nova adutora','A obra atende o Pecém.'))
        fake=Mock();valid=article();fake.generate.return_value=json.dumps(valid);writer=Writer(fake)
        old={**{k:valid[k] for k in ('titulo','resumo','texto','localidade')},'fontes':ROWS}
        writer.correct(old,'deixe a manchete   mais direta');sent=fake.generate.call_args.args[1]
        self.assertEqual(sent['correcao_solicitada'],'deixe a manchete mais direta');self.assertEqual(sent['versao_anterior']['texto'],valid['texto'])
        fake.generate.return_value=json.dumps({**valid,'titulo':'Ponte recebe 98457 pessoas'})
        with self.assertRaises(AgentError):writer.correct(old,'invente um número')
    def test_city_hall_listing_reads_newest_pages_once_and_uses_printed_date(self):
        city=Source('prefeitura','Prefeitura de Teste','https://cidade.example/informa',('cidade.example',),'prefeitura',True,True)
        today=datetime.fromtimestamp(NOW,timezone(timedelta(hours=-3)));stamp=today.strftime('%d/%m/%Y');old=(today-timedelta(days=30)).strftime('%d/%m/%Y')
        listing='<a href="/informa/7/noticia-antiga">a</a><a href="/informa/12/obra-na-estrada">b</a><a href="/informa/12/obra-na-estrada">b</a><a href="/informa/9/sem-data">c</a><a href="https://evil.example/informa/99/x">d</a>'
        body='A prefeitura informou que a obra na estrada de acesso ao distrito começa na próxima semana e muda o trânsito local. '*3
        pages={'/informa':listing,'/informa/12/obra-na-estrada':'<title>Obra na estrada começa na próxima semana</title><p>Por Fulano '+stamp+'</p><article>'+body+'</article>',
            '/informa/9/sem-data':'<title>Página sem data nenhuma</title><p>'+body+'</p>','/informa/7/noticia-antiga':'<title>Notícia antiga</title><p>'+old+'</p><p>'+body+'</p>'}
        public=Mock();public.get.side_effect=lambda url,domains:pages[url.replace('https://cidade.example','')].encode()
        collector=Collector(dataclasses.replace(self.config,sources=(city,)),self.state,public=public)
        self.assertEqual(listing_links(listing),['/informa/12/obra-na-estrada','/informa/9/sem-data','/informa/7/noticia-antiga'])
        rows=collector.feeds(NOW);self.assertEqual([r['url'] for r in rows],['https://cidade.example/informa/12/obra-na-estrada'])
        self.assertTrue(rows[0]['official']);self.assertEqual(rows[0]['title'],'Obra na estrada começa na próxima semana');self.assertEqual(public.get.call_count,4)
        # Segunda rodada: só a lista é baixada de novo.
        collector.feeds(NOW);self.assertEqual(public.get.call_count,5)
        self.assertIsNone(printed_date('sem data'));self.assertIsNone(printed_date('31/02/2026'));self.assertEqual(printed_date('em 05/10/2026 às 9h').day,5)
    def test_local_story_stays_valid_for_a_week_but_regional_only_three_days(self):
        when=(datetime.fromtimestamp(NOW,timezone.utc)-timedelta(days=5)).strftime('%a, %d %b %Y %H:%M:%S +0000')
        item=lambda title:('<rss><item><title>'+title+'</title><link>https://a.example/x</link><pubDate>'+when+'</pubDate><description>Texto da nota oficial.</description></item></rss>').encode()
        self.assertEqual(len(parse_feed(item('Governo do Ceará anuncia programa estadual'),SOURCE,NOW)),0)
        self.assertEqual(len(parse_feed(item('Estrada do Pecém recebe nova sinalização'),SOURCE,NOW)),1)
    def test_config_refuses_auto_publish_and_unreviewed_model(self):
        with patch.dict(os.environ,{'AGENTE_REQUER_APROVACAO':'false'}):
            with self.assertRaises(AgentError):Config.env()
        with patch.dict(os.environ,{'AGENTE_REQUER_APROVACAO':'true','GEMINI_MODEL':'another-model'}):
            with self.assertRaises(AgentError):Config.env()

if __name__=='__main__':unittest.main()
