import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWorkflowReader,safeCycle} from '../panel-api/workflow.mjs';
import {createPanelServer,loadConfig} from '../panel-api/server.mjs';
import {operationsHTML,operationsDemo,mountOperations} from '../public-site/admin/operations.mjs';
const id='00000000-0000-4000-8000-000000000001';
const at=Date.parse('2026-10-12T23:55:00Z');
const config={siteUrl:'https://tomezap.com.br',supabaseUrl:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture'};
function setup({wa,draftData,site=200,news=[],failed=[],clock=()=>at}={}){
  const calls=[];
  const reader=createWorkflowReader(config,{now:clock,
    whatsapp:async p=>{calls.push(p);if(failed.includes('wa'))throw Error('PRIVATE_TOKEN');return wa ?? {connected:true,group:{id:'PRIVATE_GROUP',name:'Comando Tome Nota'}};},
    drafts:async()=>{calls.push('drafts');if(failed.includes('drafts'))throw Error('PRIVATE_TOKEN');return draftData ?? {drafts:[],cycle:null};},
    fetchImpl:async(url,options)=>{
      calls.push({url,options});if(failed.includes(url===config.siteUrl+'/'?'site':'news'))throw Error('PRIVATE_PROVIDER');
      return url===config.siteUrl+'/'?new Response(null,{status:site}):Response.json(news);
    }});
  return {reader,calls};
}
test('fluxo: conexão WhatsApp e HTTP 200 não significam publicação ou IA funcionando',async()=>{
  const f=setup();const data=await f.reader();
  assert.equal(data.stations.find(s=>s.id==='whatsapp').state,'ready');
  assert.equal(data.stations.find(s=>s.id==='site').state,'ready');
  assert.equal(data.stations.find(s=>s.id==='redacao').state,'unknown');
  assert.equal(data.stations.find(s=>s.id==='publicacao').state,'blocked');
  assert.deepEqual(data.capabilities,{manualPauta:false,approval:false,publication:false});
  assert.ok(data.blockers.some(b=>b.id==='no_cycle'));assert.deepEqual(data.publications,[]);
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE_GROUP|sb_publishable/);
  assert.equal(f.calls.filter(c=>c.options).every(c=>!c.options.method || c.options.method==='HEAD'),true);
});
test('fluxo: apenas a etapa explicitamente informada aparece trabalhando',async()=>{
  for(const stage of ['coleta','redacao']){
    const data=await setup({wa:{connected:true,group:{},cycle:{state:'running',stage,at}}}).reader();
    assert.deepEqual(data.stations.filter(s=>s.state==='working').map(s=>s.id),[stage]);
  }
  const missing=await setup({wa:{cycle:{state:'running',at}}}).reader();
  assert.equal(missing.stations.some(s=>s.state==='working'),false);
});
test('fluxo: salvamento e envio da prévia usam mesas próprias; histórico não contém dados privados',async()=>{
  for(const [stage,room] of [['rascunho','revisao'],['previa','whatsapp']]){
    const data=await setup({wa:{connected:true,group:{},cycle:{state:'running',stage,at},cycleEvents:[{state:'running',stage,at,token:'PRIVATE_TOKEN',message:'PRIVATE_TEXT'}]}}).reader();
    assert.deepEqual(data.stations.filter(s=>s.state==='working').map(s=>s.id),[room]);
    assert.equal(data.events.length,1);assert.doesNotMatch(JSON.stringify(data.events),/PRIVATE/);
  }
});
test('fluxo: horário antigo, futuro e falha de consulta nunca viram atividade atual',async()=>{
  assert.equal(safeCycle({state:'running',stage:'redacao',at:at-16*60000},at).stale,true);
  assert.equal(safeCycle({state:'running',at:at+120000},at),null);
  assert.equal(safeCycle({state:'unexpected',at},at),null);
  const old=await setup({wa:{cycle:{state:'running',stage:'redacao',at:at-16*60000}}}).reader();
  assert.equal(old.stations.some(s=>s.state==='working'),false);assert.ok(old.blockers.some(b=>b.id==='stale_cycle'));
  const bad=await setup({failed:['wa','drafts','site','news']}).reader();
  assert.ok(bad.stations.filter(s=>s.id!=='publicacao').every(s=>s.state==='unknown'));
  assert.equal(bad.publications,null);assert.doesNotMatch(JSON.stringify(bad),/PRIVATE/);
});
test('fluxo: ciclo no Supabase é fallback e códigos viram explicação segura',async()=>{
  const data=await setup({draftData:{drafts:[],cycle:{status:'skipped',etapa:'coleta',codigo:'weak_sources',atualizado_em:new Date(at).toISOString()}}}).reader();
  assert.equal(data.cycle.stage,'coleta');assert.match(data.stations.find(s=>s.id==='coleta').detail,/duas fontes/);
});
test('fluxo: lê apenas colunas públicas e não transforma registro no banco em deploy verificado',async()=>{
  const f=setup({news:[{id,title:'Teste de segurança',slug:'teste',published_at:new Date(at-1000).toISOString(),body:'PRIVATE_BODY',token:'SECRET'}]});
  const data=await f.reader();const query=f.calls.find(c=>c.url?.includes('/rest/v1/'));
  assert.match(query.url,/select=id,title,slug,published_at/);assert.doesNotMatch(query.url,/\*|rascunhos|radar/);
  assert.equal(data.limits.publicationCheck,'database_only');assert.equal(data.publications[0].slug,'teste');
  assert.doesNotMatch(JSON.stringify(data),/PRIVATE_BODY|SECRET|apikey|Authorization/);
});
test('fluxo: destinos fixos, sem seguir redirecionamentos, consultas compartilhadas por dez segundos',async()=>{
  let time=at;const f=setup({clock:()=>time});
  const [a,b]=await Promise.all([f.reader(),f.reader()]);assert.deepEqual(a,b);assert.equal(f.calls.length,4);
  await f.reader();assert.equal(f.calls.length,4);time+=10001;await f.reader();assert.equal(f.calls.length,8);
  assert.ok(f.calls.filter(c=>c.options).every(c=>c.options.redirect==='error'));
});
test('fluxo: resposta enorme, formato inválido e slug malicioso não passam pela leitura pública',async()=>{
  const f=setup({news:[{id,title:'Teste',slug:'javascript:evil',published_at:new Date(at).toISOString()}]});
  assert.deepEqual((await f.reader()).publications,[]);
  const r=createWorkflowReader(config,{whatsapp:async()=>({}),drafts:async()=>({}),now:()=>at,fetchImpl:async url=>url.endsWith('/')?new Response(null):Response.json({raw:'x'.repeat(31000)})});
  assert.equal((await r()).publications,null);
});
test('painel: observação exige sessão autorizada, origem correta e GET; não executa ação de publicação',async t=>{
  let reads=0;const cfg=loadConfig({SITE_URL:config.siteUrl,SUPABASE_URL:config.supabaseUrl,SUPABASE_PUBLISHABLE_KEY:config.publicKey,PANEL_OWNER_EMAIL:'owner@example.com',PANEL_EDITOR_EMAILS:'editor@example.com',PANEL_TRUST_PROXY:'true'});
  for(const email of ['owner@example.com','editor@example.com']){
    const server=createPanelServer({config:cfg,workflowReader:async()=>{reads++;return {schemaVersion:1};},fetchImpl:async url=>url.endsWith('/user')?Response.json({id:email,email,email_confirmed_at:'2026-10-12'}):Response.json({access_token:'PRIVATE_ACCESS',refresh_token:'PRIVATE_REFRESH',expires_in:3600})});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
    const base='http://127.0.0.1:'+server.address().port;
    const req=(method='GET',cookie='',origin=cfg.siteUrl)=>fetch(base+'/painel-api/workflow',{method,headers:{Origin:origin,'X-Forwarded-Proto':'https',Cookie:cookie}});
    assert.equal((await req()).status,401);assert.equal(reads,email==='owner@example.com'?0:1);
    const login=await fetch(base+'/painel-api/login',{method:'POST',headers:{Origin:cfg.siteUrl,'X-Forwarded-Proto':'https','Content-Type':'application/json'},body:JSON.stringify({email,password:'fixture'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('POST',cookie)).status,405);assert.equal((await req('GET',cookie,'https://chat.tomezap.com.br')).status,403);
    const response=await req('GET',cookie);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).schemaVersion,1);
  }
  assert.equal(reads,2);
});
test('visual: seis mesas, demonstração rotulada, texto escapado e sem formulário para publicar',()=>{
  const data=operationsDemo();const html=operationsHTML(data);
  assert.equal((html.match(/data-ops-station=/g)||[]).length,6);assert.match(html,/DEMONSTRAÇÃO · NÃO É ATIVIDADE REAL/);
  assert.equal((html.match(/<h1>/g)||[]).length,1);assert.doesNotMatch(html,/<form|data-publish/);
  const evil=operationsHTML({mode:'live',blockers:[{text:'<img src=x onerror=alert(1)>'}],drafts:[{id,title:'<script>BAD</script>'}]});
  assert.doesNotMatch(evil,/<img|<script>/);assert.match(evil,/&lt;script&gt;/);
});
test('visual: CSS responsivo, animação só na etapa ativa e respeito à redução de movimento',async()=>{
  const css=await readFile(new URL('../public-site/admin/operations.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.state-working \.ops-avatar\{animation:ops-type/);
  assert.doesNotMatch(css,/\.state-ready \.ops-avatar\{animation/);
});
test('DOM: navegação, consulta real, falha, pausa em aba oculta e limpeza de timers', {skip:!process.env.TNN_TEST_DOM_MODULE},async()=>{
  const {parseHTML}=await import(process.env.TNN_TEST_DOM_MODULE);
  const {document}=parseHTML('<div id="ops"></div>');let hidden=false;
  Object.defineProperty(document,'hidden',{get:()=>hidden});const root=document.getElementById('ops');let reads=0,fail=false,scheduled=[];
  const data=await setup({wa:{connected:true,group:{},cycle:{state:'running',stage:'redacao',at}}}).reader();
  const cleanup=mountOperations(root,{doc:document,request:async()=>{reads++;if(fail)throw Error();return data;},schedule:(fn,ms)=>{const handle={fn,ms};scheduled.push(handle);return handle;},cancel:handle=>{if(handle)handle.cancelled=true;}});
  const tick=()=>new Promise(r=>setImmediate(r));await tick();
  assert.equal(reads,1);assert.equal(root.querySelectorAll('.state-working').length,1);
  root.querySelector('[data-ops-station=redacao]').click();assert.match(root.querySelector('[data-ops-title]').textContent,/Gemini/);
  assert.equal(root.querySelector('[data-ops-station=redacao]').getAttribute('aria-pressed'),'true');
  fail=true;root.querySelector('[data-ops-refresh]').click();await tick();assert.equal(root.querySelectorAll('.state-ready,.state-working').length,0);assert.match(root.textContent,/CONEXÃO INDISPONÍVEL/);
  hidden=true;document.dispatchEvent(new document.defaultView.Event('visibilitychange'));const before=reads;
  root.querySelector('[data-ops-refresh]').click();await tick();assert.equal(reads,before);
  hidden=false;document.dispatchEvent(new document.defaultView.Event('visibilitychange'));await tick();assert.equal(reads,before+1);
  cleanup();assert.ok(scheduled.every(h=>h.cancelled));root.querySelector('[data-ops-refresh]').click();await tick();assert.equal(reads,before+1);
});
test('DOM: demonstração nunca consulta servidor', {skip:!process.env.TNN_TEST_DOM_MODULE},async()=>{
  const {parseHTML}=await import(process.env.TNN_TEST_DOM_MODULE);const {document}=parseHTML('<div id="ops"></div>');
  const root=document.getElementById('ops');const cleanup=mountOperations(root,{doc:document,preview:true,request:()=>assert.fail('demo não faz fetch')});
  root.querySelector('[data-ops-refresh]').click();assert.match(root.textContent,/DEMONSTRAÇÃO/);cleanup();
});
test('DOM: sair da tela descarta resposta pendente e erro de sessão chama login', {skip:!process.env.TNN_TEST_DOM_MODULE},async()=>{
  const {parseHTML}=await import(process.env.TNN_TEST_DOM_MODULE);const {document}=parseHTML('<div id="ops"></div>');
  const root=document.getElementById('ops');let release,login=0;
  const cleanup=mountOperations(root,{doc:document,request:()=>new Promise(r=>{release=r;})});
  cleanup();const html=root.innerHTML;release({schemaVersion:1,mode:'live',stations:[]});await new Promise(r=>setImmediate(r));assert.equal(root.innerHTML,html);
  const stop=mountOperations(root,{doc:document,request:async()=>{throw Object.assign(Error('fixture session'),{status:401});},onAuthError:()=>{login++;},schedule:()=>null});
  await new Promise(r=>setImmediate(r));assert.equal(login,1);assert.match(root.textContent,/CONEXÃO INDISPONÍVEL/);stop();
});
