import json
import os
import re
from pathlib import Path
from tnn.providers import Net,OmniRoute,fallback_allowed
from tnn.core import AgentError,gemini_model,required
from .config import TRIGGERS,folded,PLACES
from .sources import forbidden

FIELDS=('gatilho','titulos','hook','angulo','potencial','score_justificativa','evidencia')
class Editor:
    def __init__(self,net=None):self.net=net or Net();self.tokens=0
    def write(self,source,instruction=''):
        schema={'type':'object','properties':{'eligible':{'type':'boolean'},'gatilho':{'type':'string','enum':list(TRIGGERS)},
          'titulos':{'type':'array','items':{'type':'string'}},'hook':{'type':'string'},'angulo':{'type':'string'},
          'potencial':{'type':'integer'},'score_justificativa':{'type':'string'},'evidencia':{'type':'string'}},'required':['eligible']}
        prompt=Path(__file__).with_name('editorial.txt').read_text()
        data={'tarefa':'radar_angulo','fonte':source,'cidade':PLACES[source['cidade_detectada']][0],'correcao':instruction}
        if os.getenv('LLM_PROVIDER','gemini')=='omniroute':
            # Mesmas travas de sempre; se o OmniRoute falhar, segue para o Gemini.
            client=OmniRoute()
            try:
                raw=json.loads(client.generate(prompt,data,schema,0.4));self.tokens=client.tokens
                return self.validate(raw,source)
            except AgentError as exc:
                if not fallback_allowed():raise AgentError('editor_invalid_output') from None
                print(json.dumps({'event':'llm_fallback','from':'omniroute','reason':type(exc).__name__}),flush=True)
        payload={'systemInstruction':{'parts':[{'text':prompt}]},
          'contents':[{'role':'user','parts':[{'text':json.dumps(data,ensure_ascii=False)}]}],
          'generationConfig':{'temperature':0.4,'maxOutputTokens':1500,'candidateCount':1,'responseFormat':{'text':{'mimeType':'APPLICATION_JSON','schema':schema}}}}
        data=self.net.json('https://generativelanguage.googleapis.com/v1beta/models/'+gemini_model()+':generateContent',payload,
          {'x-goog-api-key':required('GEMINI_API_KEY')},timeout=45,max_bytes=40000)
        self.tokens=int(data.get('usageMetadata',{}).get('totalTokenCount',0))
        try:
            candidate=data['candidates'][0]
            if candidate.get('finishReason')!='STOP':raise ValueError()
            raw=json.loads(''.join(p.get('text','') for p in candidate['content']['parts'] if not p.get('thought')))
        except (ValueError,TypeError,KeyError,IndexError):raise AgentError('editor_invalid_output') from None
        return self.validate(raw,source)
    @staticmethod
    def validate(raw,source):
        if not isinstance(raw,dict) or raw.get('eligible') is not True:return None
        try:
            result={k:raw[k] for k in FIELDS}
            if result['gatilho'] not in TRIGGERS or type(result['potencial']) is not int or not 7<=result['potencial']<=10:return None
            if not isinstance(result['titulos'],list) or len(result['titulos'])!=3 or len(set(result['titulos']))!=3:return None
            if any(not isinstance(t,str) or not 3<=len(t)<=180 or len(t.split())>12 for t in result['titulos']):return None
            for key,bounds in [('hook',(10,500)),('angulo',(10,500)),('score_justificativa',(5,300)),('evidencia',(20,500))]:
                if not isinstance(result[key],str) or not bounds[0]<=len(result[key])<=bounds[1]:return None
            original=source['titulo']+' '+source['trecho'];all_text=' '.join(result['titulos'])+' '+result['hook']+' '+result['angulo']
            if any(re.search(r'[<>\x00-\x1f]',str(result[k])) for k in FIELDS):return None
            if forbidden(all_text) or folded(result['evidencia']) not in folded(original):return None
            numbers=lambda s:set(re.findall(r'\d+(?:[.,:/-]\d+)*',s))
            if numbers(all_text)-numbers(original):return None
            if re.search(r'cidade inteira|todo mundo|ninguem acredita|esta bombando',folded(all_text)):return None
            if not any(folded(PLACES[source['cidade_detectada']][0]) in folded(t) for t in result['titulos']):return None
            return result
        except (KeyError,TypeError):return None
