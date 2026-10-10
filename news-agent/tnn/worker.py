import json
import os
import threading
import time
from .core import AgentError
from .pipeline import Pipeline
from .providers import WhatsApp,Search,Drael,Cloudinary,Ingest,Transcriber
from .store import RedisStore

def main():
    store=RedisStore();ingest=Ingest()
    lock=store.r.lock('tnn:worker-lock',timeout=300,blocking_timeout=1,thread_local=False)
    if not lock.acquire():raise AgentError('Outro worker já está ativo.')
    stopping=threading.Event()
    def heartbeat():
        while not stopping.wait(15):
            try:
                lock.extend(300,replace_ttl=True)
                store.r.set('tnn:worker-heartbeat',str(time.time()),ex=60)
            except Exception:os._exit(1)
    threading.Thread(target=heartbeat,daemon=True).start()
    pipeline=Pipeline(store,WhatsApp(store),Search(),Drael(),Cloudinary(),ingest,Transcriber())
    store.recover()
    try:
        while True:
            raw=store.r.lindex('tnn:audit',0)
            if raw:
                try:
                    data=json.loads(raw);ingest.call({'action':'log',**data});store.r.lpop('tnn:audit')
                except Exception:pass
            id=store.pop()
            if not id:continue
            try:pipeline.process(id)
            finally:store.ack(id)
    finally:
        stopping.set();lock.release()

if __name__=='__main__':main()
