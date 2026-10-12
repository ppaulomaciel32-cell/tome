import json
import re
from pathlib import Path
from ..core import AgentError, normalize, parse_article
from ..providers import Gemini

class Writer:
    schema=json.loads(json.dumps(Gemini.response_schema))
    success=schema['anyOf'][0]
    success['properties']['evidencias']={'type':'array','items':{'type':'object','properties':{
        'campo':{'type':'string'},'fonte_id':{'type':'string'},'trecho':{'type':'string'}},
        'required':['campo','fonte_id','trecho'],'additionalProperties':False}}
    success['required'].append('evidencias')
    def __init__(self,gemini=None): self.gemini=gemini or Gemini()
    def write(self,headline,sources):
        raw=self.gemini.generate(Path(__file__).with_name('editorial.txt').read_text(),{'pauta':headline,'fontes':sources},self.schema)
        article=parse_article(raw,sources)
        if not 300<=len(article['texto'].split())<=500: raise AgentError('A redação deve ter de 300 a 500 palavras, sem preencher lacunas com suposições.')
        try:
            evidence=json.loads(raw)['evidencias']
            paragraphs=re.split(r'\n\s*\n',article['texto'])
            fields=['titulo','resumo']+['paragrafo_'+str(i+1) for i in range(len(paragraphs))]
            if len(evidence)!=len(fields): raise ValueError()
            for field in fields:
                matches=[e for e in evidence if e['campo']==field]
                if len(matches)!=1: raise ValueError()
                e=matches[0];source=next(s for s in sources if s['id']==e['fonte_id'])
                if not 20<=len(e['trecho'])<=500 or normalize(e['trecho']) not in normalize(source['content']): raise ValueError()
        except (KeyError,TypeError,ValueError,StopIteration): raise AgentError('A redação não trouxe evidências verificáveis para todos os trechos.') from None
        article.pop('capa_hint',None)
        return {**article,'evidencias':evidence,'fontes':sources}
