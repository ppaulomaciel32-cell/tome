import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createPanelServer,loadConfig} from '../panel-api/server.mjs';
import {createWhatsAppClient} from '../panel-api/whatsapp.mjs';
import {protectProviderLogs,safeLog} from '../whatsapp-bridge/safe-log.mjs';
async function rawFetch(url,options){return new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(options.body);});}
const owner='owner@example.com',editor='editor@example.com';
async function fixture(t,email=owner){
  const calls=[],draftCalls=[];const cfg=loadConfig({SITE_URL:'https://tomezap.com.br',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',PANEL_OWNER_EMAIL:owner,PANEL_EDITOR_EMAILS:editor,PANEL_TRUST_PROXY:'true'});
  const server=createPanelServer({config:cfg,fetchImpl:async url=>url.includes('/user')?Response.json({id:email,email,email_confirmed_at:'2026-10-11'}):Response.json({access_token:'private-fixture-access',refresh_token:'private-fixture-refresh',expires_in:3600}),draftReader:async id=>{draftCalls.push(id);return id?{id,titulo:'Rascunho privado'}:{drafts:[],cycle:null};},whatsappClient:async(path,body)=>{calls.push({path,body});return {state:'awaiting_scan',qr:'data:image/png;base64,Zml4dHVyZQ==',publicationEnabled:false};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));const base='http://127.0.0.1:'+server.address().port;
  const request=(path,{method='GET',body,cookie,csrf,origin=cfg.siteUrl,extra={}}={})=>(extra.Host ? rawFetch : fetch)(base+path,{redirect:'manual',method,headers:{'X-Forwarded-Proto':'https',...(origin?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const response=await request('/painel-api/login',{method:'POST',body:{email,password:'fixture-only'}});const session=await response.json();const cookie=response.headers.get('set-cookie').split(';')[0];
  return {request,calls,draftCalls,cookie,csrf:session.csrf};
}
test('QR, código e grupos exigem sessão; página redireciona visitante ao login',async t=>{
  const f=await fixture(t);
  for(const path of ['pairing','groups','status'])assert.equal((await f.request('/painel-api/whatsapp/'+path)).status,401);
  const page=await f.request('/conectar',{origin:null});assert.equal(page.status,303);assert.equal(page.headers.get('location'),'https://tomezap.com.br/admin/#whatsapp');assert.equal(f.calls.length,0);
});
test('editor vê somente estado, nunca QR nem controles de conexão',async t=>{
  const f=await fixture(t,editor);const status=await f.request('/painel-api/whatsapp/status',{cookie:f.cookie});assert.equal(status.status,200);assert.equal('qr' in await status.json(),false);
  for(const path of ['pairing','groups'])assert.equal((await f.request('/painel-api/whatsapp/'+path,{cookie:f.cookie})).status,403);
  for(const path of ['start','pair-code','group','test'])assert.equal((await f.request('/painel-api/whatsapp/'+path,{method:'POST',cookie:f.cookie,csrf:f.csrf,body:{}})).status,403);
  assert.equal((await f.request('/conectar',{cookie:f.cookie,origin:null})).status,403);assert.equal(f.calls.length,1);
});
test('dono acessa tela privada sem cache com políticas restritas e QR separado do HTML',async t=>{
  const f=await fixture(t);const page=await f.request('/conectar',{cookie:f.cookie,origin:null});assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(page.headers.get('x-robots-tag'),/noindex/);
  const html=await page.text();assert.match(html,/chip exclusivo/);assert.doesNotMatch(html,/base64,Zml4|private-fixture-access|WA_BRIDGE_TOKEN/);
  const qr=await f.request('/painel-api/whatsapp/pairing',{cookie:f.cookie});assert.equal(qr.status,200);assert.ok((await qr.json()).qr);
});
test('mutações de pareamento exigem CSRF e origem autorizada',async t=>{
  const f=await fixture(t);
  for(const path of ['start','pair-code','group','test']){
    const r=await f.request('/painel-api/whatsapp/'+path,{method:'POST',cookie:f.cookie,body:{}});assert.equal(r.status,403);
  }
  const evil=await f.request('/painel-api/whatsapp/start',{method:'POST',cookie:f.cookie,csrf:f.csrf,body:{},origin:'https://chat.tomezap.com.br'});assert.equal(evil.status,403);assert.equal(f.calls.length,0);
  const good=await f.request('/painel-api/whatsapp/start',{method:'POST',cookie:f.cookie,csrf:f.csrf,body:{confirmDedicated:true},origin:'https://bot.tomezap.com.br'});assert.equal(good.status,200);assert.equal(f.calls.length,1);
});
test('GET do pareamento no mesmo domínio exige Host e Sec-Fetch-Site corretos',async t=>{
  const f=await fixture(t);const path='/painel-api/whatsapp/pairing';
  assert.equal((await f.request(path,{cookie:f.cookie,origin:null})).status,403);
  assert.equal((await f.request(path,{cookie:f.cookie,origin:null,extra:{Host:'bot.tomezap.com.br','Sec-Fetch-Site':'same-origin'}})).status,200);
  assert.equal((await f.request(path,{cookie:f.cookie,origin:null,extra:{Host:'chat.tomezap.com.br','Sec-Fetch-Site':'same-origin'}})).status,403);
  assert.equal((await f.request(path,{cookie:f.cookie,origin:null,extra:{Host:'bot.tomezap.com.br','Sec-Fetch-Site':'cross-site'}})).status,403);
});
test('ponte interna fixa destino, mantém token no servidor e filtra erros brutos',async()=>{
  const config={waConfigured:true,waUrl:'http://whatsapp:3090',waToken:'a'.repeat(64)};const calls=[];
  const good=createWhatsAppClient(config,{fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({connected:false});}});
  assert.deepEqual(await good('/status'),{connected:false});assert.equal(calls[0].url,'http://whatsapp:3090/status');assert.equal(calls[0].options.headers['X-Bridge-Token'],config.waToken);
  const bad=createWhatsAppClient(config,{fetchImpl:async()=>Response.json({code:'raw',message:'token-secret-fixture'},{status:500})});await assert.rejects(bad('/status'),e=>!e.message.includes('token-secret'));
  await assert.rejects(createWhatsAppClient({waConfigured:false})('/status'),e=>e.code==='awaiting_connection');
  assert.throws(()=>loadConfig({WA_BRIDGE_URL:'http://169.254.169.254'}));
});
test('limita pedidos repetidos para gerar QR e enviar teste',async t=>{
  const f=await fixture(t);for(let i=0;i<7;i++){const response=await f.request('/painel-api/whatsapp/start',{method:'POST',cookie:f.cookie,csrf:f.csrf,body:{confirmDedicated:true}});assert.equal(response.status,i===6?429:200);}assert.equal(f.calls.length,6);
});
test('logs das dependências não imprimem sessões; log próprio só aceita eventos fixos',()=>{
  const printed=[],target={};for(const method of ['log','info','debug','warn','error','trace','dir','dirxml','table','assert'])target[method]=value=>printed.push(value);
  protectProviderLogs(target);for(const method of Object.keys(target))target[method]({session:'private-fixture'});assert.equal(printed.length,0);
  safeLog('private-fixture',{write:value=>printed.push(value)});assert.equal(printed.length,0);safeLog('bridge_started',{write:value=>printed.push(value)});assert.equal(JSON.parse(printed[0]).event,'bridge_started');
});

test('rascunhos exigem sessão autorizada e não aceitam mutações',async t=>{
  for(const email of [owner,editor]){
    const f=await fixture(t,email);const id=crypto.randomUUID();
    assert.equal((await f.request('/painel-api/drafts')).status,401);
    assert.equal((await f.request('/painel-api/drafts/'+id)).status,401);
    assert.equal(f.draftCalls.length,0);
    const response=await f.request('/painel-api/drafts/'+id,{cookie:f.cookie});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal((await response.json()).id,id);
    assert.equal((await f.request('/painel-api/drafts/'+id,{cookie:f.cookie,method:'POST',body:{status:'published'}})).status,405);
    assert.equal(f.draftCalls.length,1);
    assert.equal((await f.request('/painel-api/drafts/'+id,{cookie:f.cookie,origin:'https://chat.tomezap.com.br'})).status,403);
    assert.equal(f.draftCalls.length,1);
  }
});
test('painel: decisão exige sessão e CSRF, vai à ponte com ator irreversível e mantém editores autorizados',async t=>{
  const f=await fixture(t,editor);const id='0b6b3b6a-1c1d-4e2f-8a3b-4c5d6e7f8a9b';
  const path='/painel-api/drafts/'+id+'/decision',body={kind:'approve',nonce:'11111111-2222-4333-8444-555555555555'};
  assert.equal((await f.request(path,{method:'POST',body})).status,401);
  assert.equal((await f.request(path,{method:'POST',cookie:f.cookie,body})).status,403);
  assert.equal((await f.request(path,{method:'POST',cookie:f.cookie,csrf:f.csrf,body:{kind:'approve'}})).status,400);
  const ok=await f.request(path,{method:'POST',cookie:f.cookie,csrf:f.csrf,body});assert.equal(ok.status,200);
  const call=f.calls.at(-1);assert.equal(call.path,'/decision');assert.equal(call.body.draftId,id);assert.equal(call.body.kind,'approve');
  assert.match(call.body.actor,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(call.body).includes(editor),false);
  assert.equal((await f.request('/painel-api/drafts/'+id+'/decision',{cookie:f.cookie})).status,405);
});
test('painel: resumo da redação e saúde dos serviços exigem sessão',async t=>{
  const f=await fixture(t);
  for(const path of ['/painel-api/newsroom','/painel-api/infra'])assert.equal((await f.request(path)).status,401);
  assert.equal((await f.request('/painel-api/newsroom',{cookie:f.cookie})).status,200);
  const infra=await (await f.request('/painel-api/infra',{cookie:f.cookie})).json();
  assert.deepEqual(infra.services.map(s=>s.id),['site','banco','whatsapp','robo','rascunhos','gemini']);
  for(const s of infra.services)assert.ok(['ok','attention','unknown'].includes(s.state));
});
