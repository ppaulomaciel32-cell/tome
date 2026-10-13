// Testes de interface com APIs simuladas; não pareiam nem enviam mensagens reais.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {qrEncoder} from '../whatsapp-bridge/baileys-adapter.mjs';
const require=createRequire(import.meta.url), {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()]}));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('navegador: pareamento privado e prévia responsiva',async t=>{
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const files={'/conectar':'panel-api/connect/index.html','/conectar/connection.css':'panel-api/connect/connection.css','/conectar/connection.mjs':'panel-api/connect/connection.mjs','/preview':'docs/whatsapp-conexao-preview.html'};
    const file=files[pathname];if(!file){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.mjs')?'text/javascript':'text/html');res.end(await fs.readFile(path.join(root,file)));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM_PATH?{executablePath:process.env.PANEL_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1080}}), base='http://127.0.0.1:'+server.address().port;
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/painel-api'))requests.push(r.url());});
  const qa='/tmp/tnn-wa-qa';await fs.mkdir(qa,{recursive:true});
  await t.test('prévia em desktop e celular não envia dados, não oferece QR fictício e não transborda',async()=>{
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:1080});await page.goto(base+'/preview');await page.locator('#preview-notice').waitFor();assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('#start').isDisabled(),true);assert.equal(await page.locator('#qr-image').isHidden(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(qa,'preview-'+width+'.png'),fullPage:true});}
    assert.equal(requests.length,0);
  });
  let status={state:'idle',configured:true,connected:false,group:null,dedicatedNumber:'••••0000'}, authorized=true, tests=0;
  const qr=await qrEncoder('FIXTURE-ONLY-NO-WHATSAPP-SESSION');
  await page.route('**/painel-api/**',async route=>{
    if(!authorized)return route.fulfill({status:401,json:{message:'Sua sessão expirou. Volte ao painel e entre novamente.'}});
    const p=new URL(route.request().url()).pathname;
    if(p.endsWith('/session'))return route.fulfill({json:{user:{role:'owner'},csrf:'fixture-csrf'}});
    if(p.endsWith('/start')){assert.equal(route.request().headers()['x-csrf-token'],'fixture-csrf');assert.equal(route.request().postDataJSON().confirmRiskAccepted,true);status={...status,state:'awaiting_scan',qr,expiresAt:new Date(Date.now()+55000).toISOString()};}
    if(p.endsWith('/pair-code'))status={...status,qr:null,pairingCode:'ABCD1234',expiresAt:new Date(Date.now()+60000).toISOString()};
    if(p.endsWith('/groups'))return route.fulfill({json:{groups:[{id:'120363123456789000@g.us',name:'Comando Tome Nota',participants:3}]}});
    if(p.endsWith('/group')){assert.equal(route.request().postDataJSON().confirmGroup,true);status={...status,group:{id:'120363123456789000@g.us',name:'Comando Tome Nota'}};}
    if(p.endsWith('/test'))tests++;
    return route.fulfill({json:status});
  });
  await t.test('pareamento exige ciência do risco; QR e código somem depois de conectar',async()=>{
    await page.setViewportSize({width:1440,height:1080});await page.goto(base+'/conectar');await page.getByText('Pronto para conectar',{exact:true}).waitFor();assert.equal(await page.locator('#start').isDisabled(),true);
    await page.locator('#dedicated-confirm').check();await page.locator('#start').click();await page.locator('#qr-image').waitFor();assert.match(await page.locator('#qr-image').getAttribute('src'),/^data:image\/png/);
    await page.locator('#phone').click();await page.getByText('ABCD1234',{exact:true}).waitFor();assert.equal(await page.locator('#qr-image').isHidden(),true);
    assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
    status={...status,state:'connected',connected:true,qr:null,pairingCode:null};await page.reload();await page.getByText('WhatsApp conectado',{exact:true}).waitFor();assert.equal(await page.locator('#qr-image').isHidden(),true);assert.equal(await page.locator('#pair-code').isHidden(),true);
  });
  await t.test('grupo só é confirmado pela pessoa e teste envia uma única chamada explícita',async()=>{
    assert.equal(tests,0);await page.locator('#load-groups').click();await page.locator('#group-form').waitFor();await page.locator('#group-confirm').check();await page.getByRole('button',{name:'Confirmar este grupo'}).click();await page.getByText('Grupo confirmado',{exact:true}).waitFor();assert.equal(tests,0);
    await page.locator('#test-send').click();await page.getByText('Mensagem de teste enviada. Confira no grupo do WhatsApp.').waitFor();assert.equal(tests,1);
  });
  await t.test('perda de sessão remove QR e bloqueia controles',async()=>{
    status={...status,state:'awaiting_scan',connected:false,qr,expiresAt:new Date(Date.now()+55000).toISOString()};await page.reload();await page.locator('#qr-image').waitFor();authorized=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByText('Sua sessão expirou. Volte ao painel e entre novamente.').waitFor();assert.equal(await page.locator('#qr-image').isHidden(),true);assert.equal(await page.locator('#qr-image').getAttribute('src'),null);assert.equal(await page.locator('#start').isDisabled(),true);
  });assert.deepEqual(errors,[]);
});
