import time
from datetime import datetime,timezone
import redis
from ..core import AgentError,required

class QuotaLimit(AgentError): pass

class State:
    prefix='tnn:drafts:v1:'
    def __init__(self,client=None,now=time.time):
        self.client=client or redis.Redis(host='redacao-redis',port=6379,password=required('REDACTION_REDIS_PASSWORD'),decode_responses=True,socket_timeout=5,socket_connect_timeout=5)
        self.now=now
    def reserve(self,provider,daily,monthly=None):
        if daily<=0 or monthly is not None and monthly<=0: return False
        d=datetime.fromtimestamp(self.now(),timezone.utc)
        keys=[self.prefix+provider+':day:'+d.strftime('%Y%m%d'),self.prefix+provider+':month:'+d.strftime('%Y%m')]
        # Reserva antes da chamada, inclusive em falha/timeout. Sem Redis, para.
        return bool(self.client.eval('''
          if tonumber(redis.call('GET',KEYS[1]) or '0') >= tonumber(ARGV[1]) or tonumber(redis.call('GET',KEYS[2]) or '0') >= tonumber(ARGV[2]) then return 0 end
          redis.call('INCR',KEYS[1]); redis.call('EXPIRE',KEYS[1],172800)
          redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],3456000)
          return 1''',2,*keys,daily,monthly if monthly is not None else 100000))
    def used(self,provider):
        d=datetime.fromtimestamp(self.now(),timezone.utc)
        return int(self.client.get(self.prefix+provider+':day:'+d.strftime('%Y%m%d')) or 0)
    def lock(self): return self.client.lock(self.prefix+'lock',timeout=900,blocking=False)
    def failure(self,stage): return self.client.incr(self.prefix+'failures:'+stage)
    def reset(self,stage): self.client.delete(self.prefix+'failures:'+stage)
    def heartbeat(self): self.client.set(self.prefix+'heartbeat',int(self.now()),ex=90)
    def healthy(self):
        t=self.client.get(self.prefix+'heartbeat');return t is not None and self.now()-int(t)<90
