import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalKey,normalizeUrl,normalizeTitle,ItemStateMachine,SourceCircuitBreaker,backoffMs,mapWithConcurrency} from '../src/pipeline.mjs';

test('URL, título e chave canônica são estáveis',()=>{
 assert.equal(normalizeUrl('https://WWW.Example.com/noticia/amp/?utm_source=x&b=2&a=1#fim'),'https://example.com/noticia?a=1&b=2');
 assert.equal(normalizeTitle('  Água   no Pecém!!! '),'água no pecém');
 assert.equal(canonicalKey({url:'https://x.test/a?utm_source=z',title:'Fato!',date:'2026-09-10'}),canonicalKey({url:'https://x.test/a/',title:' fato ',date:'2026-09-10'}));
});
test('caminho feliz gera história completa',()=>{
 const history=[],m=new ItemStateMachine({id:'i1',state:'pendente'},history);
 for(const [state,reason] of [['coletando','coleta_iniciada'],['normalizado','normalizacao_concluida'],['classificado','classificacao_concluida'],['deduplicado','deduplicacao_concluida'],['publicado','publicacao_no_painel']])m.transition(state,{reason});
 assert.deepEqual(history.map(x=>[x.estado_anterior,x.estado_novo]),[['pendente','coletando'],['coletando','normalizado'],['normalizado','classificado'],['classificado','deduplicado'],['deduplicado','publicado']]);
 assert.ok(history.every(x=>x.item_id&&x.timestamp&&x.motivo&&x.origem));
});
test('transições inválidas e saída automática de revisão são rejeitadas',()=>{
 assert.throws(()=>new ItemStateMachine({id:'i',state:'publicado'}).transition('coletando',{reason:'x'}),/inválida/);
 assert.throws(()=>new ItemStateMachine({id:'i',state:'revisao'}).transition('publicado',{reason:'x'}),/manual/);
 assert.throws(()=>new ItemStateMachine({id:'i',state:'descartado'}).transition('pendente',{reason:'x',origin:'manual'}),/reprocessamento/);
});
test('circuit breaker abre na terceira falha e probe fecha',()=>{
 const b=new SourceCircuitBreaker();assert.equal(b.failure(0).state,'fechado');assert.equal(b.failure(1).state,'fechado');const third=b.failure(2);
 assert.equal(third.state,'aberto');assert.equal(third.alert,true);assert.equal(b.canRun(third.retryAt-1),false);assert.equal(b.canRun(third.retryAt),true);assert.equal(b.state,'meio_aberto');b.success();assert.equal(b.state,'fechado');
});
test('backoff segue 5, 15, 45, 120 e teto 240 minutos',()=>assert.deepEqual([1,2,3,4,5,9].map(x=>backoffMs(x)/60000),[5,15,45,120,240,240]));
test('concorrência nunca passa de cinco',async()=>{let active=0,peak=0;await mapWithConcurrency(Array(20).fill(0),5,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;});assert.equal(peak,5);await assert.rejects(()=>mapWithConcurrency([],6,async()=>{}));});

