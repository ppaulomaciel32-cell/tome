import json
import re
from pathlib import Path
from ..core import AgentError, normalize, parse_article, slugify
from ..providers import Gemini, editorial_engine

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
    # LLM_PROVIDER=omniroute usa o OmniRoute com o Gemini de reserva; sem a variável, só o Gemini.
    def __init__(self,gemini=None): self.gemini=gemini or editorial_engine()
    @staticmethod
    def mode(sources):
        if len(sources)!=1:return 'multiplas_fontes'
        return 'material_redacao' if sources[0].get('owner') is True else 'fonte_unica_oficial'
    def write(self,headline,sources):
        return self.produce({'pauta':headline[:600]},sources)
    def correct(self,old,instruction):
        """Reescreve um rascunho a pedido do editor, com as mesmas fontes e as mesmas travas."""
        previous={k:old[k] for k in ('titulo','resumo','texto','localidade')}
        return self.produce({'pauta':old['titulo'][:600],'versao_anterior':previous,'correcao_solicitada':' '.join(str(instruction).split())[:1500]},old['fontes'])
    def produce(self,request,sources):
        mode=self.mode(sources)
        # O modelo recebe só o necessário; marcações internas não entram no prompt.
        public=[{k:s[k] for k in ('id','name','title','url','content','published_date')} for s in sources]
        investigation=any(s.get('investigative') for s in sources)
        prompt=Path(__file__).with_name('editorial.txt').read_text()
        if investigation:
            prompt+='\nPAUTA A APURAR: título começa com "A apurar:". Separe no corpo "O que está documentado" e "O que falta confirmar". Não faça acusações nem conclua irregularidade a partir de edital, contrato ou mudança de página. Cada fato deve apontar documento e órgão. O que falta confirmar deve ser pergunta, nunca hipótese apresentada como fato.'
        # tarefa/investigativa: o combo do OmniRoute troca o prompt do robô, então a regra vai no pedido.
        task={'tarefa':'corrigir_materia' if 'versao_anterior' in request else 'redigir_materia',**({'investigativa':True} if investigation else {})}
        raw=self.gemini.generate(prompt,{**task,'modo':mode,**request,'fontes':public},self.schema)
        article=parse_article(raw,sources)
        if investigation and (not article['titulo'].lower().startswith('a apurar:') or not all(s in article['texto'].lower() for s in ('o que está documentado','o que falta confirmar'))):
            raise AgentError('Pauta investigativa precisa separar documentos e perguntas ainda sem confirmação.')
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
    @staticmethod
    def direct(old,fields):
        """Texto exato do editor, sem LLM. Gera nova prévia e exige outra aprovação."""
        from .collection import words
        if not isinstance(fields,dict):raise AgentError('Texto de edição inválido.')
        sizes={'titulo':(3,300),'resumo':(10,500),'texto':(100,20000)}
        for key,(lower,upper) in sizes.items():
            value=fields.get(key)
            if not isinstance(value,str) or not lower<=len(value.strip())<=upper or re.search(r'[<>\x00-\x08\x0b-\x1f]',value):raise AgentError('Confira os campos do texto.')
        if fields.get('localidade') not in ('sao-goncalo','pecem','taiba','croata','paracuru','regiao'):raise AgentError('Localidade inválida.')
        paragraphs=re.split(r'\n\s*\n',fields['texto'].strip())
        lower=150 if len(old['fontes'])==1 else 300
        if not 4<=len(paragraphs)<=12 or not lower<=len(fields['texto'].split())<=500:raise AgentError('Mantenha 4 a 12 parágrafos e o tamanho editorial.')
        source_text=' '.join(s['title']+' '+s['content'] for s in old['fontes'])
        numbers=lambda x:set(re.findall(r'\d+(?:[.,:/-]\d+)*',x))
        if numbers(' '.join(fields[k] for k in sizes))-numbers(source_text):raise AgentError('Número ou data sem suporte nas fontes.')
        evidence=[]
        chunks=[(s['id'],part.strip()) for s in old['fontes'] for part in re.split(r'(?<=[.!?;])\s+',s['content']+' '+s['title']) if 20<=len(part.strip())<=500]
        if not chunks:raise AgentError('Confira as fontes antes de editar.')
        for key,value in [('titulo',fields['titulo']),('resumo',fields['resumo'])]+[('paragrafo_'+str(i+1),p) for i,p in enumerate(paragraphs)]:
            source,excerpt=max(chunks,key=lambda pair:len(words(pair[1])&words(value)))
            evidence.append({'campo':key,'fonte_id':source,'trecho':excerpt})
        return {**{k:fields[k].strip() for k in (*sizes,'localidade')},'slug':slugify(fields['titulo']),
            'fontes':old['fontes'],'evidencias':evidence}
    @staticmethod
    def retitle(old,title):
        """Manchete escrita pelo editor: sem IA, mas sem número que as fontes não tragam."""
        title=' '.join(str(title).split()).strip(' "“”')
        if not 3<=len(title)<=300: raise AgentError('A manchete precisa ter de 3 a 300 caracteres.')
        evidence=' '.join(s['content']+' '+s['title'] for s in old['fontes'])
        pattern=r'\d+(?:[.,:/-]\d+)*'
        if set(re.findall(pattern,title))-set(re.findall(pattern,evidence)): raise AgentError('A manchete traz número ou data que não está nas fontes.')
        return {'slug':slugify(title),'titulo':title,'resumo':old['resumo'],'texto':old['texto'],'localidade':old['localidade'],
            'evidencias':old['evidencias'],'fontes':old['fontes']}
