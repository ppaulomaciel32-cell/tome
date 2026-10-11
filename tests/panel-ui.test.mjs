// Teste visual opcional para desenvolvimento. O painel não depende de Playwright.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = require(require.resolve('playwright', {paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()]}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('navegador: prévia, celular, login e bloqueio de sessão',async t=>{
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    let relative=pathname === '/docs/painel-preview.html' ? pathname.slice(1) : 'public-site'+pathname;
    if(relative.endsWith('/')) relative+='index.html';
    const resolved=path.resolve(root,relative);
    if(!resolved.startsWith(root+'/public-site/admin/') && resolved!==root+'/docs/painel-preview.html'){res.writeHead(404);res.end();return;}
    try {const bytes=await fs.readFile(resolved);res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml'})[path.extname(resolved)]||'text/plain');res.end(bytes);}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.PANEL_CHROMIUM_PATH ? {executablePath:process.env.PANEL_CHROMIUM_PATH} : {})});t.after(()=>browser.close());
  const qa=process.env.PANEL_QA_DIR || '/tmp/tnn-panel-qa';await fs.mkdir(qa,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const api=[];page.on('request',request=>{if(request.url().includes('bot.tomezap'))api.push(request.url());});
  await t.test('prévia navega por seis módulos sem buscar dados nem publicar',async()=>{
    await page.goto(base+'/admin/preview.html');await page.getByRole('heading',{name:'Sua redação começa aqui.'}).waitFor();
    assert.equal(await page.locator('h1').count(),1);assert.equal(api.length,0);
    await page.screenshot({path:path.join(qa,'desktop.png'),fullPage:true});
    for(const id of ['biblioteca','whatsapp','instagram','tracking','infraestrutura','dashboard']){
      await page.locator(`[data-nav="${id}"]`).click();await page.locator(`[data-nav="${id}"][aria-current="page"]`).waitFor();assert.equal(await page.locator('h1').count(),1);
    }
    assert.equal(api.length,0);
  });
  await t.test('prévia offline inclui a tela de login sem transmitir credenciais',async()=>{
    await page.goto(base+'/docs/painel-preview.html');await page.getByRole('heading',{name:'Sua redação começa aqui.'}).waitFor();
    await page.getByRole('link',{name:'Ir para o login'}).click();await page.getByRole('heading',{name:'Entre na redação.'}).waitFor();
    await page.locator('#email').fill('preview@example.com');await page.locator('#password').fill('only-a-fixture');
    await page.getByRole('button',{name:'Entrar no painel'}).click();await page.getByRole('status').filter({hasText:'O login real depende'}).waitFor();
    assert.equal(api.length,0);await page.screenshot({path:path.join(qa,'login-desktop.png'),fullPage:true});
  });
  await t.test('celular mantém navegação e conteúdo sem rolagem lateral',async()=>{
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await page.goto(base+'/admin/preview.html');await page.getByRole('heading',{name:'Sua redação começa aqui.'}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width===390)await page.screenshot({path:path.join(qa,'mobile.png'),fullPage:true});
      await page.getByRole('button',{name:'Abrir menu'}).click();
      await page.locator('[data-nav="biblioteca"]').click();await page.getByRole('heading',{name:'Uma boa matéria começa aqui.'}).waitFor();
      assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
  });
  await t.test('login real só abre a área depois de validar sessão e rota protegida',async()=>{
    await page.setViewportSize({width:1440,height:1050});let authorized=false;
    await page.route('https://bot.tomezap.com.br/painel-api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type,X-CSRF-Token','Access-Control-Allow-Methods':'GET,POST'};
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
      if(p.endsWith('/login')){
        const body=route.request().postDataJSON();if(body.password!=='fixture-password')return route.fulfill({status:401,headers,json:{message:'Confira seu e-mail e senha.'}});authorized=true;
      }
      if(p.endsWith('/logout')){authorized=false;return route.fulfill({status:204,headers});}
      return route.fulfill({status:authorized?200:401,headers,json:authorized?{user:{id:'test-owner',email:'owner@example.com',role:'owner'},csrf:'fixture-csrf'}:{message:'Entre na sua conta para continuar.'}});
    });
    await page.goto(base+'/admin/');await page.getByRole('heading',{name:'Entre na redação.'}).waitFor();
    assert.equal(await page.locator('.workspace').count(),0);
    await page.locator('#email').fill('owner@example.com');await page.locator('#password').fill('incorrect');await page.getByRole('button',{name:'Entrar no painel'}).click();
    await page.getByRole('status').filter({hasText:'Confira seu e-mail e senha.'}).waitFor();assert.equal(await page.locator('.workspace').count(),0);
    await page.locator('#password').fill('fixture-password');await page.getByRole('button',{name:'Mostrar senha'}).click();assert.equal(await page.locator('#password').getAttribute('type'),'text');
    await page.getByRole('button',{name:'Entrar no painel'}).click();await page.getByRole('heading',{name:'Sua redação começa aqui.'}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    await page.getByRole('button',{name:'Sair do painel'}).click();await page.getByRole('heading',{name:'Entre na redação.'}).waitFor();
    assert.equal(authorized,false);
    await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(qa,'login-mobile.png'),fullPage:true});
  });
  assert.deepEqual(errors,[]);
});
