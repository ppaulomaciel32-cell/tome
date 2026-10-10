from __future__ import annotations
import hashlib
import html
import json
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from urllib.parse import urlsplit

LOCALS = {'sao-goncalo':'São Gonçalo do Amarante','pecem':'Pecém','taiba':'Taíba',
          'croata':'Croatá','paracuru':'Paracuru','regiao':'Região'}

class AgentError(Exception):
    def __init__(self, message, retryable=False):
        super().__init__(message)
        self.retryable = retryable

class AmbiguousSend(AgentError):
    """A Meta pode ter recebido: não reenviar cegamente e duplicar a resposta."""

def required(name):
    value = os.getenv(name, '').strip()
    if not value:
        raise AgentError(f'Configuração ausente: {name}.')
    return value

def normalize(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())

def fingerprint(headline, media_id=''):
    return hashlib.sha256((normalize(headline)+'\0'+media_id).encode()).hexdigest()

def slugify(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii','ignore').decode().lower()
    value = re.sub(r'[^a-z0-9]+','-',value).strip('-')[:230].rstrip('-')
    return value if len(value)>=3 else 'noticia-'+hashlib.sha256(value.encode()).hexdigest()[:10]

def https(value):
    try:
        p=urlsplit(value)
        return p.scheme=='https' and bool(p.hostname) and not p.username and not p.password and not p.fragment
    except (ValueError,TypeError):
        return False

def phone(value):
    value = str(value).strip().removeprefix('+')
    return value if re.fullmatch(r'[1-9][0-9]{7,14}',value) else ''

def clean_error(error):
    # As exceções dos adaptadores já são públicas; nunca incluir corpo HTTP/URL/token.
    return str(error)[:300] if isinstance(error,AgentError) else 'Falha interna; processamento interrompido.'

def parse_article(raw, sources):
    try:
        data=json.loads(raw)
    except (ValueError,TypeError):
        raise AgentError('A IA não retornou JSON válido.') from None
    if not isinstance(data,dict): raise AgentError('Resposta editorial inválida.')
    for key,lower,upper in [('titulo',3,300),('resumo',10,500),('texto',1,40000)]:
        value=data.get(key)
        if not isinstance(value,str) or not lower<=len(value.strip())<=upper:
            raise AgentError(f'Campo editorial inválido: {key}.')
        data[key]=value.strip()
    paragraphs=re.split(r'\n\s*\n',data['texto'])
    if not 4<=len(paragraphs)<=12: raise AgentError('A matéria precisa de 4 a 12 parágrafos.')
    text=' '.join(data[k] for k in ('titulo','resumo','texto'))
    evidence=' '.join(s['content']+' '+s['title'] for s in sources)
    # Bloqueio determinístico de números inexistentes nas fontes. Não substitui apuração.
    unknown=set(re.findall(r'\d+(?:[.,:/-]\d+)*',text))-set(re.findall(r'\d+(?:[.,:/-]\d+)*',evidence))
    if unknown: raise AgentError('A redação contém números ou datas sem suporte nas fontes.')
    if not re.search(r'\b(segundo|conforme|de acordo com)\b',data['texto'],re.I):
        raise AgentError('A matéria não atribuiu as informações às fontes.')
    data['localidade']=data.get('localidade') if data.get('localidade') in LOCALS else 'regiao'
    data['slug']=slugify(data['titulo'])
    data['capa_hint']=str(data.get('capa_hint',''))[:200]
    return {k:data[k] for k in ('slug','titulo','resumo','texto','localidade','capa_hint')}

def preview_html(article, cover_url, sources):
    esc=html.escape
    body=''.join(f'<p>{esc(p)}</p>' for p in re.split(r'\n\s*\n',article['texto']))
    links=''.join(f'<li><a href="{esc(s["url"],quote=True)}" rel="noopener noreferrer">{esc(s["title"])}</a></li>' for s in sources)
    image=f'<img src="{esc(cover_url,quote=True)}" alt="{esc(article["titulo"],quote=True)}" width="1600" height="900">' if https(cover_url) else ''
    return f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Preview | Tome Nota News</title><style>body{{font:18px/1.7 system-ui;margin:0;background:#eef2f7;color:#10243b}}main{{max-width:800px;margin:30px auto;background:white;padding:30px}}img{{max-width:100%;height:auto}}h1{{line-height:1.15}}.notice{{color:#7c3c00}}a{{color:#144b89}}</style></head><body><main><p class="notice">Prévia privada e temporária. Ainda pode receber correções.</p><p>TOME NOTA NEWS · {esc(LOCALS[article['localidade']])}</p><h1>{esc(article['titulo'])}</h1><p>{esc(article['resumo'])}</p>{image}{body}<h2>Fontes consultadas</h2><ul>{links}</ul></main></body></html>'''

@dataclass
class Settings:
    require_approval: bool=False
    public_url: str=''
    site_url: str='https://tome-nota-publico.onrender.com'
    grace_seconds: int=5
    build_wait_seconds: int=180
    @classmethod
    def env(cls):
        return cls(os.getenv('AGENTE_REQUER_APROVACAO','false').lower()=='true',
            os.getenv('AGENT_PUBLIC_URL','').rstrip('/'),os.getenv('SITE_URL',cls.site_url).rstrip('/'),
            int(os.getenv('AUTO_PUBLISH_GRACE_SECONDS','5')),int(os.getenv('BUILD_WAIT_SECONDS','180')))
