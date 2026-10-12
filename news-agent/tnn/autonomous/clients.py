import http.client
import json
import re
from ..core import AgentError,required
from ..providers import Net

class Drafts:
    def __init__(self,net=None):
        self.net=net or Net();self.url=required('TNN_DRAFTS_URL');self.token=required('TNN_DRAFT_SERVICE_TOKEN')
        if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co/functions/v1/tnn-drafts',self.url) or not re.fullmatch(r'[a-f0-9]{64}',self.token):
            raise AgentError('Configure o destino privado de rascunhos e seu token exclusivo.')
    def call(self,payload=None,action='context'):
        return self.net.json(self.url+('?action='+action if payload is None else ''),payload,
            {'x-draft-token':self.token},timeout=15,max_bytes=1000000)

class Bridge:
    def __init__(self):
        self.token=required('WA_PIPELINE_TOKEN')
        if not re.fullmatch(r'[a-f0-9]{64}',self.token): raise AgentError('Token do ciclo inválido.')
    def call(self,path,payload=None):
        if path not in ('/pipeline-state','/preview','/notice','/cycle-status'): raise AgentError('Operação do ciclo não autorizada.')
        connection=http.client.HTTPConnection('whatsapp',3090,timeout=12)
        try:
            connection.request('POST' if payload is not None else 'GET',path,
                json.dumps(payload,ensure_ascii=False).encode() if payload is not None else None,
                {'Content-Type':'application/json','x-pipeline-token':self.token})
            response=connection.getresponse();raw=response.read(12001)
            if response.status!=200 or len(raw)>12000: raise AgentError('A conexão do grupo não confirmou a operação.')
            return json.loads(raw)
        except (OSError,http.client.HTTPException,ValueError):
            # Nunca repetir automaticamente um envio sem confirmação.
            raise AgentError('O grupo não confirmou a operação. Confira a prévia no painel.') from None
        finally: connection.close()

