import hmac
import json
import re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from .config import place

def decision_valid(p):
    from uuid import UUID
    try:
        return str(UUID(p['id'],version=4))==p['id'] and p['action'] in ('approve','reject','correct') and type(p['revision']) is int and p['revision']>=1 \
          and all(re.fullmatch('[a-f0-9]{64}',p.get(k,'')) for k in ('receipt','editorHash','signature')) \
          and type(p.get('titleIndex',0)) is int and 0<=p.get('titleIndex',0)<=2 and isinstance(p.get('instruction',''),str) and len(p.get('instruction',''))<=1000
    except (KeyError,TypeError,ValueError,AttributeError):return False

def server(config,store=None,api=None,address=('0.0.0.0',3092)):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass  # Sem URLs, mensagens privadas, tokens ou IPs no log.
        def reply(self,code,body):
            raw=json.dumps(body,ensure_ascii=False).encode();self.send_response(code)
            for key,value in {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':str(len(raw))}.items():self.send_header(key,value)
            self.end_headers();self.wfile.write(raw)
        def do_GET(self):self.handle_request()
        def do_POST(self):self.handle_request()
        def handle_request(self):
            try:
                if self.path=='/healthz':return self.reply(200 if not config.enabled or store.healthy() else 503,{'enabled':config.enabled,'ok':not config.enabled or store.healthy()})
                if not config.enabled:return self.reply(503,{'code':'radar_disabled','message':'Radar Viral desligado.'})
                if not hmac.compare_digest(self.headers.get('x-pipeline-token',''),config.token):return self.reply(401,{'code':'unauthorized'})
                if self.command=='GET' and self.path=='/state':
                    return self.reply(200,{'enabled':True,'busy':bool(store.client.get(store.prefix+'scanning')),'items':api.call().get('items',[])})
                if self.command!='POST' or self.path not in ('/start','/decision'):return self.reply(404,{'code':'not_found'})
                if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.reply(415,{'code':'json_required'})
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=6000:return self.reply(413,{'code':'too_large'})
                self.connection.settimeout(10);p=json.loads(self.rfile.read(length))
                if not isinstance(p,dict):return self.reply(400,{'code':'invalid_body'})
                if self.path=='/start':
                    if not re.fullmatch('[a-f0-9]{64}',p.get('receipt','')):return self.reply(400,{'code':'invalid_request'})
                    city=place(p['city']) if p.get('city') else None
                    if p.get('city') and not city:return self.reply(400,{'code':'unknown_city','message':'Localidade não reconhecida. Use o nome do município ou distrito cadastrado.'})
                    result=store.enqueue({'kind':'scan','turno':'demanda','city':city},p['receipt'])
                else:
                    if not decision_valid(p):return self.reply(400,{'code':'invalid_decision'})
                    result=store.enqueue({'kind':'decision','decision':p},p['receipt'])
                return self.reply(200,result)
            except Exception:return self.reply(503,{'code':'radar_unavailable','message':'Radar indisponível. O restante da redação continua funcionando.'})
    return ThreadingHTTPServer(address,Handler)
