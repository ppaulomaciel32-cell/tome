"""RSS aprovado pelo dono; nenhum redirecionamento ou acesso à rede privada."""
from __future__ import annotations
import hashlib
import http.client
import json
import ipaddress
import re
import socket
import ssl
import time
import unicodedata
import os
import difflib
from pathlib import Path
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from defusedxml import ElementTree
from ..core import AgentError, normalize, required
from ..providers import Net

class TextOnly(HTMLParser):
    def __init__(self): super().__init__(); self.skip=0; self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','nav','footer','header','noscript','svg'): self.skip+=1
        if not self.skip and tag in ('p','br','div','li','h1','h2'): self.parts.append(' ')
    def handle_endtag(self,tag):
        if tag in ('script','style','nav','footer','header','noscript','svg'): self.skip=max(0,self.skip-1)
        if not self.skip: self.parts.append(' ')
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

class PageInfo(HTMLParser):
    def __init__(self):super().__init__();self.title='';self.published='';self.in_title=False
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='title':self.in_title=True
        if tag=='meta':
            name=attrs.get('property') or attrs.get('name')
            if name in ('article:published_time','datePublished','pubdate','date') and not self.published:self.published=attrs.get('content','')
            if name=='og:title':self.title=attrs.get('content','')
        if tag=='time' and not self.published:self.published=attrs.get('datetime','')
    def handle_endtag(self,tag):
        if tag=='title':self.in_title=False
    def handle_data(self,data):
        if self.in_title:self.title+=data

OFFICE=('.gov.br','.leg.br','.jus.br','.mp.br','.def.br')
def public_office(hostname):
    # Domínios reservados a órgãos públicos brasileiros; registro restrito pelo Registro.br.
    return isinstance(hostname,str) and bool(re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+',hostname)) and hostname.endswith(OFFICE)

def page_date(html):
    info=PageInfo();info.feed(html)
    if date(info.published):return info
    # Páginas de órgãos costumam trazer a data só no JSON-LD.
    found=re.search(r'"datePublished"\s*:\s*"([^"]{8,40})"',html)
    if found and date(found.group(1)):info.published=found.group(1)
    return info

LISTING_LINK=re.compile(r'href="(/informa/(\d{1,7})/[a-z0-9-]{3,200})"')
def listing_links(html,limit=5):
    """Notícias mais novas de um portal de prefeitura (padrão /informa/ID/slug)."""
    found={}
    for path,number in LISTING_LINK.findall(html):found.setdefault(path,int(number))
    return [path for path,_ in sorted(found.items(),key=lambda item:item[1],reverse=True)[:limit]]

def printed_date(html):
    """Data impressa na página (dd/mm/aaaa), quando não há metadado. Início do dia em Fortaleza, para nunca cair no futuro."""
    found=re.search(r'(?<![\d/])(\d{2})/(\d{2})/(20\d{2})(?![\d/])',html)
    if not found:return None
    try:return datetime(int(found.group(3)),int(found.group(2)),int(found.group(1)),tzinfo=timezone(timedelta(hours=-3))).astimezone(timezone.utc)
    except ValueError:return None

OWNER_URL='https://tomezap.com.br/sobre/'
def owner_material(text,now):
    """Texto longo colado pelo editor vira material de base, nunca fato conferido pelo robô."""
    body=' '.join(re.sub(r'https://[^\s<>\"]+',' ',text).split())
    if len(body)<400:return None
    # O título aparece na lista pública de fontes; nunca expõe o texto privado do grupo.
    return {'id':'redacao','name':'Material enviado à Redação Tome Nota','publisher_group':'redacao-tome-nota','title':'Informações recebidas pela Redação Tome Nota',
        'url':OWNER_URL,'content':body[:12000],'published_date':datetime.fromtimestamp(now,timezone.utc).isoformat(),'owner':True}

def accepted(sources):
    """Duas fontes independentes, ou uma só quando é oficial ou material do próprio editor."""
    return len(sources)>=2 or (len(sources)==1 and (sources[0].get('official') is True or sources[0].get('owner') is True))

def clean(value):
    p=TextOnly(); p.feed(value or ''); return ' '.join(''.join(p.parts).split())

def canonical(url):
    p=urlsplit(url)
    query=urlencode(sorted((k,v) for k,v in parse_qsl(p.query) if not k.lower().startswith('utm_') and k.lower() not in ('fbclid','gclid')))
    return urlunsplit((p.scheme,p.netloc.lower(),p.path or '/',query,''))

def digest(value): return hashlib.sha256(value.encode()).hexdigest()

def date(value):
    try:
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
    except (ValueError,AttributeError):
        try: d=parsedate_to_datetime(value)
        except (ValueError,TypeError,IndexError): return None
    return d.astimezone(timezone.utc) if d.tzinfo else None

def fresh(value,now,hours=72):
    d=date(value); return bool(d and -300 <= (now-d.timestamp()) <= hours*3600)

def allowed(url,domains):
    try:
        p=urlsplit(url)
        return p.scheme=='https' and p.hostname in domains and not p.username and not p.password and p.port in (None,443)
    except (ValueError,TypeError): return False

class PublicFetch:
    def get(self,url,domains):
        if not allowed(url,domains): raise AgentError('Fonte fora da lista aprovada.')
        p=urlsplit(url)
        try: addresses=socket.getaddrinfo(p.hostname,443,type=socket.SOCK_STREAM)
        except OSError: raise AgentError('Não foi possível consultar uma fonte.',True) from None
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise AgentError('Fonte resolveu para endereço não público.')
        # Conecta ao IP validado, mantendo o hostname original na verificação TLS/SNI.
        address=addresses[0][4][0]
        connection=http.client.HTTPSConnection(p.hostname,timeout=10,context=ssl.create_default_context())
        connection._create_connection=lambda target,timeout,source_address: socket.create_connection((address,443),timeout,source_address)
        try:
            connection.request('GET',urlunsplit(('','',p.path or '/',p.query,'')),headers={'User-Agent':'TomeNotaNews/1.0 (editorial RSS)','Accept-Encoding':'identity'})
            response=connection.getresponse()
            if response.status != 200: raise AgentError('Fonte indisponível ou redirecionada.',response.status>=500 or response.status==429)
            content_type=response.getheader('Content-Type','').lower()
            if not any(t in content_type for t in ('xml','html','text/plain')): raise AgentError('Formato de fonte não aceito.')
            chunks=[];size=0;deadline=time.monotonic()+10
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0: raise AgentError('Tempo limite ao ler a fonte.',True)
                if connection.sock: connection.sock.settimeout(min(10,remaining))
                chunk=response.read1(min(16384,1000001-size))
                if not chunk: break
                chunks.append(chunk);size+=len(chunk)
                if size>1000000: raise AgentError('Fonte acima do limite de leitura.')
            return b''.join(chunks)
        except (OSError,http.client.HTTPException): raise AgentError('Tempo limite ao consultar uma fonte.',True) from None
        finally: connection.close()

STOP=set('para com uma que dos das pelo pela entre sobre como nesta neste sao goncalo amarante ceara pecem taiba croata paracuru prefeitura governo estado municipio regiao feira hoje ontem'.split())
def words(value):
    folded=unicodedata.normalize('NFKD',value).encode('ascii','ignore').decode().lower()
    return {w for w in re.findall(r'[a-z0-9]+',folded) if len(w)>2 and w not in STOP}
def similar(a,b,threshold=.65):
    left,right=words(a),words(b)
    return bool(left and right and len(left&right)/max(1,min(len(left),len(right)))>=threshold and len(left&right)>=3)
LOCAL_TERMS=('sao goncalo do amarante','pecem','taiba','paracuru')
def local_score(title,content=''):
    fold=lambda v:unicodedata.normalize('NFKD',v or '').encode('ascii','ignore').decode().lower()
    t=fold(title);local=any(x in t for x in LOCAL_TERMS)
    # Nota de órgão estadual costuma citar o município só no corpo do texto.
    inside=not local and any(x in fold(content) for x in LOCAL_TERMS)
    regional='ceara' in t or 'cearense' in t
    useful=any(x in t for x in ('agua','saude','escola','ponte','chuva','transito','vagas','edital','vacina'))
    return (10 if local else 6 if inside else 3 if regional else 0)+(2 if useful and (local or inside or regional) else 0)

def parse_feed(raw,source,now):
    try: root=ElementTree.fromstring(raw)
    except Exception: raise AgentError('RSS inválido; fonte ignorada.') from None
    rows=[]
    def tag(node): return node.tag.split('}')[-1].lower()
    for item in (x for x in root.iter() if tag(x) in ('item','entry')):
        if len(rows)>=100: break
        fields={tag(n):n for n in item}
        def val(*keys):
            for key in keys:
                n=fields.get(key)
                if n is not None and n.text: return n.text.strip()
            return ''
        link=val('link')
        for n in item:
            if tag(n)=='link' and n.attrib.get('rel','alternate')=='alternate' and n.attrib.get('href'): link=n.attrib['href'];break
        title=clean(val('title'))[:500]; published=val('pubdate','published','updated','date')
        if not 3<=len(title)<=500 or not allowed(link,source.domains): continue
        content=clean(val('encoded','content','description','summary'))[:12000]
        # Notícia local vale a semana inteira; o restante, três dias.
        if not fresh(published,now) and not (fresh(published,now,168) and local_score(title,content)>=6): continue
        rows.append({'id':source.id,'name':source.name,'publisher_group':source.publisher_group,
            'title':title,'url':canonical(link),'content':content,'published_date':date(published).isoformat(),
            **({'official':True} if source.official else {})})
    return rows

class Collector:
    def __init__(self,config,quota,public=None,net=None): self.config=config;self.quota=quota;self.public=public or PublicFetch();self.net=net or Net()
    def remember(self,url,row=None):
        # Página já lida fica três dias em memória para não ser baixada a cada rodada.
        key='tnn:drafts:v1:page:'+digest(url)
        try:
            if row is None:
                raw=self.quota.client.get(key);return json.loads(raw) if isinstance(raw,(str,bytes)) else None
            self.quota.client.set(key,json.dumps(row,ensure_ascii=False),ex=3*86400)
        except Exception:return None
    def listing(self,source,now):
        page=self.public.get(source.feed_url,source.domains).decode('utf-8',errors='replace')
        origin=urlsplit(source.feed_url);rows=[]
        for path in listing_links(page):
            url=canonical(urlunsplit((origin.scheme,origin.netloc,path,'','')))
            row=self.remember(url)
            if row is None:
                row={}
                try:
                    html=self.public.get(url,source.domains).decode('utf-8',errors='replace');info=page_date(html)
                    when=date(info.published) or printed_date(html);title=' '.join(info.title.split())[:500]
                    if when and 3<=len(title)<=500:
                        row={'id':source.id,'name':source.name,'publisher_group':source.publisher_group,'title':title,'url':url,
                            'content':clean(html)[:12000],'published_date':when.isoformat(),**({'official':True} if source.official else {})}
                except AgentError:continue
                self.remember(url,row)
            # Portal municipal publica pouco: a notícia vale por dez dias.
            if row and fresh(row['published_date'],now,240):rows.append(row)
        return rows
    def feeds(self,now):
        result=[];errors=0
        for source in self.config.sources:
            try: result.extend(self.listing(source,now) if source.listing else parse_feed(self.public.get(source.feed_url,source.domains),source,now))
            except AgentError: errors+=1
        if errors==len(self.config.sources): raise AgentError('Nenhuma fonte aprovada respondeu.',True)
        return sorted(result,key=lambda s:(local_score(s['title'],s['content']),s['published_date']),reverse=True)
    def search(self,query,now,topic='news'):
        """Descoberta aberta pelo Tavily; nunca faz download direto de domínio descoberto."""
        if not self.config.tavily_free or not self.quota.reserve('tavily',self.config.tavily_daily,self.config.tavily_monthly):return []
        result=self.net.json('https://api.tavily.com/search',{'query':query[:500],'topic':topic,'search_depth':'basic',
            'max_results':5,'include_answer':False,'include_images':False,'include_raw_content':'text','auto_parameters':False},
            {'Authorization':'Bearer '+required('TAVILY_API_KEY')},timeout=15,max_bytes=150000)
        rows=[]
        for item in result.get('results',[])[:5]:
            url=item.get('url','')
            try:
                p=urlsplit(url);host=p.hostname
                if not host or not allowed(url,(host,)) or p.fragment or len(url)>1500:continue
                # Sem DNS/download aqui: só texto retornado pelo provedor fixo.
                if host in ('localhost','localhost.localdomain') or not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+',host):continue
                try:
                    if not ipaddress.ip_address(host).is_global:continue
                    continue  # IP literal não identifica um veículo ou órgão.
                except ValueError:pass
            except (ValueError,TypeError):continue
            source=next((s for s in self.config.sources if host in s.domains),None)
            published=item.get('published_date')
            # Datas ausentes não viram "publicado hoje"; busca geral só dá pistas,
            # com data de consulta explícita e sempre em revisão humana.
            if not fresh(published,now,168):continue
            title=clean(str(item.get('title','')))[:500];content=clean(item.get('raw_content') or item.get('content'))[:12000]
            if len(title)<3 or len(content)<160:continue
            group=source.publisher_group if source else re.sub(r'[^a-z0-9]+','-',host.removeprefix('www.'))[:80].strip('-')
            rows.append({'id':source.id if source else 'web-'+digest(host)[:12],
                'name':source.name if source else host,'publisher_group':group,'title':title,'url':canonical(url),
                'content':content,'published_date':date(published).isoformat(),
                **({'official':True} if (source.official if source else public_office(host)) else {})})
        return rows
    def discover(self,now):
        # Alterna localidades e apuração pública, sem 72 buscas pagas por dia.
        places=['São Gonçalo do Amarante Ceará','Pecém Ceará','Taíba Ceará','Croatá São Gonçalo do Amarante','Paracuru Ceará']
        slot=int(now)//self.config.interval
        investigative=slot%3==0
        query=places[slot%len(places)]+(' licitação contrato edital diário oficial MPCE TCE' if investigative else ' notícias')
        rows=self.search(query,now)
        if investigative:
            rows=[dict(r,investigative=True) for r in rows if r.get('official')]
        return rows
    def monitors(self,now):
        """Monitor próprio do jornal: só páginas oficiais previamente aprovadas."""
        path=os.getenv('TNN_MONITORS_FILE','')
        if not path:return []
        try:items=json.loads(Path(path).read_text())
        except (OSError,ValueError):return []
        if not isinstance(items,list) or len(items)>20:return []
        rows=[]
        for item in items:
            if not isinstance(item,dict) or item.get('approved') is not True:continue
            url=item.get('url','');host=urlsplit(url).hostname
            if not public_office(host) or not allowed(url,(host,)) or len(url)>1500:continue
            try:
                body=clean(self.public.get(url,(host,)).decode('utf-8',errors='replace'))[:60000]
                key='tnn:drafts:v1:monitor:'+digest(url);old=self.quota.client.get(key)
                if isinstance(old,bytes):old=old.decode()
                if not old:
                    self.quota.client.set(key,body);continue  # Primeira leitura é referência, não notícia nova.
                if body==old:continue
                additions=' '.join(body[b1:b2] for op,_,_,b1,b2 in difflib.SequenceMatcher(None,old,body,autojunk=False).get_opcodes() if op in ('insert','replace'))
                if len(additions)<160:continue
                title='A apurar: atualização em '+str(item.get('name',host))[:180]
                keywords=('licita','edital','contrat','diário oficial','transparência','pregão')
                if not any(word in additions.lower() for word in keywords):
                    self.quota.client.set(key,body);continue
                # Snapshot só avança após guardar um candidato durável. O hash do
                # conteúdo alterado evita repetir a mesma atualização nos ciclos.
                changed=digest(additions)
                candidate={'id':'monitor-'+digest(url)[:12],'name':str(item.get('name',host))[:100],
                    'publisher_group':re.sub(r'[^a-z0-9]+','-',host)[:80].strip('-'),'title':title,
                    'url':canonical(url), 'content':additions[:12000],'observed_hash':changed,
                    'published_date':datetime.fromtimestamp(now,timezone.utc).isoformat(),'official':True,'investigative':True}
                # Data acima é a consulta do monitor, não a data do fato.
                candidate['content']='Mudança observada pelo monitor; a data do fato exige conferência no documento. '+candidate['content']
                self.quota.client.set(key+':'+changed+':candidate',json.dumps(candidate),ex=3*86400)
                self.quota.client.set(key,body)
            except (AgentError,OSError,ValueError):continue
        # Mantém alterações enquanto a fila estiver cheia ou a rede indisponível.
        for key in list(self.quota.client.scan_iter(match='tnn:drafts:v1:monitor:*:candidate',count=20))[:20]:
            try:rows.append(json.loads(self.quota.client.get(key)))
            except (TypeError,ValueError):pass
        return rows
    def manual(self,text,now):
        # Texto curto do WhatsApp é uma PAUTA, não prova de um acontecimento.
        try: rows=self.feeds(now)
        except AgentError: rows=[]
        query=text[:450]
        matches=[r for r in rows if similar(query,r['title'],.45)]
        stamp=datetime.fromtimestamp(now,timezone.utc).isoformat()
        for url in re.findall(r'https://[^\s<>\"]+',text)[:5]:
            url=url.rstrip('.,;)]')
            source=next((s for s in self.config.sources if allowed(url,s.domains)),None)
            try: host=urlsplit(url).hostname
            except ValueError: continue
            # Link colado pelo editor: fonte aprovada ou domínio reservado a órgão público.
            if not source and not public_office(host):continue
            domains=source.domains if source else (host,)
            try:
                html=self.public.get(url,domains).decode('utf-8',errors='replace');info=page_date(html)
                title=' '.join(info.title.split())
                if not 3<=len(title)<=500:continue
                # Data ausente não bloqueia link escolhido pelo editor; data antiga, sim.
                if date(info.published) and not fresh(info.published,now,168):continue
                group=source.publisher_group if source else re.sub(r'[^a-z0-9]+','-',host).strip('-')[:80]
                matches.insert(0,{'id':source.id if source else ('oficial-'+group)[:50].rstrip('-'),'name':source.name if source else host,'publisher_group':group,'title':title,
                    'url':canonical(url),'content':clean(html)[:12000],'published_date':date(info.published).isoformat() if date(info.published) else stamp,
                    **({'official':True} if (source.official if source else True) else {})})
            except AgentError:continue
        if self.config.tavily_free and len(self.independent(matches))<2:
            try:matches.extend(r for r in self.search(query+' Ceará',now) if similar(query,r['title'],.45))
            except AgentError:pass
        found=self.independent(matches)[:5]
        if accepted(found):return found
        # Sem fonte suficiente na rede, o texto colado pelo editor é o material de base.
        material=owner_material(text,now)
        return [material] if material else found
    def enrich(self,candidate,rows,now):
        matches=[candidate]+[r for r in rows if r['url']!=candidate['url'] and similar(candidate['title'],r['title'])]
        sources=self.independent(matches)
        if len(sources)<2 and self.config.tavily_free:
            try:matches.extend(r for r in self.search(candidate['title']+' Ceará',now) if similar(candidate['title'],r['title']))
            except AgentError:pass
        # Feed curto ganha o texto da página, dentro dos mesmos domínios aprovados.
        for row in matches[:10]:
            if len(row['content'])>=800: continue
            source=next((s for s in self.config.sources if s.id==row['id']),None)
            if not source:continue
            try: row['content']=clean(self.public.get(row['url'],source.domains).decode('utf-8',errors='replace'))[:12000]
            except AgentError: pass
        return self.independent(matches)[:5]
    @staticmethod
    def independent(rows):
        result=[];groups=set()
        for row in rows:
            if row['publisher_group'] in groups or len(row['content'])<160: continue
            # Cópias muito semelhantes não contam como confirmação independente.
            tokens=words(row['content'])
            if any(len(tokens&words(s['content']))/max(1,len(tokens|words(s['content'])))>.85 for s in result): continue
            result.append(row);groups.add(row['publisher_group'])
        return result
