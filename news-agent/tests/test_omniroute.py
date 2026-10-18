import io
import json
import os
import socket
import unittest
from unittest.mock import Mock, patch

from tnn.core import AgentError
from tnn.providers import Gemini, OmniRoute, Redator, UncertainRequest, editorial_engine, omniroute_url
from tnn.autonomous.writer import Writer


def completion(text, finish='stop'):
    return json.dumps({'choices':[{'finish_reason':finish,'message':{'role':'assistant','content':text,
        'reasoning_content':'pensamento interno'}}],'usage':{'total_tokens':1234}}).encode()


class Answer(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self,*a): return False


class FakeOpener:
    """Simula o OmniRoute: cada item é um corpo de resposta ou uma exceção."""
    def __init__(self,*answers): self.answers=list(answers);self.requests=[]
    def open(self,request,timeout):
        self.requests.append((request,timeout))
        answer=self.answers.pop(0)
        if isinstance(answer,Exception): raise answer
        return Answer(answer)


ENV={'OMNIROUTE_API_KEY':'test-only-omniroute-key','OMNIROUTE_URL':'http://omniroute:20128/v1',
     'OMNIROUTE_MODEL':'tomenota-editorial','GEMINI_API_KEY':'test-only-gemini-key'}


class OmniRouteTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,ENV);self.env.start();self.addCleanup(self.env.stop)
        os.environ.pop('LLM_FALLBACK',None);os.environ.pop('LLM_PROVIDER',None)

    def test_sends_combo_key_json_mode_and_disables_compression(self):
        opener=FakeOpener(completion('```json\n{"erro":"fontes_insuficientes"}\n```'))
        client=OmniRoute(opener)
        self.assertEqual(client.generate('prompt',{'pauta':'Teste'},None),'{"erro":"fontes_insuficientes"}')
        request,timeout=opener.requests[0];body=json.loads(request.data)
        self.assertEqual(request.full_url,'http://omniroute:20128/v1/chat/completions')
        self.assertEqual(request.get_header('Authorization'),'Bearer test-only-omniroute-key')
        self.assertEqual(request.get_header('X-omniroute-compression'),'off')
        self.assertEqual((body['model'],body['stream'],body['response_format']),('tomenota-editorial',False,{'type':'json_object'}))
        self.assertEqual(json.loads(body['messages'][1]['content']),{'pauta':'Teste'})
        self.assertEqual((timeout,client.tokens),(120,1234))

    def test_broken_answer_is_retried_once_then_reported(self):
        opener=FakeOpener(completion('{"{""',finish='length'),completion('{"titulo":"ok"}'))
        self.assertEqual(OmniRoute(opener).generate('p',{},None),'{"titulo":"ok"}')
        opener=FakeOpener(completion('texto solto'),completion('[1,2]'))
        with self.assertRaisesRegex(AgentError,'JSON completo'):OmniRoute(opener).generate('p',{},None)
        self.assertEqual(opener.answers,[])

    def test_timeout_is_not_repeated_and_missing_key_fails_closed(self):
        opener=FakeOpener(socket.timeout(),completion('{}'))
        with self.assertRaises(UncertainRequest):OmniRoute(opener).generate('p',{},None)
        self.assertEqual(len(opener.requests),1)
        os.environ.pop('OMNIROUTE_API_KEY')
        with self.assertRaisesRegex(AgentError,'OMNIROUTE_API_KEY'):OmniRoute(FakeOpener()).generate('p',{},None)

    def test_plain_http_only_inside_docker_network(self):
        for good in ('http://omniroute:20128/v1','https://ia.example.com/v1'):
            with patch.dict(os.environ,{'OMNIROUTE_URL':good}):self.assertEqual(omniroute_url(),good)
        for bad in ('http://ia.example.com/v1','http://user:x@omniroute:20128/v1','ftp://omniroute/v1','http://omniroute:20128/v1?x=1'):
            with patch.dict(os.environ,{'OMNIROUTE_URL':bad}),self.assertRaises(AgentError):omniroute_url()

    def test_failure_falls_back_to_gemini_unless_disabled(self):
        primary=Mock();primary.generate.side_effect=UncertainRequest('fora',True)
        backup=Mock();backup.generate.return_value='{"erro":"fontes_insuficientes"}'
        with patch('sys.stdout',new_callable=io.StringIO) as out:
            self.assertEqual(Redator(primary,backup).generate('p',{'a':1},{}),'{"erro":"fontes_insuficientes"}')
        self.assertIn('llm_fallback',out.getvalue());self.assertNotIn('test-only',out.getvalue())
        backup.generate.assert_called_once_with('p',{'a':1},{})
        with patch.dict(os.environ,{'LLM_FALLBACK':'off'}),self.assertRaises(UncertainRequest):Redator(primary,backup).generate('p',{},{})
        os.environ.pop('GEMINI_API_KEY')
        with self.assertRaises(UncertainRequest):Redator(primary,backup).generate('p',{},{})
        self.assertEqual(backup.generate.call_count,1)

    def test_provider_switch_defaults_to_gemini(self):
        self.assertIsInstance(editorial_engine(),Gemini)
        with patch.dict(os.environ,{'LLM_PROVIDER':'omniroute'}):self.assertIsInstance(editorial_engine(),Redator)

    def test_writer_tells_the_combo_which_task_and_investigation_rule(self):
        fake=Mock();fake.generate.side_effect=AgentError('parar aqui')
        source={'id':'a','name':'Órgão','title':'Título','url':'https://orgao.example/a','content':'Texto','published_date':'','investigative':True}
        with self.assertRaises(AgentError):Writer(fake).write('Pauta',[source])
        sent=fake.generate.call_args.args[1]
        self.assertEqual((sent['tarefa'],sent['investigativa']),('redigir_materia',True))
        self.assertNotIn('investigative',sent['fontes'][0])
        old={'titulo':'T','resumo':'R','texto':'X','localidade':'regiao','fontes':[{**source,'investigative':False}]}
        with self.assertRaises(AgentError):Writer(fake).correct(old,'mais curto')
        sent=fake.generate.call_args.args[1]
        self.assertEqual(sent['tarefa'],'corrigir_materia');self.assertNotIn('investigativa',sent)


if __name__=='__main__':
    unittest.main()
