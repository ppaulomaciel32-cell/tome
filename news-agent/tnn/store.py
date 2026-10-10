import json
import os
import secrets
import time
import uuid
from .core import AgentError

class RedisStore:
    def __init__(self, client=None):
        if client is None:
            import redis
            client=redis.Redis.from_url(os.environ['REDIS_URL'],decode_responses=True,
                socket_connect_timeout=5,socket_timeout=10,health_check_interval=20)
        self.r=client
    def save(self, job):
        self.r.set('tnn:job:'+job['id'],json.dumps(job,ensure_ascii=False),ex=7*86400)
    def get(self, id):
        data=self.r.get('tnn:job:'+id)
        return json.loads(data) if data else None
    def last(self, sender):
        id=self.r.get('tnn:last:'+sender)
        return self.get(id) if id else None
    def create(self, sender, headline, media_id, audio_id, fingerprint):
        job={'id':str(uuid.uuid4()),'sender':sender,'headline':headline,'media_id':media_id,
             'audio_id':audio_id,'fingerprint':fingerprint,'status':'queued','created':time.time(),
             'revision':int(time.time()*1000),'sources':[],'approved':False}
        # Reserva + job + fila na mesma operação: nenhum job perdido entre SET e LPUSH.
        script='''local previous=redis.call('GET',KEYS[1]); if previous then return previous end;
        redis.call('SET',KEYS[1],ARGV[1],'EX',259200);
        redis.call('SET',KEYS[2],ARGV[2],'EX',604800);
        redis.call('SET',KEYS[3],ARGV[1],'EX',604800);
        redis.call('LPUSH',KEYS[4],ARGV[1]); return '';'''
        existing=self.r.eval(script,4,'tnn:dedup:'+fingerprint,'tnn:job:'+job['id'],
                             'tnn:last:'+sender,'tnn:queue',job['id'],json.dumps(job,ensure_ascii=False))
        return (self.get(existing),False) if existing else (job,True)
    def enqueue(self,id): self.r.lpush('tnn:queue',id)
    def pop(self): return self.r.brpoplpush('tnn:queue','tnn:processing',timeout=3)
    def ack(self,id): self.r.lrem('tnn:processing',1,id)
    def recover(self):
        while self.r.rpoplpush('tnn:processing','tnn:queue'): pass
    def seen(self,id): return not bool(self.r.set('tnn:message:'+id,'1',nx=True,ex=7*86400))
    def unsee(self,id): self.r.delete('tnn:message:'+id)
    def recent_inbound(self,sender): self.r.set('tnn:window:'+sender,str(time.time()),ex=86400)
    def can_reply(self,sender): return self.r.exists('tnn:window:'+sender)>0
    def pending_photo(self,sender,media_id=None):
        key='tnn:photo:'+sender
        if media_id: self.r.set(key,media_id,ex=300); return media_id
        return self.r.getdel(key) or ''
    def command(self,id,text): self.r.rpush('tnn:commands:'+id,text); self.r.expire('tnn:commands:'+id,604800)
    def take_commands(self,id):
        values=[]
        while True:
            value=self.r.lpop('tnn:commands:'+id)
            if value is None: return values
            values.append(value)
    def preview(self,job,html):
        token=secrets.token_urlsafe(32)
        self.r.set('tnn:preview:'+token,html,ex=86400)
        return token
    def get_preview(self,token): return self.r.get('tnn:preview:'+token)
    def fail_count(self,stage,failed):
        key='tnn:fail:'+stage
        if not failed: self.r.delete(key); return 0
        count=self.r.incr(key);self.r.expire(key,86400);return count
    def delivery_claim(self,key): return bool(self.r.set('tnn:delivery:'+key,'sending',nx=True,ex=604800))
    def delivery_done(self,key): self.r.set('tnn:delivery:'+key,'sent',ex=604800)
    def delivery_reset(self,key): self.r.delete('tnn:delivery:'+key)
    def delivery_state(self,key): return self.r.get('tnn:delivery:'+key)
    def health(self): return self.r.ping()
