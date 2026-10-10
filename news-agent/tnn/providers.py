from __future__ import annotations
import base64
import hashlib
import io
import json
import multiprocessing
import os
import re
import socket
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from .core import AgentError, AmbiguousSend, https, parse_article, required

class UncertainRequest(AgentError): pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

class Net:
    def __init__(self): self.opener=urllib.request.build_opener(NoRedirect)
    def request(self,url,method='GET',headers=None,data=None,timeout=15,max_bytes=1000000):
        if not https(url): raise AgentError('Endereço HTTPS inválido.')
        request=urllib.request.Request(url,data=data,headers=headers or {},method=method)
        try:
            with self.opener.open(request,timeout=timeout) as result:
                body=result.read(max_bytes+1)
                if len(body)>max_bytes: raise AgentError('Resposta acima do limite permitido.')
                return body
        except urllib.error.HTTPError as exc:
            # Nunca devolver o corpo remoto: pode conter token, consulta ou dados do banco.
            if exc.code in (401,403): raise AgentError('Credencial ou plano do serviço não autorizado.') from None
            if exc.code==429: raise AgentError('Limite do serviço atingido.',True) from None
            error=AgentError(f'Serviço respondeu HTTP {exc.code}.',exc.code>=500)
            error.http_status=exc.code
            raise error from None
        except (urllib.error.URLError,TimeoutError,socket.timeout,ConnectionError):
            raise UncertainRequest('Conexão interrompida ou tempo limite do serviço.',True) from None
    def json(self,url,payload=None,headers=None,timeout=15,max_bytes=1000000,method=None):
        h={'Content-Type':'application/json',**(headers or {})}
        raw=self.request(url,method or ('POST' if payload is not None else 'GET'),h,
            json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None,
            timeout,max_bytes)
        try: return json.loads(raw)
        except ValueError: raise AgentError('O serviço retornou uma resposta inválida.') from None

def multipart(fields,file_field=None,filename=None,file_bytes=None,mime='application/octet-stream'):
    boundary='tnn-'+uuid.uuid4().hex
    chunks=[]
    for key,value in fields.items():
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
    if file_field:
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()+file_bytes+b'\r\n')
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b''.join(chunks),f'multipart/form-data; boundary={boundary}'

class WhatsApp:
    def __init__(self,store,net=None):
        self.store=store;self.net=net or Net()
    def auth(self): return {'Authorization':'Bearer '+required('META_TOKEN')}
    def endpoint(self,path):
        version=required('META_GRAPH_VERSION')
        if not re.fullmatch(r'v\d+\.\d+',version): raise AgentError('Versão da Meta inválida.')
        return f'https://graph.facebook.com/{version}/{path}'
    def _send(self,sender,content,key):
        if not self.store.can_reply(sender): raise AgentError('Janela de resposta encerrada. Envie STATUS para continuar.')
        if not self.store.delivery_claim(key):
            if self.store.delivery_state(key)=='sent': return
            raise AmbiguousSend('Uma resposta anterior ficou sem confirmação. Consulte STATUS.')
        try:
            result=self.net.json(self.endpoint(required('META_PHONE_ID')+'/messages'),
                {'messaging_product':'whatsapp','recipient_type':'individual','to':sender,**content},self.auth())
            if not result.get('messages'): raise AmbiguousSend('Envio do WhatsApp sem confirmação.')
            self.store.delivery_done(key)
        except UncertainRequest:
            raise AmbiguousSend('Envio ao WhatsApp sem confirmação; consulte STATUS.') from None
        except AgentError as exc:
            # Repetir apenas uma rejeição conhecida. Uma resposta incerta permanece registrada.
            if isinstance(exc,AmbiguousSend): raise
            if getattr(exc,'http_status',0)>=500:
                raise AmbiguousSend('A Meta não confirmou o envio. Consulte STATUS antes de reenviar.') from None
            self.store.delivery_reset(key)
            raise
    def text(self,sender,body,key):
        self._send(sender,{'type':'text','text':{'body':body[:4000],'preview_url':False}},key)
    def image(self,sender,data,key):
        body,ctype=multipart({'messaging_product':'whatsapp','type':'image/png'},'file','stories.png',data,'image/png')
        raw=self.net.request(self.endpoint(required('META_PHONE_ID')+'/media'),'POST',
            {**self.auth(),'Content-Type':ctype},body,15)
        media=json.loads(raw)
        if not media.get('id'): raise AgentError('A Meta não confirmou a arte.')
        self._send(sender,{'type':'image','image':{'id':media['id']}},key)
    def media(self,id,max_bytes=16000000):
        if not re.fullmatch(r'[0-9A-Za-z_-]{1,200}',id): raise AgentError('Identificador de mídia inválido.')
        info=self.net.json(self.endpoint(id)+'?phone_number_id='+required('META_PHONE_ID'),headers=self.auth())
        url=info.get('url','');host=urllib.parse.urlsplit(url).hostname or ''
        if not https(url) or not any(host==d or host.endswith('.'+d) for d in ('facebook.com','fbcdn.net','fbsbx.com')):
            raise AgentError('Endereço de mídia não autorizado.')
        if int(info.get('file_size',0))>max_bytes: raise AgentError('A mídia excede o limite permitido.')
        data=self.net.request(url,headers=self.auth(),max_bytes=max_bytes)
        if info.get('sha256'):
            digest=hashlib.sha256(data)
            if info['sha256'] not in (digest.hexdigest(),base64.b64encode(digest.digest()).decode()):
                raise AgentError('A integridade da mídia não foi confirmada.')
        return data

class Search:
    def __init__(self,net=None): self.net=net or Net()
    def search(self,headline):
        domains=[x.strip().lower() for x in required('TRUSTED_SOURCE_DOMAINS').split(',') if x.strip()]
        query=headline+' Ceará São Gonçalo do Amarante Pecém Taíba Croatá Paracuru'
        result=self.net.json('https://api.tavily.com/search',{'query':query,'topic':'news','search_depth':'basic',
            'max_results':5,'include_raw_content':'text','include_answer':False,'include_images':False,
            'include_domains':domains,'auto_parameters':False},
            {'Authorization':'Bearer '+required('TAVILY_API_KEY')},timeout=15,max_bytes=150000)
        sources=[];seen=set();content_hashes=set()
        for item in result.get('results',[]):
            url=item.get('url','');host=(urllib.parse.urlsplit(url).hostname or '').removeprefix('www.')
            if not https(url) or not any(host==d or host.endswith('.'+d) for d in domains): continue
            content=(item.get('raw_content') or item.get('content') or '').strip()[:16000]
            digest=hashlib.sha256(content.encode()).hexdigest()
            # Domínios repetidos e reproduções idênticas não contam como duas confirmações.
            if host in seen or digest in content_hashes or len(content)<160: continue
            seen.add(host);content_hashes.add(digest)
            sources.append({'title':str(item.get('title','Fonte pública'))[:500],'url':url,
                'content':content,'published_date':str(item.get('published_date') or '')[:100]})
        return sources[:5]

class Drael:
    def __init__(self,net=None): self.net=net or Net()
    def write(self,headline,sources,correction='',previous=None):
        prompt=Path(__file__).with_name('editorial.txt').read_text()
        data={'pauta':headline,'fontes':sources,'correcao_solicitada':correction,'versao_anterior':previous}
        try:
            result=self.net.json('https://drael.sh/v1/chat/completions',{
                'model':'drael-v1','temperature':0.3,'reasoning_effort':'none','max_tokens':3000,
                'stream':False,'tools':[],'tool_choice':'none',
                'messages':[{'role':'system','content':prompt},{'role':'user','content':json.dumps(data,ensure_ascii=False)}]},
                {'Authorization':'Bearer '+required('DRAEL_API_KEY')},timeout=45,max_bytes=100000)
        except UncertainRequest:
            # O Drael documenta que um turno interrompido pode continuar e consumir saldo.
            raise AgentError('A resposta do Drael foi interrompida. Não repeti a geração para evitar consumo duplicado.') from None
        try:
            choice=result['choices'][0]
            if choice.get('finish_reason') not in ('stop',None): raise ValueError('truncated')
            if choice['message'].get('tool_calls'): raise ValueError('tool_call')
            return parse_article(choice['message']['content'],sources)
        except (KeyError,IndexError,TypeError,ValueError):
            raise AgentError('O Drael não entregou uma matéria completa.') from None

class Cloudinary:
    def __init__(self,net=None): self.net=net or Net()
    def cover(self,image_bytes,job_id):
        cloud=urllib.parse.urlsplit(required('CLOUDINARY_URL'))
        if cloud.scheme!='cloudinary' or cloud.hostname!='dalwymbky' or not cloud.username or not cloud.password:
            raise AgentError('Configuração Cloudinary inválida.')
        fields={'timestamp':str(int(time.time())),'public_id':'tome-nota/news/'+job_id,
            'overwrite':'true','upload_preset':required('CLOUDINARY_UPLOAD_PRESET')}
        signature=hashlib.sha256(('&'.join(k+'='+fields[k] for k in sorted(fields))+urllib.parse.unquote(cloud.password)).encode()).hexdigest()
        fields.update({'api_key':urllib.parse.unquote(cloud.username),'signature':signature})
        body,ctype=multipart(fields,'file','cover.jpg',image_bytes,'image/jpeg')
        result=json.loads(self.net.request('https://api.cloudinary.com/v1_1/dalwymbky/image/upload','POST',
            {'Content-Type':ctype},body,20,max_bytes=100000))
        url=result.get('secure_url','')
        if not url.startswith('https://res.cloudinary.com/dalwymbky/image/upload/'):
            raise AgentError('Cloudinary não confirmou uma capa HTTPS.')
        return url.replace('/image/upload/','/image/upload/f_auto,q_auto,w_1600,h_900,c_fill/',1)

class Ingest:
    def __init__(self,net=None): self.net=net or Net()
    def call(self,payload=None,query=''):
        return self.net.json(required('INGEST_URL')+query,payload,
            {'x-service-token':required('INGEST_SERVICE_TOKEN')},timeout=20,max_bytes=1000000)
    def publish(self,payload): return self.call(payload)
    def log(self,job,stage,status,duration=0,error=''):
        return self.call({'action':'log','job_id':job['id'],'etapa':stage,'status':status,
                         'duracao_ms':max(0,int(duration)),'erro':error})
    def list(self): return self.call(query='?action=list')
    def live(self,url,revision):
        body=self.net.request(url,headers={'Cache-Control':'no-cache'},timeout=8,max_bytes=2000000).decode('utf-8')
        return f'name="tnn-agent-revision" content="{revision}"' in body

class LocalTranscriber:
    def transcribe(self,data):
        if len(data)>16000000: raise AgentError('Áudio acima do limite.')
        try: from faster_whisper import WhisperModel
        except ImportError: raise AgentError('Transcrição não instalada. Envie a manchete em texto.') from None
        with tempfile.NamedTemporaryFile(suffix='.ogg') as audio:
            audio.write(data);audio.flush()
            try:
                model=WhisperModel(os.getenv('WHISPER_MODEL','tiny'),device='cpu',compute_type='int8',
                    cpu_threads=int(os.getenv('WHISPER_THREADS','2')),download_root='/models',local_files_only=True)
                segments,info=model.transcribe(audio.name,language='pt',beam_size=1,vad_filter=True)
                if info.duration>120: raise AgentError('Envie áudio de até dois minutos.')
                text=' '.join(s.text.strip() for s in segments).strip()
                if not text: raise AgentError('Não entendi o áudio. Envie a manchete em texto.')
                return text[:1500]
            except AgentError: raise
            except Exception: raise AgentError('Não foi possível transcrever o áudio.') from None

def _transcribe_process(data,connection):
    try:connection.send((True,LocalTranscriber().transcribe(data)))
    except Exception as exc:connection.send((False,str(exc) if isinstance(exc,AgentError) else 'Falha na transcrição.'))
    finally:connection.close()

class Transcriber:
    def transcribe(self,data):
        context=multiprocessing.get_context('spawn');receive,send=context.Pipe(duplex=False)
        process=context.Process(target=_transcribe_process,args=(data,send));process.start();send.close()
        try:
            if not receive.poll(int(os.getenv('TRANSCRIPTION_TIMEOUT_SECONDS','45'))):
                raise AgentError('Tempo limite da transcrição. Envie a manchete em texto.',True)
            ok,value=receive.recv()
            if not ok:raise AgentError(value)
            return value
        except EOFError:raise AgentError('A transcrição foi interrompida.') from None
        finally:
            if process.is_alive():process.terminate()
            process.join(timeout=3)
            if process.is_alive():process.kill();process.join()
            receive.close()
