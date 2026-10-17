import json
import os
import re
import unicodedata
from dataclasses import dataclass,field

PLACES={
 'sao-goncalo':('São Gonçalo do Amarante','sao-goncalo'), 'pecem':('Pecém','pecem'),
 'taiba':('Taíba','taiba'),'croata':('Croatá','croata'),'paracuru':('Paracuru','paracuru'),
 **{slug:(name,'regiao') for slug,name in [('fortaleza','Fortaleza'),('caucaia','Caucaia'),('maracanau','Maracanaú'),
 ('aquiraz','Aquiraz'),('eusebio','Eusébio'),('itaitinga','Itaitinga'),('horizonte','Horizonte'),('pacatuba','Pacatuba'),
 ('maranguape','Maranguape'),('ocara','Ocara'),('pindoretama','Pindoretama'),('redencao','Redenção')]}}
PRIORITY=tuple(list(PLACES)[:5])
TRIGGERS=('curiosidade-concreta','espanto','identidade-local','utilidade','prova-social','nostalgia','historia-humana','contraste')

def folded(value):return unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()
def place(value):
    slug=re.sub(r'[^a-z0-9]+','-',folded(str(value))).strip('-')
    if slug in ('sao-goncalo-do-amarante','sga','sao-goncalo-do-amarante-ce'):slug='sao-goncalo'
    return slug if slug in PLACES else None

@dataclass
class Config:
    enabled:bool=False
    intensive:bool=False
    daily:int=12
    tavily_daily:int=18
    gemini_daily:int=12
    global_gemini:int=40
    global_tavily:int=20
    global_tavily_month:int=600
    token:str=''
    draft_token:str=''
    edge:str=''
    sources:dict=field(default_factory=dict)
    @classmethod
    def env(cls,env=None):
        env=os.environ if env is None else env
        enabled=env.get('RADAR_ENABLED')=='true'
        if not enabled:return cls()
        def bound(key,default,maximum):
            v=int(env.get(key,str(default)))
            if not 0<=v<=maximum:raise ValueError('invalid_config')
            return v
        token=env.get('WA_PIPELINE_TOKEN','');draft=env.get('TNN_DRAFT_SERVICE_TOKEN','')
        if not re.fullmatch('[a-f0-9]{64}',token) or not re.fullmatch('[a-f0-9]{64}',draft) or token==draft:raise ValueError('invalid_tokens')
        if env.get('AGENTE_REQUER_APROVACAO')!='true':raise ValueError('approval_required')
        if env.get('GEMINI_FREE_TIER_CONFIRMED')!='true':raise ValueError('free_tier_unconfirmed')
        sources=json.loads(env.get('RADAR_SOURCES','{}'))
        allowed={'official','portals','instagram','web','trends'}
        if not isinstance(sources,dict) or set(sources)-allowed:raise ValueError('invalid_sources')
        for key,rows in sources.items():
            if key=='web':
                if type(rows) is not bool:raise ValueError('invalid_sources')
            elif not isinstance(rows,list) or len(rows)>30:raise ValueError('invalid_sources')
        if (sources.get('web') or sources.get('instagram')) and env.get('TAVILY_FREE_TIER_CONFIRMED')!='true':raise ValueError('free_tier_unconfirmed')
        edge=env.get('TNN_VIRAL_URL','https://dfbeerxqqfqkwlljrjko.supabase.co/functions/v1/tnn-viral')
        if edge!='https://dfbeerxqqfqkwlljrjko.supabase.co/functions/v1/tnn-viral':raise ValueError('invalid_destination')
        return cls(True,env.get('RADAR_CADA_20MIN')=='true',bound('RADAR_MAX_PAUTAS_DIA',12,12),
          bound('RADAR_TAVILY_MAX_CALLS_DIA',18,30),bound('RADAR_GEMINI_MAX_CALLS_DIA',12,40),
          bound('GEMINI_MAX_CALLS_PER_DAY',40,200),bound('TAVILY_MAX_CALLS_PER_DAY',20,30),
          bound('TAVILY_MAX_CALLS_PER_MONTH',600,900),token,draft,edge,sources)
