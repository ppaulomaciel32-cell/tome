import json
import os
import signal
import sys
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from .config import Config
from .store import State
from .clients import Drafts,Bridge
from .collection import Collector
from .writer import Writer
from .pipeline import Pipeline
from .manual import Manual,Editorial
from .media import Covers

def main():
    state=State()
    if '--healthcheck' in sys.argv: return 0 if state.healthy() else 1
    config=Config.env();stop=threading.Event()
    try:summary_hour=int(os.getenv('TNN_DAILY_SUMMARY_HOUR','20'))
    except ValueError:raise ValueError('TNN_DAILY_SUMMARY_HOUR deve ser 0 a 23.') from None
    if not 0<=summary_hour<=23:raise ValueError('TNN_DAILY_SUMMARY_HOUR deve ser 0 a 23.')
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,lambda *_:stop.set())
    covers=Covers()
    pipeline=Pipeline(config,state,Collector(config,state),Writer(),Drafts(),Bridge(),covers=covers)
    manual=Manual(config,state,pipeline.collector,pipeline.writer,pipeline.drafts,pipeline.bridge,Editorial(),covers=covers)
    def heartbeat():
        while not stop.is_set():
            try: state.heartbeat()
            except Exception: stop.set();return
            stop.wait(15)
    threading.Thread(target=heartbeat,daemon=True).start()
    previous=None
    while not stop.is_set():
        # Um resumo por dia, reservado antes do envio. Reinício não duplica mensagens.
        local=datetime.now(ZoneInfo('America/Fortaleza'))
        if local.hour>=summary_hour and os.getenv('TNN_DAILY_SUMMARY_ENABLED')=='true':
            try:
                key=state.prefix+'summary:'+local.strftime('%Y-%m-%d')
                if not state.client.get(key):
                    payload={'day':local.strftime('%Y-%m-%d')}
                    try:
                        report=pipeline.collector.net.json('https://bot.tomezap.com.br/painel-api/popular',
                            headers={'Origin':'https://tomezap.com.br'},timeout=10,max_bytes=20000)
                        if report.get('configured'):
                            payload['top']=[{'title':a['title'][:140],'slug':a['slug'],'views':a['views']} for a in report.get('articles',[])[:3]]
                    except Exception:pass
                    pipeline.bridge.call('/daily-summary',payload)
                    state.client.set(key,'sent',ex=3*86400)
            except Exception:pass
        try:
            if manual.one():continue
        except Exception:
            # Sem conteúdo privado no log. A fila preserva pedidos incertos.
            print('{"event":"manual_unavailable"}',flush=True)
        window=int(time.time())//config.interval
        if window!=previous:
            previous=window
            # Uma execução por processo; lock Redis + janela no Postgres protegem reinícios.
            result=pipeline.once()
            print(json.dumps({'event':'cycle','status':result['status']}),flush=True)
        stop.wait(5)
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except Exception:
        print('{"event":"worker_unavailable"}',flush=True)
        sys.exit(1)
