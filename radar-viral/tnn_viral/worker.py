import json
import os
import signal
import sys
import threading
import time
import redis
from .config import Config
from .state import Store,scheduled
from .sources import Sources
from .editor import Editor
from .clients import API,Relay
from .pipeline import Pipeline
from .server import server

def main():
    config=Config.env();stop=threading.Event();store=None;api=None
    if config.enabled:
        client=redis.Redis(host='redacao-redis',port=6379,password=os.environ['REDACTION_REDIS_PASSWORD'],decode_responses=True,socket_timeout=5,socket_connect_timeout=5)
        store=Store(client);api=API(config)
        pipeline=Pipeline(config,store,Sources(config,store),Editor(),api,Relay(config.token))
    if '--healthcheck' in sys.argv:
        return 0 if not config.enabled or store.healthy() else 1
    http=server(config,store,api)
    threading.Thread(target=http.serve_forever,daemon=True).start()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    if not config.enabled:
        stop.wait();http.shutdown();return 0  # Nenhum Redis, cron, provedor ou grupo consultado.
    # Trava de instância longa: não recuperar a fila de um trabalhador ainda vivo.
    instance=store.client.lock(store.prefix+'instance',timeout=90,blocking=False,thread_local=False)
    if not instance.acquire(blocking=False):raise RuntimeError('worker_exists')
    def beat():
        while not stop.is_set():
            try:instance.extend(90,replace_ttl=True);store.heartbeat()
            except Exception:stop.set();return
            stop.wait(15)
    threading.Thread(target=beat,daemon=True).start();store.recover();last_sync=0
    while not stop.is_set():
        try:
            tick=scheduled(time.time(),config.intensive)
            if tick:store.enqueue(*tick)
            job=store.next()
            if job:
                try:result=pipeline.run(job)
                except Exception:result={'status':'failed'}
                # Eventos fixos e contadores: nada de fonte privada ou mensagem no stdout.
                print(json.dumps({'event':'radar_job','status':result['status']}),flush=True)
                store.finish(job)
                if result['status'] in ('failed','busy'):
                    attempt=job.get('attempt',0)
                    if attempt<2:
                        stop.wait(2**attempt)
                        store.client.lpush(store.prefix+'queue',json.dumps({**job,'attempt':attempt+1}))
                    elif job['kind']=='decision':
                        try:pipeline.relay.call('/radar/notice',{'id':job['decision']['id'],'receipt':job['decision']['receipt'],'code':'correction_failed'})
                        except Exception:pass
            if time.time()-last_sync>300:
                api.call({'action':'sync'});last_sync=time.time()
        except Exception:print('{"event":"radar_unavailable"}',flush=True)
        stop.wait(2)
    http.shutdown()
    if instance.owned():instance.release()
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception:print('{"event":"radar_start_failed"}',flush=True);sys.exit(1)
