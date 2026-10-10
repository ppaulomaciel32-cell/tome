import hashlib
import hmac
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
import fakeredis
from tnn.store import RedisStore
from tnn.web import handler

class HTTPTests(unittest.TestCase):
 def test_real_http_signature_challenge_queue_and_private_preview(self):
  store=RedisStore(fakeredis.FakeRedis(decode_responses=True))
  bot=type('Bot',(),{'store':store})()
  secret='s'*32;verify='v'*32
  server=ThreadingHTTPServer(('127.0.0.1',0),handler(bot,secret,verify))
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  base=f'http://127.0.0.1:{server.server_port}'
  try:
   with urllib.request.urlopen(base+'/healthz') as r:self.assertEqual(r.status,200)
   with urllib.request.urlopen(base+'/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token='+verify) as r:self.assertEqual(r.read(),b'123')
   body=json.dumps({'object':'whatsapp_business_account','entry':[]}).encode()
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(urllib.request.Request(base+'/webhook',data=body,method='POST'))
   self.assertEqual(error.exception.code,401);self.assertEqual(store.r.llen('tnn:inbound'),0)
   sig='sha256='+hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
   with urllib.request.urlopen(urllib.request.Request(base+'/webhook',data=body,headers={'X-Hub-Signature-256':sig},method='POST')) as r:self.assertEqual(r.status,200)
   self.assertEqual(store.r.llen('tnn:inbound'),1)
   token=store.preview({},'<h1>Teste</h1>')
   with urllib.request.urlopen(base+'/preview/'+token) as r:
    self.assertEqual(r.headers['Cache-Control'],'no-store');self.assertIn('noindex',r.headers['X-Robots-Tag']);self.assertIn('frame-ancestors',r.headers['Content-Security-Policy'])
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
