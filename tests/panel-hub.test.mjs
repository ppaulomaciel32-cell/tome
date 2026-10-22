import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><main id="m"></main>',{url:'https://tomezap.com.br/admin/'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document});
const {draftDetail,draftList}=await import('../public-site/admin/drafts.mjs');
const {mountDraftActions,toolsPage}=await import('../public-site/admin/hub.mjs');
const id='0b6b3b6a-1c1d-4e2f-8a3b-4c5d6e7f8a9b',tick=()=>new Promise(r=>setTimeout(r,5));
const draft=extra=>({id,titulo:'Título <b>x</b>',resumo:'Resumo',texto:'Um.\n\nDois.',localidade:'pecem',revisao:1,fontes:[],evidencias:[],capa_url:'https://bot.tomezap.com.br/imagens/'+'a'.repeat(32)+'-1600.jpg',capa_credito:'Maria',...extra});
test('painel: rascunho mostra capa do próprio servidor e escapa o texto',()=>{
  const main=document.getElementById('m');main.innerHTML=draftDetail(draft(),false,{number:7,actions:true});
  assert.ok(main.querySelector('.draft-cover img'));assert.equal(main.querySelector('figcaption').textContent,'Foto: Maria');assert.equal(main.querySelector('h1 b'),null);
  main.innerHTML=draftDetail(draft({capa_url:'https://evil.example/x.jpg'}),false,{number:null,actions:false});
  assert.equal(main.querySelector('.draft-cover'),null);assert.equal(main.querySelector('[data-draft-actions]'),null);
  main.innerHTML=draftList({drafts:[{id,titulo:'A',resumo:'B',localidade:'pecem'}]},false,{[id]:7});assert.match(main.innerHTML,/RASCUNHO Nº 7/);
});
test('painel: aprovar pede confirmação; correção exige texto; cada pedido leva um identificador novo',async()=>{
  const main=document.getElementById('m'),calls=[];let answer=false;window.confirm=()=>answer;
  main.innerHTML=draftDetail(draft(),false,{number:7,actions:true});mountDraftActions(main,{id,request:async(path,body)=>{calls.push([path,body]);return {queued:true,number:7};}});
  main.querySelector('[data-act=approve]').click();await tick();assert.equal(calls.length,0);
  answer=true;main.querySelector('[data-act=approve]').click();await tick();
  assert.equal(calls[0][0],'/drafts/'+id+'/decision');assert.equal(calls[0][1].kind,'approve');assert.match(calls[0][1].nonce,/^[a-f0-9-]{36}$/);
  assert.ok(main.querySelector('[data-act=reject]').disabled);
  main.innerHTML=draftDetail(draft(),false,{number:7,actions:true});mountDraftActions(main,{id,request:async(path,body)=>{calls.push([path,body]);return {};}});
  main.querySelector('[data-act=fix]').click();assert.equal(calls.length,1);
  main.querySelector('#edit-text').value='deixe mais curto';main.querySelector('[data-act=fix]').click();await tick();
  assert.deepEqual([calls[1][1].kind,calls[1][1].mode,calls[1][1].text],['edit','fix','deixe mais curto']);assert.notEqual(calls[1][1].nonce,calls[0][1].nonce);
});
test('painel: sem foto real o Aprovar fica travado e o envio da capa vem primeiro',async()=>{
  const main=document.getElementById('m'),calls=[];window.confirm=()=>true;
  main.innerHTML=draftDetail(draft({capa_url:null}),false,{number:9,actions:true,photo:false});
  mountDraftActions(main,{id,draft:draft({capa_url:null}),photo:false,request:async(path,body)=>{calls.push([path,body]);return {};}});
  const approve=main.querySelector('[data-act=approve]');assert.ok(approve.disabled);assert.match(approve.textContent,/falta a foto/);
  const alert=main.querySelector('.draft-photo-needed');assert.match(alert.textContent,/FOTO 9/);
  const upload=alert.querySelector('details.draft-edit');assert.ok(upload && upload.open);assert.match(upload.querySelector('summary').textContent,/foto de capa/i);
  approve.click();await tick();assert.equal(calls.length,0);
  main.innerHTML=draftList({drafts:[{id,titulo:'A',resumo:'B',localidade:'pecem'}]},false,{[id]:9},{[id]:false});assert.match(main.innerHTML,/SEM FOTO/);
  main.innerHTML=draftDetail(draft(),false,{number:7,actions:true});assert.equal(main.querySelector('.draft-photo-needed'),null);assert.equal(main.querySelector('[data-act=approve]').disabled,false);
});
test('painel: ferramentas só apontam para o túnel local',()=>{
  const links=[...new JSDOM(toolsPage()).window.document.querySelectorAll('a')].map(a=>a.href);
  assert.equal(links.length,5);for(const link of links)assert.match(link,/^http:\/\/localhost:181\d\d\/$/);
});
test('editor direto mantém o texto escrito e só pede outra prévia, sem aprovar escondido',async()=>{
  const main=document.getElementById('m'),calls=[],data=draft({titulo:'Título original'});
  main.innerHTML=draftDetail(data,false,{number:7,actions:true});mountDraftActions(main,{id,draft:data,request:async(path,body)=>{calls.push(body);return {};}});
  main.querySelector('[data-field=texto]').value='Texto exato do editor.';
  main.querySelector('[data-editor=direct]').click();await tick();
  assert.equal(calls[0].kind,'edit');assert.equal(calls[0].mode,'direct');assert.equal(calls[0].fields.texto,'Texto exato do editor.');
  assert.ok(main.querySelector('[data-photo]'));assert.ok(main.querySelector('[data-schedule]'));
});
