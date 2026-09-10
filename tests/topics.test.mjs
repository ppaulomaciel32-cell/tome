import test from 'node:test';
import assert from 'node:assert/strict';
import {baseline24h,evaluateTopic,nextLifecycle,canJoinTopic,clusterWithFallback,advanceLifecycle} from '../src/topics.mjs';
const now=Date.parse('2026-09-10T12:00:00Z');
const items=(n,{sources=n,authors=n,platform='web',confidence=80}={})=>Array.from({length:n},(_,i)=>({occurredAt:new Date(now-i*360000).toISOString(),sourceId:'s'+(i%sources),authorId:'a'+(i%authors),platform,confidence}));
test('dois itens do mesmo veículo nunca viram tendência',()=>{const r=evaluateTopic(items(2,{sources:1}),{now});assert.equal(r.label,'sinal_fraco');assert.equal(r.minimums.diversity,false);});
test('Instagram exige volume, autores, crescimento e corroboração editorial',()=>{
 let r=evaluateTopic(items(10,{sources:6,authors:5,platform:'instagram'}),{now,platform:'instagram'});assert.notEqual(r.label,'tendencia');assert.equal(r.minimums.corroboration,false);
 r=evaluateTopic(items(10,{sources:6,authors:5,platform:'instagram'}),{now,platform:'instagram',editorialCorroboration:true});assert.equal(r.label,'tendencia');
});
test('baseline zero divide por um',()=>{const r=evaluateTopic(items(5,{sources:3}),{now,history:[]});assert.equal(r.baseline24h,0);assert.equal(r.growth,5);assert.equal(r.label,'tendencia');});
test('baseline usa sete janelas anteriores',()=>{const history=Array.from({length:7},(_,i)=>({occurredAt:new Date(now-(i+1)*86400000-1000).toISOString()}));assert.equal(baseline24h(history,now),1);});
test('ciclo esfria após duas quedas e encerra após sete dias',()=>{
 let r=nextLifecycle('pico',{growth:2,previousGrowth:3,fallingWindows:0,lastOccurrence:new Date(now).toISOString(),now,peakGrowth:3});assert.equal(r.state,'pico');
 r=nextLifecycle(r.state,{growth:1,previousGrowth:2,fallingWindows:r.fallingWindows,lastOccurrence:new Date(now).toISOString(),now,peakGrowth:r.peakGrowth});assert.equal(r.state,'esfriando');
 r=nextLifecycle('esfriando',{growth:0,previousGrowth:1,lastOccurrence:new Date(now-7*86400000).toISOString(),now,peakGrowth:3});assert.equal(r.state,'encerrado');
});
test('cluster exige cidade, entidade, tempo e similaridade',()=>{const a={city:'Pecém',entities:['Porto'],occurredAt:new Date(now).toISOString(),text:'porto pecem recebe navio verde'},b={city:'Pecém',entities:['Porto'],occurredAt:new Date(now-3600000).toISOString(),text:'porto pecem recebe navio verde'};assert.equal(canJoinTopic(a,b,{threshold:.85}).join,true);assert.equal(canJoinTopic(a,{...b,city:'Caucaia'},{threshold:.85}).join,false);});
test('falha de embeddings degrada para palavras-chave e confiança baixa',async()=>{const rows=[{city:'Pecém',entities:['Porto'],occurredAt:new Date(now).toISOString(),text:'porto pecem navio verde'},{city:'Pecém',entities:['Porto'],occurredAt:new Date(now-1).toISOString(),text:'porto pecem navio verde'}];const r=await clusterWithFallback(rows,{embeddingProvider:async()=>{throw Error('offline')}});assert.equal(r.degraded,true);assert.equal(r.confidence,'baixa');assert.equal(r.clusters.length,1);});
test('mudança de ciclo é gravada somente quando o estado muda',async()=>{const events=[],repo={updateTopic:async()=>{},recordLifecycleTransition:async e=>events.push(e)};await advanceLifecycle({id:'t',cycle:'pico',fallingWindows:1,peakGrowth:3},{growth:1,previousGrowth:2,lastOccurrence:new Date(now).toISOString(),now},repo);assert.equal(events[0].next,'esfriando');});

