import re
import time
import ipaddress
from urllib.parse import urlsplit
from tnn.autonomous.collection import PublicFetch,parse_feed,date,fresh,clean,canonical,public_office,Collector
from tnn.autonomous.config import Source
from defusedxml import ElementTree
from tnn.core import AgentError
from tnn.providers import Net
from .config import PLACES,PRIORITY,folded
from .state import digest

def safe_url(value):
    try:
        p=urlsplit(value)
        try:ipaddress.ip_address(p.hostname or '');return False
        except ValueError:pass
        return p.scheme=='https' and not p.username and not p.password and not p.fragment and not p.port and bool(re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+',p.hostname or '')) and len(value)<=1500
    except (ValueError,TypeError):return False

def city_in(text,city):
    value=folded(text);name=folded(PLACES[city][0])
    if city=='croata':return 'croata' in value and ('sao goncalo' in value or 'distrito' in value)
    if city=='sao-goncalo':return 'sao goncalo do amarante' in value and ('ceara' in value or 'ce-' in value or 'pecem' in value or 'taiba' in value)
    return bool(re.search(r'\b'+re.escape(name)+r'\b',value))

def forbidden(text):
    text=folded(text)
    # Contexto neutro/prevenção não apaga outra ocorrência grave no mesmo texto.
    hard=r'\b(facc(?:ao|oes)|crime organizado|morte[s]?|morreu|morreram|morto[s]?|morta[s]?|assassin\w*|homicid\w*|afogamento|afogado\w*|bala perdida|acidente fatal|tiroteio|latrocin\w*|obito[s]?|vitima fatal|perdeu a vida|nao resistiu|trag(?:edia|ico)\w*|luto|agredid[oa]s?|agrediu|esfaquead\w*|espancad\w*)\b'
    if re.search(hard,text):return True
    # O caso "violência zero" segue para a classificação contextual do mesmo LLM.
    return False

def media_candidates(raw):
    """Só referência à imagem do feed; não baixa nem presume licença de uso."""
    result={}
    try:
        root=ElementTree.fromstring(raw)
        for item in list(root.iter('item'))[:100]:
            link=item.findtext('link');url=None
            for child in item:
                if child.tag.split('}')[-1] in ('content','thumbnail','enclosure'):
                    value=child.attrib.get('url','')
                    if safe_url(value) and (child.attrib.get('type','').startswith('image/') or child.tag.split('}')[-1]=='thumbnail'):url=value;break
            if link and url and safe_url(link):result[canonical(link)]=url
    except Exception:pass
    return result

class Sources:
    def __init__(self,config,store,net=None,public=None):self.c=config;self.store=store;self.net=net or Net();self.public=public or PublicFetch()
    def normalize(self,item,origin,cities,now,hours):
        url=item.get('url','');title=clean(str(item.get('title','')))[:500]
        body=clean(item.get('raw_content') or item.get('content') or '')[:12000]
        stamp=item.get('published_date','')
        if not safe_url(url) or not 3<=len(title)<=500 or len(body)<160 or not fresh(stamp,now,hours):return None
        if origin=='instagram' and not (urlsplit(url).hostname=='instagram.com' or urlsplit(url).hostname.endswith('.instagram.com')):return None
        detected=next((c for c in cities if city_in(title+' '+body,c)),None)
        if not detected:return None
        return {'titulo':title,'url':canonical(url),'trecho':body,'data':date(stamp).isoformat(),
            'origem':origin,'cidade_detectada':detected,'cover_candidato':None,
            'hash':digest(folded(title)+'|'+urlsplit(url).hostname.removeprefix('www.'))}
    def search(self,query,origin,cities,now,hours):
        if time.monotonic()>getattr(self,'deadline',float('inf'))-15:return []
        if not self.store.reserve('tavily',self.c.tavily_daily,self.c.global_tavily,self.c.global_tavily_month):return []
        data=self.net.json('https://api.tavily.com/search',{'query':query[:500],'topic':'news','time_range':'day','search_depth':'basic','max_results':5,
            'include_raw_content':'text','include_answer':False,'include_images':False,'auto_parameters':False},
            {'Authorization':'Bearer '+__import__('os').environ.get('TAVILY_API_KEY','')},timeout=15,max_bytes=150000)
        return [row for item in data.get('results',[])[:5] if (row:=self.normalize(item,origin,cities,now,hours))]
    def collect(self,job,now):
        self.deadline=time.monotonic()+125
        cities=[job['city']] if job.get('city') else list(PLACES)
        active=[c for c in cities if not self.store.client.get(self.store.prefix+'city:'+c)]
        if not active:return []
        hours=36 if job['turno']=='manha' else 24;rows=[]
        for kind in ('official','portals','trends'):
            for index,item in enumerate(self.c.sources.get(kind,[])):
                if time.monotonic()>self.deadline-10:break
                try:
                    url=item['url'];host=urlsplit(url).hostname
                    if not safe_url(url) or (kind=='official' and not public_office(host)) or (kind=='trends' and host!='trends.google.com'):continue
                    # Feed HTTPS aprovado; DNS pinado, sem redirects/rede privada.
                    source=Source('viral-'+str(index),str(item.get('name',host))[:100],url,(host,),host,kind=='official')
                    if item.get('kind')=='listing' and kind in ('official','portals'):
                        incoming=Collector(None,self.store.shared,public=self.public,net=self.net).listing(source,now);images={}
                    else:
                        raw=self.public.get(url,(host,));incoming=parse_feed(raw,source,now);images=media_candidates(raw)
                    for row in incoming:
                        candidate=self.normalize(row,kind,active,now,hours)
                        if candidate:
                            candidate['cover_candidato']=images.get(candidate['url'])
                            # Trends é pista, nunca fonte factual suficiente para redigir.
                            candidate['lead_only']=kind=='trends';rows.append(candidate)
                except (AgentError,KeyError,TypeError,ValueError):continue
        if self.c.sources.get('web'):
            for c in [x for x in PRIORITY if x in active]:
                query=PLACES[c][0]+(' distrito São Gonçalo do Amarante' if c in ('croata','pecem','taiba') else '')+' Ceará notícias serviços cultura educação'
                try:rows+=self.search(query,'web',[c],now,hours)
                except AgentError:continue
            rest=[c for c in active if c not in PRIORITY]
            if rest:
                try:rows+=self.search('Ceará notícias '+ ' OR '.join('"'+PLACES[c][0]+'"' for c in rest),'web',rest,now,hours)
                except AgentError:pass
        profiles=self.c.sources.get('instagram',[])
        if profiles:
            query='site:instagram.com '+ ' OR '.join(str(p)[:80] for p in profiles[:5])+' Ceará '+ ' '.join(PLACES[c][0] for c in active[:5])
            try:rows+=self.search(query,'instagram',active,now,hours)
            except AgentError:pass
        unique={}
        for row in rows:
            if row['hash'] not in unique and not row.get('lead_only'):unique[row['hash']]=row
        return sorted(unique.values(),key=lambda r:(r['cidade_detectada'] in PRIORITY,r['data']),reverse=True)
