import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()]}));
const root=path.resolve(new URL('..',import.meta.url).pathname);
test('navegador: leitura privada de rascunhos e demonstração móvel',async t=>{
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');const relative=url.pathname==='/docs/painel-preview.html'?'docs/painel-preview.html':'public-site'+url.pathname+(url.pathname.endsWith('/')?'index.html':'');
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+'/public-site/admin/') && file!==root+'/docs/painel-preview.html'){res.writeHead(404);return res.end();}
    try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM_PATH?{executablePath:process.env.PANEL_CHROMIUM_PATH}:{})});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const qa=process.env.PANEL_QA_DIR || '/tmp/tnn-drafts-qa';await fs.mkdir(qa,{recursive:true});
  const id='00000000-0000-4000-8000-000000000001';let external=0;page.on('request',r=>{if(r.url().startsWith('https://'))external++;});
  await t.test('demonstração mostra fila e texto sem consultar API ou fingir notícia real',async()=>{
    await page.goto(base+'/docs/painel-preview.html#rascunhos');await page.getByRole('heading',{name:'As próximas histórias.'}).waitFor();
    await page.screenshot({path:qa+'/rascunhos-desktop.png',fullPage:true});
    await page.locator('.draft-card').click();await page.getByRole('heading',{name:'Uma nova pauta chega à redação.'}).waitFor();
    assert.match(await page.locator('main').innerText(),/NÃO É UMA NOTÍCIA REAL/);assert.equal(await page.locator('h1').count(),1);
    assert.equal(external,0);await page.screenshot({path:qa+'/leitura-desktop.png',fullPage:true});
  });
  await t.test('rascunho legível em 390 e 320 pixels sem rolagem lateral',async()=>{
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await page.goto(base+'/admin/preview.html#rascunho/'+id);
      await page.getByRole('heading',{name:'Uma nova pauta chega à redação.'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      assert.ok(await page.locator('.draft-body').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=18));
      if(width===390)await page.screenshot({path:qa+'/leitura-mobile.png',fullPage:true});
      await page.getByRole('button',{name:'Abrir menu'}).click();await page.locator('[data-nav=rascunhos]').click();await page.getByRole('heading',{name:'As próximas histórias.'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  });
  let authorized=false,draftReads=0;
  await page.route('https://bot.tomezap.com.br/painel-api/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token','Access-Control-Allow-Methods':'GET,POST'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(!authorized)return route.fulfill({status:401,headers,json:{message:'Entre na sua conta para continuar.'}});
    if(p.includes('/drafts/')){draftReads++;return route.fulfill({headers,json:{id,titulo:'<img src=x onerror=alert(1)>',resumo:'Texto de teste de segurança, não é uma notícia.',texto:'Conteúdo <script>alert(1)</script> deve aparecer como texto.',localidade:'regiao',revisao:1,fontes:[{name:'Fonte de teste',title:'Endereço inválido bloqueado',url:'javascript:alert(1)'}],evidencias:[]}});}
    return route.fulfill({headers,json:{user:{id:'test-owner',role:'owner'},csrf:'fixture'}});
  });
  await t.test('link direto exige login antes de buscar a matéria',async()=>{
    await page.goto(base+'/admin/#rascunho/'+id);await page.getByRole('heading',{name:'Entre na redação.'}).waitFor();assert.equal(draftReads,0);
  });
  await t.test('leitura autenticada escapa HTML e bloqueia link de script',async()=>{
    authorized=true;await page.reload();await page.locator('.draft-body').waitFor();
    assert.equal(draftReads,1);assert.equal(await page.locator('main script,main img').count(),0);assert.equal(await page.locator('main a[href^="javascript:"]').count(),0);
    assert.match(await page.locator('h1').innerText(),/<img/);assert.match(await page.locator('.draft-body').innerText(),/<script>/);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  });
  assert.deepEqual(errors,[]);
});
