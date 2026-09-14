import test from 'node:test';import assert from 'node:assert/strict';
import {editorialSignals,sourceHealth,dashboardData,safeSource} from '../web/dashboard-model.mjs';
import {nextUnseenLinks,explicitArticleDate} from '../supabase/functions/radar-coletor/discovery.mjs';
const now=Date.parse('2026-09-14T01:00:00Z');
const item={titulo:'Vagas no Pecém',localidade:'Pecém',status:'apurar',tem_evidencia:true,url_fonte:'https://fonte.example/1',data_documento:'2026-09-13'};
test('documento antigo não entra na seleção principal mesmo coletado agora',()=>{
 const old=editorialSignals({...item,data_documento:'2026-07-01',criada_em:new Date(now).toISOString()},now);
 assert.equal(old.workable,false);assert.equal(old.old,true);assert.ok(old.pending.some(x=>x.includes('antigo')));
});
test('datas e evidência ausentes geram pendências; prioridade não é afinidade',()=>{
 const s=editorialSignals({...item,data_documento:null,tem_evidencia:false},now);
 assert.ok(s.pending.includes('Falta registrar evidência'));assert.ok(s.pending.includes('Data do documento a conferir'));assert.equal(s.points,45);
 assert.equal(safeSource('javascript:alert(1)'),null);
});
test('datas seguem calendário de Fortaleza e títulos institucionais ficam fora da seleção',()=>{
 assert.equal(editorialSignals({...item,data_documento:'2026-09-14'},now).future,true);
 assert.equal(editorialSignals({...item,titulo:'Página Inicial - Complexo do Pecém'},now).generic,true);
});
test('fonte sem documentos ou com erro não recebe sinal saudável',()=>{
 const f={id:'f',ativa:true,ultimo_sucesso:new Date(now).toISOString()};
 assert.equal(sourceHealth(f,[{fonte_id:'f',documentos_lidos:0}],now).state,'warning');
 assert.equal(sourceHealth({...f,estado_circuito:'aberto'},[],now).state,'error');
 assert.equal(sourceHealth({...f,ativa:false},[],now).state,'off');
});
test('resumo usa entradas e localidade registrada; não inventa tendência',()=>{
 const d=dashboardData({pautas:[{...item,criada_em:new Date(now).toISOString()}],fontes:[]},now);
 assert.equal(d.recent,1);assert.equal(d.cityCounts.find(x=>x.city==='Pecém').total,1);assert.equal(d.tendencia,undefined);
});
test('coletor avança para URL inédita antes de repetir a primeira',()=>{
 const links=['https://sapl.example/1','https://sapl.example/2','https://sapl.example/3'];
 assert.deepEqual(nextUnseenLinks(links,[links[0]],1),[links[1]]);
 assert.deepEqual(nextUnseenLinks(links,links,1),[links[0]]);
});
test('data genérica no rodapé não vira data do documento',()=>{
 assert.equal(explicitArticleDate('<footer>14/09/2026</footer>'),null);
 assert.equal(explicitArticleDate('<meta content="2026-09-10T10:00:00Z" property="article:published_time">'),'2026-09-10');
});
