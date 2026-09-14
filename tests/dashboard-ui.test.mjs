import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
test('dashboard: cards abrem pauta atual, filtros e erros funcionam sem travar',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://teste.invalid',runScripts:'outside-only'});
 const now='2026-09-14T12:00:00Z';
 const p={id:'p1',codigo:'TESTE-1',titulo:'Vagas no Pecém — <img src=x onerror=alert(1)>',localidade:'Pecém',categoria:'Emprego',criada_em:now,data_documento:'2026-09-14',status:'apurar',versao:1,tem_evidencia:true,url_fonte:'https://example.org/noticia',fonte:'Fonte teste',agente:'Emprego'};
 const raw={servidor_em:now,total_pautas:2,pautas:[p,{...p,id:'old',titulo:'Documento antigo',data_documento:'2026-01-01'}],fontes:[{id:'s',nome:'Fonte indisponível',ativa:true,ultimo_erro_texto:'Conexão interrompida'}],coletas_24h:[],agentes:[{id:'a',numero:2,nome:'Emprego',atribuicoes:1,ativo:true}]};
 let failure=false,opened=null;const calls=[];
 dom.window.testRequest=async path=>{calls.push(path);if(failure)throw Error('Falha temporária de teste');return path==='/dashboard'?raw:{pauta:{...p,versao:2}}};
 dom.window.testOpen=x=>{opened=x};
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from './web/dashboard.jsx';window.testRoot=createRoot(document.getElementById('root'));window.testRoot.render(<Dashboard request={window.testRequest} open={window.testOpen} userId="u" roomId="r"/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,define:{'process.env.NODE_ENV':'"production"'}});
 dom.window.eval(result.outputFiles[0].text);
 const tick=()=>new Promise(r=>setTimeout(r,35));
 const doc=dom.window.document,button=txt=>[...doc.querySelectorAll('button')].find(b=>b.textContent===txt);
 const click=async txt=>{assert.ok(button(txt),'Botão '+txt);button(txt).click();await tick()};
 try{
  await tick();await tick();
  assert.equal(doc.querySelectorAll('.story-card').length,1);assert.equal(doc.querySelectorAll('.story-card img').length,0);
  await click('Abrir apuração →');assert.equal(opened.pauta.versao,2);assert.ok(calls.includes('/pautas/p1'));
  await click('Mesa de pautas');await click('Marcar entradas como vistas');assert.equal(dom.window.localStorage.getItem('radar-seen:u:r'),now);
  const selects=doc.querySelectorAll('select');selects[1].value='archive';selects[1].dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();assert.match(doc.querySelector('.story-card').textContent,/Documento antigo/);
  selects[0].value='Caucaia';selects[0].dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();assert.match(doc.body.textContent,/Nenhuma pauta atende/);
  await click('Limpar filtros e ver todas');assert.equal(doc.querySelectorAll('.story-card').length,2);
  const source=doc.querySelector('.story-card a');assert.equal(source.target,'_blank');assert.equal(source.rel,'noopener noreferrer');
  await click('Saúde das fontes');assert.match(doc.body.textContent,/Conexão interrompida/);
  await click('Agentes');assert.match(doc.body.textContent,/1 candidatos atribuídos/);
  failure=true;await click('Atualizar agora');await tick();assert.match(doc.querySelector('[role=alert]').textContent,/dados anteriores foram mantidos/);
  failure=false;await click('Tentar novamente');await tick();assert.equal(doc.querySelector('[role=alert]'),null);
  await click('Visão do dia');
  if(process.env.RADAR_UI_SNAPSHOT){const css=await readFile('web/style.css','utf8');await writeFile('/tmp/radar-dashboard-static.html','<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style>'+doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g,''));}
 }finally{dom.window.testRoot.unmount();dom.window.close()}
});
