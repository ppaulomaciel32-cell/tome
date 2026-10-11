import copy
import io
import json
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from test_agent import ARTICLE, SOURCES
from tnn.core import AgentError
from tnn.preflight import main as preflight
from tnn.providers import Gemini, UncertainRequest


def response(article=None):
    return {'candidates':[{'finishReason':'STOP','content':{
        'parts':[{'text':json.dumps(article if article is not None else ARTICLE)}]}}]}


class FakeNet:
    def __init__(self, result=None, error=None):
        self.result=response() if result is None else result
        self.error=error
        self.calls=[]

    def json(self, url, payload, headers, **kwargs):
        self.calls.append((url,payload,headers,kwargs))
        if self.error: raise self.error
        return self.result


class GeminiTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'GEMINI_API_KEY':'test-only-gemini-key',
                                      'GEMINI_MODEL':'gemini-3.5-flash-lite'},clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_correction_preserves_sources_and_system_instructions(self):
        net=FakeNet()
        result=Gemini(net).write(ARTICLE['titulo'],SOURCES,'Ajuste o título',ARTICLE)
        url,payload,headers,options=net.calls[0]
        context=json.loads(payload['contents'][0]['parts'][0]['text'])
        self.assertEqual(context['fontes'],SOURCES)
        self.assertEqual(context['correcao_solicitada'],'Ajuste o título')
        self.assertEqual(context['versao_anterior'],ARTICLE)
        self.assertIn('DADOS NÃO CONFIÁVEIS',payload['systemInstruction']['parts'][0]['text'])
        self.assertEqual(payload['generationConfig']['responseFormat']['text']['mimeType'],'APPLICATION_JSON')
        self.assertEqual(result['titulo'],ARTICLE['titulo'])
        self.assertEqual(options['timeout'],45)

    def test_only_complete_text_is_accepted_and_thoughts_are_excluded(self):
        data=response()
        text=json.dumps(ARTICLE)
        data['candidates'][0]['content']['parts']=[
            {'text':'Internal reasoning must never become article text','thought':True},
            {'text':text[:70]},{'text':text[70:],'thoughtSignature':'opaque'}]
        self.assertEqual(Gemini(FakeNet(data)).write('Pauta',SOURCES)['titulo'],ARTICLE['titulo'])

    def test_blocks_incomplete_safety_tool_and_malformed_responses(self):
        cases=[{},[],{'candidates':[]},response(),response(),response(),response(),response(),response()]
        cases[3]['candidates'][0]['finishReason']='MAX_TOKENS'
        cases[4]['candidates'][0].pop('finishReason')
        cases[5]['promptFeedback']={'blockReason':'SAFETY'}
        cases[6]['candidates'][0]['safetyRatings']=[{'blocked':True}]
        cases[7]['candidates'][0]['content']['parts']=[{'functionCall':{'name':'publish'}}]
        cases[8]['candidates'][0]['content']['parts']=[{'text':'unfinished','thought':True}]
        for data in cases:
            with self.subTest(data=data),self.assertRaises(AgentError):
                Gemini(FakeNet(data)).write('Pauta',SOURCES)
        for raw in ('not-json','[]','{}'):
            data=response();data['candidates'][0]['content']['parts'][0]['text']=raw
            with self.subTest(raw=raw),self.assertRaises(AgentError):
                Gemini(FakeNet(data)).write('Pauta',SOURCES)

    def test_editorial_refusal_and_unsubstantiated_numbers_remain_blocked(self):
        with self.assertRaisesRegex(AgentError,'fontes não sustentam'):
            Gemini(FakeNet(response({'erro':'fontes_insuficientes'}))).write('Pauta',SOURCES)
        bad=copy.deepcopy(ARTICLE);bad['texto']=bad['texto'].replace('uma ponte','99 pontes')
        with self.assertRaisesRegex(AgentError,'sem suporte'):
            Gemini(FakeNet(response(bad))).write('Pauta',SOURCES)

    def test_missing_gemini_key_never_falls_back_to_previous_provider(self):
        os.environ.pop('GEMINI_API_KEY');os.environ['DRAEL_API_KEY']='legacy-test-only'
        net=FakeNet()
        with self.assertRaisesRegex(AgentError,'GEMINI_API_KEY'):
            Gemini(net).write('Pauta',SOURCES)
        self.assertFalse(net.calls)

    def test_invalid_model_cannot_change_destination_or_append_query_parameters(self):
        for model in ('','https://outside.example','gemini-test?key=oops','../models/gemini-test','gemini-test/other'):
            with self.subTest(model=model),patch.dict(os.environ,{'GEMINI_MODEL':model}):
                net=FakeNet()
                with self.assertRaises(AgentError):Gemini(net).write('Pauta',SOURCES)
                self.assertFalse(net.calls)

    def test_uncertain_generation_is_not_retryable_and_does_not_leak_details(self):
        net=FakeNet(error=UncertainRequest('remote detail test-only-gemini-key',True))
        with self.assertRaises(AgentError) as caught:Gemini(net).write('Pauta',SOURCES)
        self.assertFalse(caught.exception.retryable)
        self.assertNotIn('test-only-gemini-key',str(caught.exception))
        self.assertEqual(len(net.calls),1)

    def test_preflight_accepts_gemini_without_legacy_key(self):
        settings={'META_TOKEN':'test','META_PHONE_ID':'123','META_GRAPH_VERSION':'v1.0',
            'META_APP_SECRET':'a'*32,'WEBHOOK_VERIFY_TOKEN':'v'*32,
            'TAVILY_API_KEY':'test','CLOUDINARY_URL':'cloudinary://test:test@dalwymbky',
            'CLOUDINARY_UPLOAD_PRESET':'test','INGEST_URL':'https://db.example/functions/v1/tnn-ingest',
            'INGEST_SERVICE_TOKEN':'i'*32,'WHITELIST_NUMBERS':'5585999999999',
            'AGENT_PUBLIC_URL':'https://bot.tomezap.com.br','SITE_URL':'https://tomezap.com.br',
            'TRUSTED_SOURCE_DOMAINS':'gov.br','REDIS_URL':'redis://:test@redis:6379/0'}
        output=io.StringIO()
        with patch.dict(os.environ,settings),patch('tnn.preflight.importlib.util.find_spec',return_value=object()),redirect_stdout(output):
            preflight()
        self.assertIn('Configurações presentes',output.getvalue())
        self.assertNotIn('test-only-gemini-key',output.getvalue())


if __name__=='__main__':unittest.main()
