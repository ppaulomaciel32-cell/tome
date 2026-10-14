import json
import re
from pathlib import Path
from ..core import AgentError, normalize, parse_article
from ..providers import Gemini

def anchor(excerpt,source):
    """Devolve um trecho literal da fonte (texto ou título) ou None. Nunca aceita paráfrase."""
    if not isinstance(excerpt,str):return None
    haystack=normalize(source['content'])+' \n '+normalize(source['title'])
    if 20<=len(excerpt)<=500 and normalize(excerpt) in haystack:return excerpt
    # O modelo às vezes emenda duas frases: fica só a maior parte que existe na fonte.
    parts=sorted((p.strip() for p in re.split(r'(?<=[.!?;:])\s+|\s+[—–-]\s+|\.\.\.|…',excerpt)),key=len,reverse=True)
    return next((p for p in parts if 20<=len(p)<=500 and normalize(p) in haystack),None)

class Writer:
    schema=json.loads(json.dumps(Gemini.response_schema))
    success=schema['anyOf'][0]
    success['properties']['evidencias']={'type':'array','items':{'type':'object','properties':{
        'campo':{'type':'string'},'fonte_id':{'type':'string'},'trecho':{'type':'string'}},
        'required':['campo','fonte_id','trecho'],'additionalProperties':False}}
    success['required'].append('evidencias')
    def __init__(self,gemini=None): self.gemini=gemini or Gemini()
    @staticmethod
    def mode(sources):
        if len(sources)!=1:return 'multiplas_fontes'
        return 'material_redacao' if sources[0].get('owner') is True else 'fonte_unica_oficial'
    def write(self,headline,sources):
        mode=self.mode(sources)
        # O modelo recebe só o necessário; marcações internas não entram no prompt.
        public=[{k:s[k] for k in ('id','name','title','url','content','published_date')} for s in sources]
        raw=self.gemini.generate(Path(__file__).with_name('editorial.txt').read_text(),{'modo':mode,'pauta':headline[:600],'fontes':public},self.schema)
        article=parse_article(raw,sources)
        # Fonte única rende texto mais curto: melhor curto do que preenchido com suposição.
        lower=300 if mode=='multiplas_fontes' else 150
        if not lower<=len(article['texto'].split())<=500: raise AgentError('A redação ficou fora do tamanho permitido, sem preencher lacunas com suposições.')
        try:
            evidence=json.loads(raw)['evidencias']
            paragraphs=re.split(r'\n\s*\n',article['texto'])
            fields=['titulo','resumo']+['paragrafo_'+str(i+1) for i in range(len(paragraphs))]
            if len(evidence)!=len(fields): raise ValueError()
            for field in fields:
                matches=[e for e in evidence if e['campo']==field]
                if len(matches)!=1: raise ValueError()
                e=matches[0];source=next(s for s in sources if s['id']==e['fonte_id'])
                literal=anchor(e['trecho'],source)
                if not literal: raise ValueError()
                e['trecho']=literal
        except (KeyError,TypeError,ValueError,StopIteration): raise AgentError('A redação não trouxe evidências verificáveis para todos os trechos.') from None
        article.pop('capa_hint',None)
        return {**article,'evidencias':evidence,'fontes':sources}
