from __future__ import annotations
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from ..core import AgentError

@dataclass(frozen=True)
class Source:
    id: str
    name: str
    feed_url: str
    domains: tuple[str, ...]
    publisher_group: str

@dataclass(frozen=True)
class Config:
    enabled: bool = False
    gemini_free: bool = False
    tavily_free: bool = False
    interval: int = 1200
    max_pending: int = 5
    gemini_daily: int = 20
    tavily_daily: int = 20
    tavily_monthly: int = 600
    sources: tuple[Source, ...] = ()
    age_hours: int = 72

    @classmethod
    def env(cls):
        if os.getenv('AGENTE_REQUER_APROVACAO') != 'true':
            raise AgentError('O ciclo exige aprovação humana. Configure AGENTE_REQUER_APROVACAO=true.')
        if os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite') != 'gemini-3.5-flash-lite':
            raise AgentError('Este ciclo usa somente o modelo Gemini revisado para a cota gratuita.')
        def bounded(key, default, lower, upper):
            try: value = int(os.getenv(key, str(default)))
            except ValueError: raise AgentError(f'Configuração inválida: {key}.') from None
            if not lower <= value <= upper: raise AgentError(f'Configuração fora do limite: {key}.')
            return value
        path = os.getenv('RSS_SOURCES_FILE', '/app/config/sources.json')
        try: data = json.loads(Path(path).read_text())
        except FileNotFoundError: data = []
        except (ValueError, OSError): raise AgentError('A lista de fontes não pôde ser lida.') from None
        if not isinstance(data, list) or len(data) > 10: raise AgentError('Configure até dez fontes RSS aprovadas.')
        sources = []
        for row in data:
            if not isinstance(row, dict): raise AgentError('Fonte RSS inválida.')
            if row.get('approved') is not True: continue
            try:
                domains = tuple(str(x).lower() for x in row['domains'])
                url = urlsplit(row['feed_url'])
                if not domains or any(not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', d) for d in domains): raise ValueError()
                if url.scheme != 'https' or url.hostname not in domains or url.username or url.password or url.port not in (None,443) or url.fragment: raise ValueError()
                if not re.fullmatch(r'[a-z0-9-]{2,50}', row['id']) or not re.fullmatch(r'[a-z0-9-]{2,80}', row['publisher_group']): raise ValueError()
                name = str(row['name']).strip()
                if not 2 <= len(name) <= 100: raise ValueError()
                sources.append(Source(row['id'], name, row['feed_url'], domains, row['publisher_group']))
            except (KeyError, TypeError, ValueError): raise AgentError('Confira URL, domínio e grupo editorial de cada fonte.') from None
        if len({s.id for s in sources}) != len(sources): raise AgentError('As fontes precisam de IDs únicos.')
        return cls(os.getenv('AUTONOMOUS_ENABLED') == 'true', os.getenv('GEMINI_FREE_TIER_CONFIRMED') == 'true',
            os.getenv('TAVILY_FREE_TIER_CONFIRMED') == 'true', 1200,
            bounded('MAX_PENDING_DRAFTS',5,1,10), bounded('GEMINI_MAX_CALLS_PER_DAY',20,1,72),
            bounded('TAVILY_MAX_CALLS_PER_DAY',20,0,30), bounded('TAVILY_MAX_CALLS_PER_MONTH',600,0,900), tuple(sources))
