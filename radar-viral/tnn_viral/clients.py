import http.client
import json
from tnn.providers import Net
from tnn.core import AgentError

class API:
    def __init__(self,config,net=None):self.c=config;self.net=net or Net()
    def call(self,body=None,id=None):
        return self.net.json(self.c.edge+('?id='+id if id else ''),body,{'x-draft-token':self.c.draft_token},timeout=12,max_bytes=500000)
    def get(self,id):
        rows=self.call(id=id).get('items',[])
        if not rows:raise AgentError('proposal_not_found')
        return rows[0]

class Relay:
    def __init__(self,token):self.token=token
    def call(self,path,body=None):
        if path not in ('/pipeline-state','/radar/preview','/radar/handoff','/radar/notice'):raise AgentError('invalid_route')
        c=http.client.HTTPConnection('whatsapp',3090,timeout=10)
        try:
            c.request('POST' if body is not None else 'GET',path,json.dumps(body,ensure_ascii=False).encode() if body is not None else None,
              {'content-type':'application/json','x-pipeline-token':self.token})
            r=c.getresponse();raw=r.read(20001)
            if r.status!=200 or len(raw)>20000:raise AgentError('relay_unavailable',True)
            return json.loads(raw)
        except (OSError,http.client.HTTPException,ValueError):raise AgentError('relay_unavailable',True) from None
        finally:c.close()
