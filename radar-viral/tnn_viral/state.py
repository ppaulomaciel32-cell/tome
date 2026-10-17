import hashlib
import json
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from tnn.autonomous.store import State as SharedQuota

ZONE=ZoneInfo('America/Fortaleza')
class Store:
    prefix='tnn:viral:v1:'
    def __init__(self,client,now=time.time):self.client=client;self.now=now;self.shared=SharedQuota(client,now)
    def enqueue(self,payload,key):
        # Reserva e enqueue na mesma operação: restart não perde um pedido confirmado.
        job={**payload,'id':str(uuid.uuid4()),'created':self.now()}
        result=self.client.eval('''
          if redis.call('EXISTS',KEYS[1])==1 then return 0 end
          if ARGV[2]=='scan' and redis.call('EXISTS',KEYS[3])==1 then return 2 end
          redis.call('SET',KEYS[1],'1','EX',345600)
          redis.call('LPUSH',KEYS[2],ARGV[1])
          if ARGV[2]=='scan' then redis.call('SET',KEYS[3],'1','EX',660) end
          return 1''',3,self.prefix+'request:'+key,self.prefix+'queue',self.prefix+'scanning',json.dumps(job),payload['kind'])
        return {'queued':result==1,'busy':result==2,'duplicate':result==0,'id':job['id']}
    def next(self):
        raw=self.client.rpoplpush(self.prefix+'queue',self.prefix+'processing')
        return json.loads(raw) if raw else None
    def recover(self):
        # Trabalhador único: recupera apenas a entrega privada, nunca uma publicação.
        while self.client.rpoplpush(self.prefix+'processing',self.prefix+'queue'):pass
    def finish(self,job):
        self.client.lrem(self.prefix+'processing',1,json.dumps(job))
        if job['kind']=='scan':self.client.delete(self.prefix+'scanning')
    def reserve(self,provider,own,global_day,global_month=None):
        day=datetime.fromtimestamp(self.now(),ZONE).strftime('%Y%m%d')
        key=self.prefix+provider+':'+day
        # Cota própria atômica; reserva global usa exatamente os contadores do robô.
        ok=self.client.eval("if tonumber(redis.call('GET',KEYS[1]) or '0')>=tonumber(ARGV[1]) then return 0 end redis.call('INCR',KEYS[1]);redis.call('EXPIRE',KEYS[1],172800);return 1",1,key,own)
        return bool(ok and self.shared.reserve(provider,global_day,global_month))
    def candidate(self,key,intensive,limit):
        day=datetime.fromtimestamp(self.now(),ZONE).strftime('%Y%m%d');now=self.now()
        return bool(self.client.eval('''
          redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]-7200)
          if redis.call('EXISTS',KEYS[3])==1 or tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[2]) then return 0 end
          if ARGV[3]=='1' and redis.call('ZCARD',KEYS[1])>=3 then return 0 end
          redis.call('INCR',KEYS[2]);redis.call('EXPIRE',KEYS[2],172800)
          redis.call('ZADD',KEYS[1],ARGV[1],KEYS[3]);redis.call('EXPIRE',KEYS[1],10800)
          redis.call('SET',KEYS[3],'1','EX',259200);return 1''',3,self.prefix+'window',self.prefix+'day:'+day,self.prefix+'seen:'+key,now,limit,int(intensive)))
    def available(self,intensive,limit):
        day=datetime.fromtimestamp(self.now(),ZONE).strftime('%Y%m%d')
        return int(self.client.get(self.prefix+'day:'+day) or 0)<limit and (not intensive or self.client.zcount(self.prefix+'window',self.now()-7200,'+inf')<3)
    def heartbeat(self):self.client.set(self.prefix+'heartbeat',int(self.now()),ex=90)
    def healthy(self):return bool(self.client.get(self.prefix+'heartbeat'))

def scheduled(now,intensive=False):
    local=datetime.fromtimestamp(now,ZONE)
    if intensive:
        if local.minute%20:return None
        label='demanda';slot=local.strftime('%Y%m%d%H%M')
    else:
        label={(6,30):'manha',(12,0):'tarde',(18,30):'noite'}.get((local.hour,local.minute))
        if not label:return None
        slot=local.strftime('%Y%m%d')+':'+label
    return {'kind':'scan','turno':label,'city':None},'schedule:'+slot

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
