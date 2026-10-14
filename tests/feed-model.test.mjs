import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../public-site/assets/js/feed-model.js',import.meta.url),'utf8'),context);
const Feed=context.window.TNNFeedModel;
const now=Date.parse('2026-10-14T12:00:00Z');
const rows=n=>Array.from({length:n},(_,i)=>({id:String(i),slug:'materia-'+i,titulo:'Notícia '+i,publicado_em:new Date(now-i*60000).toISOString()}));
test('listas de 0, 1 e 100 matérias terminam sem duplicar nem continuar depois do fim',()=>{
 for(const n of [0,1,100]) {
   const feed=new Feed(),items=rows(n),visible=[];let turns=0;
   do {const limit=turns?12:24;visible.push(...feed.accept(items.slice(feed.offset,feed.offset+limit),n,limit));turns++;assert.ok(turns<12);}while(!feed.done);
   assert.equal(visible.length,n);assert.equal(new Set(visible.map(x=>x.slug)).size,n);assert.equal(feed.offset,n);assert.equal(feed.count,n);
 }
});
test('páginas sobrepostas preservam offset bruto e interrompem servidor que repete a mesma página',()=>{
 const feed=new Feed(),items=rows(100);
 feed.accept(items.slice(0,24),100,24);
 assert.equal(feed.accept(items.slice(20,32),100,12).length,8);assert.equal(feed.offset,36);
 assert.equal(feed.accept(items.slice(20,32),100,12).length,0);assert.equal(feed.done,true);
});
test('destaques a cada três lotes, só inéditos dos últimos 30 dias; volta à paginação sem repetir',()=>{
 const feed=new Feed(),items=rows(100),due=[];
 feed.accept(items.slice(0,24),100,24);due.push(feed.highlightsDue);
 feed.accept(items.slice(24,36),100,12);due.push(feed.highlightsDue);
 feed.accept(items.slice(36,48),100,12);due.push(feed.highlightsDue);
 assert.deepEqual(due,[false,false,true]);
 const featured=feed.highlights(items,{now,random:()=>0});assert.equal(featured.length,3);
 const visible=[...items.slice(0,48),...featured];
 while(!feed.done){const page=items.slice(feed.offset,feed.offset+12);visible.push(...feed.accept(page,100,12));}
 assert.equal(new Set(visible.map(x=>x.slug)).size,100);assert.equal(visible.length,100);
 assert.equal(feed.count,100);
});
test('destaques não exibem grupo incompleto, data futura, antiga ou matérias já vistas',()=>{
 const feed=new Feed(),items=rows(5);feed.accept(items.slice(0,3),5,3);
 assert.equal(feed.highlights(items,{now}).length,0);
 const bad=[{...items[3],publicado_em:'2000-01-01'},{...items[4],publicado_em:'2099-01-01'},{...items[4],publicado_em:'inválida'}];
 assert.equal(feed.highlights(bad,{now}).length,0);
});
