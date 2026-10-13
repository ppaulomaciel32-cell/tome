import copy
import dataclasses
import json
import time
import unittest
import uuid
from unittest.mock import Mock,patch
import fakeredis
from tnn.core import AgentError
from tnn.autonomous.manual import Manual,Editorial
from tnn.autonomous.config import Config
from tnn.autonomous.store import State
from tnn.autonomous.collection import Collector
from tests.test_autonomous import SOURCE,SOURCE_B,ROWS,article

class ManualTests(unittest.TestCase):
    def setUp(self):
        self.config=Config(manual_enabled=True,gemini_free=True,sources=(SOURCE,SOURCE_B))
        self.state=State(fakeredis.FakeRedis(decode_responses=True))
        self.collector=Mock();self.collector.manual.return_value=copy.deepcopy(ROWS)
        self.writer=Mock();self.writer.write.return_value={**article(),'fontes':copy.deepcopy(ROWS)}
        self.bridge=Mock();self.editorial=Mock();self.editorial.ready.return_value=True;self.editorial.live.return_value=False
        self.saved=[]
        def draft_call(p=None,action='context'):
            if p is None:return {'capabilities':{'manual':True},'drafts':[]}
            if p['action']=='manual_begin':return {'started':True}
            if p['action']=='seen':return {'seen':False}
            if p['action']=='save':self.saved.append(copy.deepcopy(p));return {'saved':True,'id':p['draft']['id']}
            return {'ok':True}
        self.drafts=Mock();self.drafts.call.side_effect=draft_call
        self.agent=Manual(self.config,self.state,self.collector,self.writer,self.drafts,self.bridge,self.editorial)
        self.job={'id':str(uuid.uuid4()),'kind':'pauta','text':'Ponte do Pecém recebe vistoria após a chuva','receipt':'a'*64,'editorHash':'b'*64,'lease':str(uuid.uuid4())}
    def test_plain_text_generates_private_draft_and_never_calls_publisher(self):
        result=self.agent.process(self.job);self.assertEqual(result['code'],'draft_ready');self.assertEqual(len(self.saved),1)
        self.editorial.decide.assert_not_called();self.assertIn('/preview',[c.args[0] for c in self.bridge.call.call_args_list])
        self.assertEqual(self.writer.write.call_args.args[0],self.job['text'])
    def test_same_job_replay_does_not_generate_save_or_send_preview_twice(self):
        first=self.agent.process(self.job);second=self.agent.process(self.job)
        self.assertEqual(first,second);self.assertEqual(self.writer.write.call_count,1);self.assertEqual(len(self.saved),1)
    def test_weak_sources_stop_before_writing(self):
        self.collector.manual.return_value=ROWS[:1]
        self.assertEqual(self.agent.process(self.job)['code'],'weak_sources');self.writer.write.assert_not_called();self.assertEqual(len(self.saved),0)
    def test_approval_forwards_signed_exact_revision_without_regenerating(self):
        self.agent.ready=True;job={**self.job,'kind':'approve','draftId':str(uuid.uuid4()),'revision':1,'signature':'c'*64}
        self.editorial.decide.return_value={'url':'https://tomezap.com.br/noticia/pauta-teste/','revision':1,'deploy_requested':True}
        self.editorial.live.return_value=True
        self.assertEqual(self.agent.process(job)['code'],'live');self.editorial.decide.assert_called_once_with(job);self.writer.write.assert_not_called()
    def test_pending_rebuild_is_not_live_and_later_confirmation_notifies_once(self):
        self.agent.ready=True;job={**self.job,'kind':'approve','draftId':str(uuid.uuid4()),'revision':1,'signature':'c'*64}
        self.editorial.decide.return_value={'url':'https://tomezap.com.br/noticia/pauta-teste/','revision':1,'deploy_requested':True}
        self.assertEqual(self.agent.process(job)['code'],'publication_pending')
        self.editorial.live.return_value=True;self.agent.check_deploy()
        self.assertIn('/publication-status',[c.args[0] for c in self.bridge.call.call_args_list]);self.assertEqual(len(list(self.state.client.scan_iter(match=self.agent.prefix+'deploy:*'))),0)
    def test_incomplete_configuration_does_not_use_gemini(self):
        self.agent.config=dataclasses.replace(self.config,gemini_free=False)
        self.assertEqual(self.agent.process(self.job)['code'],'awaiting_configuration');self.writer.write.assert_not_called()
    def test_generation_flag_blocks_a_second_paid_or_quota_call_after_uncertain_response(self):
        self.writer.write.side_effect=AgentError('ambiguous fixture')
        self.assertEqual(self.agent.process(self.job)['code'],'failed');self.assertEqual(self.agent.process(self.job)['code'],'failed');self.assertEqual(self.writer.write.call_count,1)
    def test_lease_callback_carries_only_fixed_code_and_id_not_article_or_secret(self):
        self.bridge.call.side_effect=lambda path,p=None:{'command':self.job} if path=='/commands/claim' else {'ok':True}
        self.assertTrue(self.agent.one());p=next(c.args[1] for c in self.bridge.call.call_args_list if c.args[0]=='/commands/result')
        self.assertEqual(p['id'],self.job['id']);self.assertNotIn('texto',p);self.assertNotIn('signature',p);self.assertEqual(p['code'],'draft_ready')
    def test_network_retry_saves_same_draft_without_a_second_generation(self):
        original=self.drafts.call.side_effect;attempts=0
        def call(p=None,action='context'):
            nonlocal attempts
            if p and p['action']=='save':
                attempts+=1
                if attempts==1:raise AgentError('network fixture',True)
            return original(p,action)
        self.drafts.call.side_effect=call
        with patch('tnn.autonomous.manual.time.sleep'):
            self.assertEqual(self.agent.process(self.job)['code'],'draft_ready')
        self.assertEqual(attempts,2);self.assertEqual(self.writer.write.call_count,1)
    def test_live_probe_requires_expected_domain_and_revision(self):
        net=Mock();net.request.return_value=b'<meta name="tnn-agent-revision" content="1">'
        editorial=Editorial(net=net)
        self.assertFalse(editorial.live({'url':'https://evil.example/','revision':1}));net.request.assert_not_called()
        self.assertTrue(editorial.live({'url':'https://tomezap.com.br/noticia/teste/','revision':1}))
        self.assertFalse(editorial.live({'url':'https://tomezap.com.br/noticia/teste/','revision':2}))
    def test_reject_never_publishes_or_generates(self):
        job={**self.job,'kind':'reject','draftId':str(uuid.uuid4()),'revision':1,'signature':'c'*64}
        self.editorial.decide.return_value={'rejected':True}
        self.assertEqual(self.agent.process(job)['code'],'rejected');self.writer.write.assert_not_called();self.editorial.live.assert_not_called()
    def test_supplied_urls_require_approved_domains_real_dates_and_independent_groups(self):
        public=Mock();now=time.time()
        date=ROWS[0]['published_date']
        def page(url,domains):
            index=0 if 'a.example' in url else 1
            return ('<html><meta property="article:published_time" content="'+date+'"><title>'+ROWS[index]['title']+'</title><article>'+ROWS[index]['content']+'</article></html>').encode()
        public.get.side_effect=page
        collector=Collector(self.config,self.state,public=public);collector.feeds=Mock(return_value=[])
        sources=collector.manual('Pauta https://a.example/news https://b.example/news https://evil.example/a',now)
        self.assertEqual(len(sources),2);self.assertEqual(public.get.call_count,2)
        public.get.return_value=b'<html><title>Fonte sem data</title><p>Texto</p></html>';public.get.side_effect=None
        self.assertEqual(collector.manual('https://a.example/news',now),[])

