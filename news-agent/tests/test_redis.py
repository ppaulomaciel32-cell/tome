import concurrent.futures
import json
import unittest
import fakeredis
from tnn.store import RedisStore

class RedisTests(unittest.TestCase):
 def setUp(self):self.redis=fakeredis.FakeRedis(decode_responses=True);self.store=RedisStore(self.redis)
 def test_atomic_dedup_under_concurrency_and_recovery(self):
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
   results=list(executor.map(lambda _:self.store.create('5585999999999','Pauta','media','', 'a'*64),range(16)))
  self.assertEqual(sum(created for job,created in results),1)
  id=self.store.pop();self.assertIsNotNone(self.store.get(id))
  self.assertEqual(self.redis.llen('tnn:processing'),1)
  self.store.recover();self.assertEqual(self.redis.llen('tnn:queue'),1)
  self.assertEqual(self.store.pop(),id);self.store.ack(id);self.assertEqual(self.redis.llen('tnn:processing'),0)
 def test_dedup_ttl_commands_preview_and_delivery_claim(self):
  j,_=self.store.create('5585999999999','Pauta','media','','b'*64)
  self.assertGreater(self.redis.ttl('tnn:dedup:'+'b'*64),259190)
  self.store.command(j['id'],'CORRIGIR título');self.store.command(j['id'],'APROVAR')
  self.assertEqual(self.store.take_commands(j['id']),['CORRIGIR título','APROVAR']);self.assertEqual(self.store.take_commands(j['id']),[])
  token=self.store.preview(j,'<h1>Teste</h1>');self.assertEqual(self.store.get_preview(token),'<h1>Teste</h1>');self.assertLessEqual(self.redis.ttl('tnn:preview:'+token),86400)
  self.assertTrue(self.store.delivery_claim('x'));self.assertFalse(self.store.delivery_claim('x'));self.store.delivery_done('x');self.assertEqual(self.store.delivery_state('x'),'sent')

if __name__=='__main__':unittest.main()
