import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSource,failItem} from '../src/collector.mjs';

function memoryRepository(){
 const items=[],transitions=[],duplicates=[],alerts=[],dlq=[];
 return {items,transitions,duplicates,alerts,dlq,
  findByCanonicalKey:async key=>items.find(x=>x.canonicalKey===key),findByContentHash:async hash=>items.find(x=>x.hashContent===hash&&!x.duplicateOf),
  createPending:async x=>{const i={id:'i'+(items.length+1),state:'pendente',...x};items.push(i);return i;},
  transition:async(id,state,reason)=>{const x=items.find(i=>i.id===id);transitions.push([id,x.state,state,reason]);x.state=state;},
  update:async(id,data)=>Object.assign(items.find(i=>i.id===id),data),recordDuplicate:async x=>duplicates.push(x),
  updateSourceCircuit:async(id,b)=>{},alert:async x=>alerts.push(x),enqueueDlq:async x=>dlq.push(x)};
}
test('mesmo conteúdo em duas URLs gera um publicado e uma duplicata descartada',async()=>{
 const repository=memoryRepository(),source={id:'f1',concurrency:5,circuit:{}};
 const rows=[{url:'https://a.test/n1',title:'Notícia',date:'2026-09-10',content:'Mesmo corpo integral'},{url:'https://b.test/outra',title:'Notícia republicada',date:'2026-09-10',content:'Mesmo corpo integral'}];
 const log=await collectSource({source,repository,fetchItems:async()=>rows,normalizeWithAi:async()=>({summary:'Resumo',cities:['Pecém'],confidence:80}),gazetteer:['Pecém']});
 assert.equal(log.status,'concluida');assert.equal(repository.items.length,1);assert.equal(repository.items.filter(x=>x.state==='publicado').length,1);assert.equal(repository.duplicates.length,1);assert.equal(repository.duplicates[0].reason,'duplicado_conteudo');
});
test('IA indisponível usa fallback e a coleta não perde o item',async()=>{
 const repository=memoryRepository();await collectSource({source:{id:'f1',circuit:{}},repository,fetchItems:async()=>[{url:'https://a.test/n',title:'Água',date:'2026-09-10',content:'Aviso para moradores de Pecém'}],normalizeWithAi:async()=>{throw Error('offline')},gazetteer:['Pecém']});
 assert.equal(repository.items[0].state,'publicado');assert.equal(repository.items[0].aiDegraded,true);assert.ok(repository.items[0].confidence<50);
});
test('terceira falha de item envia à DLQ e registra descarte',async()=>{const repository=memoryRepository(),item=await repository.createPending({attempts:2});await repository.transition(item.id,'coletando','coleta_iniciada');const r=await failItem({item,repository,stage:'normalizacao',error:Error('falha')});assert.equal(r.dlq,true);assert.equal(repository.dlq.length,1);assert.equal(item.state,'descartado');});
