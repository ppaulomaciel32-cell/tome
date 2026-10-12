import json
import os
import signal
import sys
import threading
import time
from .config import Config
from .store import State
from .clients import Drafts,Bridge
from .collection import Collector
from .writer import Writer
from .pipeline import Pipeline

def main():
    state=State()
    if '--healthcheck' in sys.argv: return 0 if state.healthy() else 1
    config=Config.env();stop=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT): signal.signal(sig,lambda *_:stop.set())
    pipeline=Pipeline(config,state,Collector(config,state),Writer(),Drafts(),Bridge())
    def heartbeat():
        while not stop.is_set():
            try: state.heartbeat()
            except Exception: stop.set();return
            stop.wait(15)
    threading.Thread(target=heartbeat,daemon=True).start()
    previous=None
    while not stop.is_set():
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
