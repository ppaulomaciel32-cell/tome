import test from 'node:test';
import assert from 'node:assert/strict';
import {draftForView,requestJSON} from '../web/client-state.mjs';
test('candidato sem rascunho abre editor com três campos vazios, sem inventar conteúdo',()=>{
 for(const value of [null,undefined])assert.deepEqual(draftForView(value),{titulo_editorial:'',texto_site:'',instagram:'',stories:['','','']});
});
test('padrões de visualização não alteram texto nem evidência persistida',()=>{
 const source={texto_site:'Texto original',stories:['A','B','C'],gerado_por_ia:true,modelo:'modelo'};
 const view=draftForView(source);view.stories[0]='Editado';assert.equal(source.stories[0],'A');assert.equal(view.texto_site,source.texto_site);assert.equal(view.gerado_por_ia,true);
});
test('requisição lenta é interrompida sem recomendar repetição de escrita',async()=>{
 const fetcher=(_path,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort'))));
 await assert.rejects(requestJSON('/test',{},fetcher,10),/atualize antes de tentar novamente/);
});
test('erro HTML e sessão expirada recebem mensagens controladas',async()=>{
 await assert.rejects(requestJSON('/test',{},async()=>new Response('<html>erro</html>',{status:503})),/dados válidos/);
 await assert.rejects(requestJSON('/test',{},async()=>new Response('{"erro":"Entre novamente"}',{status:401})),e=>e.status===401&&e.message==='Entre novamente');
});
