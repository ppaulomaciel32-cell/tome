import dataclasses
import json
import os
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
import fakeredis
from tnn.autonomous.collection import Collector,accepted
from tnn.autonomous.config import Config
from tnn.autonomous.store import State
from tnn.autonomous.writer import Writer
from tnn.art import render_story
from PIL import Image
import io

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.now=time.time();self.state=State(fakeredis.FakeRedis(decode_responses=True))
        self.net=Mock();self.public=Mock();self.config=Config(tavily_free=True)
        self.collector=Collector(self.config,self.state,self.public,self.net)
        self.row={'url':'https://www.mpce.mp.br/nota','title':'Contrato em Paracuru será fiscalizado pelo órgão',
            'content':'Documento descreve o processo de contratação e as etapas administrativas. '*5,
            'published_date':time.strftime('%Y-%m-%dT%H:%M:%S+00:00',time.gmtime(self.now))}
    def test_open_search_accepts_new_official_domain_without_downloading_it(self):
        self.net.json.return_value={'results':[self.row]}
        with patch.dict(os.environ,{'TAVILY_API_KEY':'test-only'}):rows=self.collector.search('Paracuru contrato',self.now)
        self.assertTrue(accepted(rows));self.public.get.assert_not_called()
        payload=self.net.json.call_args.args[1]
        self.assertNotIn('include_domains',payload);self.assertEqual(payload['search_depth'],'basic');self.assertFalse(payload['auto_parameters'])
    def test_quota_and_private_or_undated_urls_fail_closed(self):
        self.net.json.return_value={'results':[{**self.row,'url':'https://127.0.0.1/x'},{**self.row,'published_date':None}]}
        with patch.dict(os.environ,{'TAVILY_API_KEY':'test-only'}):self.assertEqual(self.collector.search('Pecém',self.now),[])
        stopped=Collector(dataclasses.replace(self.config,tavily_daily=0),self.state,self.public,self.net)
        self.assertEqual(stopped.search('Pecém',self.now),[]);self.assertEqual(self.net.json.call_count,1)
    def test_monitor_baselines_and_keeps_changed_official_document_without_fictional_url(self):
        with tempfile.NamedTemporaryFile(mode='w',suffix='.json') as file:
            json.dump([{'approved':True,'name':'Prefeitura de Paracuru','url':'https://paracuru.ce.gov.br/licitacoes'}],file);file.flush()
            self.public.get.return_value=b'<p>Lista inicial</p>'
            with patch.dict(os.environ,{'TNN_MONITORS_FILE':file.name}):
                self.assertEqual(self.collector.monitors(self.now),[])
                self.public.get.return_value=('<p>Lista inicial</p><p>Licitação de Paracuru: '+('documento oficial para consulta e conferência dos dados. '*6)+'</p>').encode()
                rows=self.collector.monitors(self.now)
                self.assertEqual(len(rows),1);self.assertTrue(rows[0]['investigative']);self.assertTrue(rows[0]['official'])
                self.assertEqual(rows[0]['url'],'https://paracuru.ce.gov.br/licitacoes')
                self.assertEqual(self.collector.monitors(self.now),rows)

class EditorialOutputTests(unittest.TestCase):
    def test_direct_edit_keeps_exact_text_and_rejects_unsupported_numbers(self):
        from tests.test_autonomous import article,ROWS
        old={**article(),'fontes':ROWS}
        fields={k:old[k] for k in ('titulo','resumo','texto','localidade')}
        new=Writer.direct(old,fields)
        self.assertEqual(new['texto'],old['texto']);self.assertEqual(len(new['evidencias']),6)
        with self.assertRaises(Exception):Writer.direct(old,{**fields,'titulo':'Contrato custa 987654321 reais'})
    def test_story_is_phone_size_under_limit_and_uses_editorial_template(self):
        raw=render_story({'titulo':'Pecém recebe atualização sobre os serviços da região','localidade':'pecem'})
        self.assertLess(len(raw),1500000)
        with Image.open(io.BytesIO(raw)) as image:self.assertEqual(image.size,(1080,1920));self.assertEqual(image.format,'PNG')
