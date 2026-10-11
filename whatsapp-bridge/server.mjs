import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {BridgeError,createController,loadBridgeConfig} from './controller.mjs';
import {openVault} from './vault.mjs';
import {protectProviderLogs,safeLog} from './safe-log.mjs';

export function createBridgeServer({controller,token}) {
  return http.createServer({requestTimeout:15000,headersTimeout:10000,maxHeaderSize:8192},async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body));};
    try {
      const path=new URL(req.url,'http://bridge.invalid').pathname;
      // Apenas estado agregado, sem QR, grupo, números, códigos ou credenciais.
      if(path==='/healthz' && req.method==='GET'){const h=controller.health();return send(h.ok?200:503,h);}
      if(path==='/livez' && req.method==='GET')return send(200,{ok:true});
      const provided=Buffer.from(req.headers['x-bridge-token'] || ''), expected=Buffer.from(token);
      if(provided.length!==expected.length || !timingSafeEqual(provided,expected))throw new BridgeError(401,'unauthorized','Acesso não autorizado.');
      const routes = {
        'GET /status':()=>controller.status(),'GET /pairing':()=>controller.pairing(),'GET /groups':()=>controller.groups(),
        'POST /start':body=>controller.start(body),'POST /pair-code':()=>controller.pairCode(),
        'POST /group':body=>controller.selectGroup(body),'POST /test':()=>controller.test()
      };
      const action=routes[req.method+' '+path];if(!action)throw new BridgeError(404,'not_found','Endereço não encontrado.');
      let body={};
      if(req.method==='POST') {
        if(!/^application\/json(?:;|$)/.test(req.headers['content-type']||''))throw new BridgeError(415,'invalid_body','Use JSON.');
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>2048)throw new BridgeError(413,'too_large','Pedido grande demais.');chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks));if(!body || Array.isArray(body)||typeof body!=='object')throw Error();}catch{throw new BridgeError(400,'invalid_body','Dados inválidos.');}
      }
      send(200,await action(body));
    }catch(error){send(error instanceof BridgeError?error.status:503,{code:error instanceof BridgeError?error.code:'bridge_unavailable',message:error instanceof BridgeError?error.message:'A conexão está indisponível. Confira o estado e tente novamente.'});}
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    protectProviderLogs();
    const fatal=()=>{safeLog('fatal_error');process.exit(1);};
    process.on('uncaughtException',fatal);process.on('unhandledRejection',fatal);
    process.umask(0o077);
    const config=loadBridgeConfig();
    const adapter=await import('./baileys-adapter.mjs');
    const vault=openVault({directory:config.directory,key:config.key,codec:adapter.BufferJSON});
    const controller=createController({config,vault,auth:vault.auth(adapter.initAuthCreds,adapter.reviveAppState),socketFactory:adapter.socketFactory,qrEncoder:adapter.qrEncoder});
    const server=createBridgeServer({controller,token:config.token});
    server.listen(3090,'0.0.0.0',()=>safeLog('bridge_started'));
    await controller.resume();
    let stopping=false;
    for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{
      if(stopping)return;stopping=true;server.close();
      setTimeout(()=>process.exit(1),15000).unref();
      await controller.close();vault.close();server.closeAllConnections();process.exit(0);
    });
  }catch{safeLog('startup_failed');process.exitCode=1;}
}
