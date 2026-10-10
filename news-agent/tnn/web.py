import hashlib
import hmac
import json
import os
import re
import time
import threading
import uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import parse_qs,urlsplit
from .core import AgentError,clean_error,fingerprint,phone,required
from .providers import WhatsApp,Ingest
from .store import RedisStore

class Bot:
    def __init__(self,store,wa,ingest,whitelist,phone_id):
        self.store=store;self.wa=wa;self.ingest=ingest
        self.whitelist={phone(p) for p in whitelist if phone(p)};self.phone_id=phone_id
        if not self.whitelist:raise AgentError('Configure pelo menos um número autorizado.')
    def accept(self,event):
        if event.get('object')!='whatsapp_business_account':return
        for entry in event.get('entry',[]):
            for change in entry.get('changes',[]):
                value=change.get('value',{})
                if str(value.get('metadata',{}).get('phone_number_id',''))!=self.phone_id:continue
                for status in value.get('statuses',[]):
                    # Persistência de entrega, sem criar pauta nem reter o payload pessoal.
                    if hasattr(self.store,'r') and status.get('id'):
                        self.store.r.set('tnn:meta-status:'+status['id'],str(status.get('status','')),ex=604800)
                for message in value.get('messages',[]):self.message(message)
    def message(self,m):
        sender=phone(m.get('from',''));message_id=str(m.get('id',''))
        if not sender or not message_id or len(message_id)>300:return
        if abs(time.time()-int(m.get('timestamp',time.time())))>86400:return
        if self.store.seen(message_id):return
        try:
            self.store.recent_inbound(sender)
            if sender not in self.whitelist:
                self.wa.text(sender,'Número não autorizado',f'unauthorized:{message_id}');return
            kind=m.get('type');text=str(m.get('text',{}).get('body','')).strip()
            upper=text.upper()
            if upper in ('STATUS','LISTAR','APROVAR') or re.match(r'^CORRIGIR\b',upper):
                self.command(sender,text,message_id);return
            media_id='';audio_id=''
            if kind=='image':
                media_id=str(m.get('image',{}).get('id',''))
                text=str(m.get('image',{}).get('caption','')).strip()
                if not text:
                    self.store.pending_photo(sender,media_id)
                    self.wa.text(sender,'Foto recebida. Envie a manchete em texto ou áudio em até cinco minutos.',f'photo:{message_id}');return
            elif kind=='audio':
                audio_id=str(m.get('audio',{}).get('id',''));text='Áudio '+audio_id
                media_id=self.store.pending_photo(sender)
            elif kind=='text':
                media_id=self.store.pending_photo(sender)
                if not media_id and not upper.startswith('MANCHETE:'):
                    self.wa.text(sender,'Envie foto com legenda ou escreva MANCHETE: seguida da pauta. Comandos: STATUS, LISTAR, APROVAR e CORRIGIR.',f'help:{message_id}');return
            else:
                self.wa.text(sender,'Envie texto, foto ou áudio.',f'type:{message_id}');return
            text=re.sub(r'^MANCHETE:\s*','',text,flags=re.I).strip()
            if not 3<=len(text)<=1500:
                self.wa.text(sender,'A manchete deve ter entre 3 e 1.500 caracteres.',f'invalid:{message_id}');return
            job,created=self.store.create(sender,text,media_id,audio_id,fingerprint(text,media_id or audio_id))
            if not created:
                within_five=job and time.time()-job['created']<300
                response='Já estou trabalhando nisso' if within_five else 'Essa pauta já foi recebida nas últimas 72 horas. Use STATUS ou CORRIGIR.'
                self.wa.text(sender,response,f'duplicate:{message_id}');return
            self.wa.text(sender,f"Pauta recebida. Vou conferir as fontes. Código: {job['id'][:8]}",f'accepted:{message_id}')
        except Exception:
            # A reserva da pauta é atômica. Reentrega do webhook continua idempotente.
            self.store.unsee(message_id)
            raise
    def command(self,sender,text,message_id):
        upper=text.upper()
        if upper=='LISTAR':
            items=self.ingest.list();base=os.getenv('SITE_URL','https://tome-nota-publico.onrender.com').rstrip('/')
            response='\n\n'.join(x['title']+'\n'+base+'/noticia/'+x['slug']+'/' for x in items) or 'Ainda não há matérias publicadas pelo agente.'
            self.wa.text(sender,response,f'list:{message_id}');return
        job=self.store.last(sender)
        if not job:self.wa.text(sender,'Nenhuma pauta encontrada para seu número.',f'empty:{message_id}');return
        if upper=='STATUS':
            labels={'queued':'na fila','processing':'em produção','awaiting_sources':'aguardando decisão sobre as fontes','awaiting_approval':'aguardando aprovação','awaiting_deploy':'aguardando publicação do site','publication_pending':'publicação pendente','done':'no ar','failed':'interrompida'}
            response=f"Pauta {job['id'][:8]}\nEstado: {labels.get(job['status'],job['status'])}"
            if job.get('error'):response+='\n'+job['error']
            if job['status']=='done':response+='\nNo ar: '+job['publish_result']['url']
            self.wa.text(sender,response,f'status:{message_id}')
            if job['status'] in ('awaiting_deploy','publication_pending'):self.store.enqueue(job['id'])
            return
        if upper=='APROVAR':command='APROVAR'
        else:
            instruction=re.sub(r'^CORRIGIR\s*:?\s*','',text,flags=re.I).strip()
            if not instruction or len(instruction)>1500:
                self.wa.text(sender,'Use CORRIGIR: seguido da alteração desejada.',f'correct-help:{message_id}');return
            command='CORRIGIR '+instruction
        self.store.command(job['id'],command);self.store.enqueue(job['id'])
        self.wa.text(sender,'Aprovação recebida.' if command=='APROVAR' else 'Correção recebida. Vou manter as fontes e o endereço da matéria.',f'command:{message_id}')

def valid_signature(body,signature,secret):
    expected='sha256='+hmac.new(secret.encode(),body,hashlib.sha256).hexdigest()
    return bool(secret) and hmac.compare_digest(expected,signature or '')

def handler(bot,secret,verify):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass # Não registrar tokens de preview nem corpos de webhook.
        def send(self,status,body,content='text/plain; charset=utf-8'):
            body=body.encode() if isinstance(body,str) else body
            self.send_response(status);self.send_header('Content-Type',content)
            self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY')
            self.send_header('X-Robots-Tag','noindex, nofollow');self.send_header('Referrer-Policy','no-referrer')
            self.send_header('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src https://res.cloudinary.com; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers();self.wfile.write(body)
        def do_GET(self):
            path=urlsplit(self.path)
            if path.path=='/healthz':
                try: bot.store.health();self.send(200,'ok')
                except Exception:self.send(503,'unavailable')
            elif path.path=='/webhook':
                q=parse_qs(path.query)
                if q.get('hub.mode')==['subscribe'] and hmac.compare_digest(q.get('hub.verify_token',[''])[0],verify):
                    self.send(200,q.get('hub.challenge',[''])[0][:500])
                else:self.send(403,'forbidden')
            elif re.fullmatch(r'/preview/[A-Za-z0-9_-]{40,60}',path.path):
                page=bot.store.get_preview(path.path.rsplit('/',1)[1])
                self.send(200,page,'text/html; charset=utf-8') if page else self.send(404,'Prévia expirada ou inexistente.')
            else:self.send(404,'not found')
        def do_POST(self):
            if urlsplit(self.path).path!='/webhook':self.send(404,'not found');return
            try:length=int(self.headers.get('Content-Length','0'))
            except ValueError:self.send(400,'invalid length');return
            if not 0<length<=262144:self.send(413,'too large');return
            body=self.rfile.read(length)
            if not valid_signature(body,self.headers.get('X-Hub-Signature-256',''),secret):self.send(401,'unauthorized');return
            try:
                event=json.loads(body)
                if not isinstance(event,dict):raise ValueError('object expected')
            except ValueError:self.send(400,'invalid json');return
            try:
                # Recebimento durável e ACK rápido. O worker executa o handler fora do webhook.
                bot.store.r.lpush('tnn:inbound',json.dumps(event))
                self.send(200,'ok')
            except Exception:self.send(503,'queue unavailable')
    return Handler

def main():
    store=RedisStore();bot=Bot(store,WhatsApp(store),Ingest(),required('WHITELIST_NUMBERS').split(','),required('META_PHONE_ID'))
    def consume():
        while store.r.rpoplpush('tnn:inbound-processing','tnn:inbound'):pass
        while True:
            raw=store.r.brpoplpush('tnn:inbound','tnn:inbound-processing',timeout=3)
            if not raw:continue
            key='tnn:inbound-attempt:'+hashlib.sha256(raw.encode()).hexdigest()
            try:bot.accept(json.loads(raw))
            except Exception:
                count=store.r.incr(key);store.r.expire(key,86400)
                if count<3:
                    time.sleep(count);store.r.lpush('tnn:inbound',raw)
                else:
                    store.r.set('tnn:inbound-error:'+uuid.uuid4().hex,raw,ex=86400)
            finally:store.r.lrem('tnn:inbound-processing',1,raw)
    def supervised_consume():
        try:consume()
        except Exception:
            # Falha da conexão Redis não pode deixar um bot saudável sem consumidor.
            # O Docker reinicia o processo e recupera a fila durável na inicialização.
            os._exit(1)
    threading.Thread(target=supervised_consume,daemon=True).start()
    server=ThreadingHTTPServer(('0.0.0.0',8080),handler(bot,required('META_APP_SECRET'),required('WEBHOOK_VERIFY_TOKEN')))
    server.serve_forever()

if __name__=='__main__':main()
