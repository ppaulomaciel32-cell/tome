import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../public-site/',import.meta.url);
const scripts=await Promise.all(['assets/js/feed-model.js','app.js','assets/js/ads.js'].map(p=>fs.readFile(new URL(p,root),'utf8')));
const rows=n=>Array.from({length:n},(_,i)=>({id:String(i),slug:'materia-'+i,titulo:'Notícia da região '+i,resumo:'Informação da comunidade, publicada com responsabilidade.',capa:'https://bot.tomezap.com.br/imagens/'+'a'.repeat(32)+'-1600.jpg',publicado_em:new Date(Date.now()-i*60000).toISOString()}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<5;i++)await flush();}
function setup(items,{seed=false,observer=true}={}) {
 const dom=new JSDOM('<!doctype html><html lang="pt-BR"><head></head><body><input id="search"><p id="result-count"></p><div id="news-grid"></div><p id="status-message"></p><button id="load-more">Carregar mais notícias</button><footer>Rodapé</footer></body></html>',{url:'https://tomezap.com.br/',runScripts:'outside-only'});
 const w=dom.window,calls=[],observers=[];
 w.TNN_CONFIG={siteUrl:'https://tomezap.com.br',supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'anon-fixture',adClient:'ca-pub-2000164835494228',autoAds:false,adSlots:{home:''},builtSlugs:items.map(x=>x.slug)};
 w.TNNConsent={get:()=>null};w.TNNAds={refresh(){}};
 w.AbortController=AbortController;
 if(observer)w.IntersectionObserver=class {
   constructor(callback){this.callback=callback;this.target=null;observers.push(this);}
   observe(target){this.target=target;} disconnect(){this.target=null;}
   hit(){if(this.target)this.callback([{isIntersecting:true,target:this.target}]);}
 };
 w.fetch=async url=>{
   const query=new URL(url).searchParams;calls.push(query);
   const term=(query.get('search')||'').replace('wfts(portuguese).','');
   const filtered=term?items.filter(item=>item.titulo.includes(term)):items;
   const offset=Number(query.get('offset')||0),limit=Number(query.get('limit'));
   return {ok:true,headers:{get:()=>`*/${filtered.length}`},json:async()=>filtered.slice(offset,offset+limit)};
 };
 if(seed) {
   const grid=w.document.getElementById('news-grid');
   for(const item of items.slice(0,24)) {
     const card=w.document.createElement('article');card.className='news-card';card.dataset.fixture=item.slug;
     const a=w.document.createElement('a');a.href='/noticia/'+item.slug+'/';a.textContent=item.titulo;card.append(a);grid.append(card);
   }
   const node=w.document.createElement('script');node.id='news-seed';node.type='application/json';
   node.textContent=JSON.stringify({items:items.slice(0,24),total:items.length,cutoff:new Date().toISOString()});w.document.body.append(node);
 }
 w.eval(scripts[0]);
 const start=()=>w.eval(scripts[1]);
 return {dom,w,calls,observers,start,grid:w.document.getElementById('news-grid'),button:w.document.getElementById('load-more')};
}
test('DOM: 0, 1 e 100 matérias; observer encerra, não repete e deixa o rodapé acessível',async()=>{
 for(const size of [0,1,100]) {
   const e=setup(rows(size));try {
     e.start();await settle();let loops=0;
     while(!e.button.hidden){e.observers[0].hit();await settle();assert.ok(++loops<12);}
     const slugs=[...e.grid.querySelectorAll('.news-card a')].map(a=>a.pathname);
     assert.equal(slugs.length,size);assert.equal(new Set(slugs).size,size);
     assert.equal(e.w.document.getElementById('status-message').textContent,'Você está em dia');
     assert.equal(e.grid.querySelectorAll('.news-skeleton').length,0);assert.equal(e.observers[0].target,null);
     const before=e.calls.length;e.observers[0].hit();await settle();assert.equal(e.calls.length,before);
     if(size===100)assert.equal(e.grid.querySelectorAll('.feed-highlights').length,2);
   }finally{e.dom.window.close();}
 }
});
test('DOM: os 24 cartões SEO mantêm identidade; primeira consulta começa no offset 24',async()=>{
 const e=setup(rows(100),{seed:true});try {
   const first=e.grid.firstChild;e.start();await settle();assert.equal(e.calls.length,0);assert.equal(e.grid.firstChild,first);
   e.observers[0].hit();await settle();assert.equal(e.calls[0].get('offset'),'24');assert.equal(e.calls[0].get('limit'),'12');
   assert.equal(e.grid.firstChild,first);assert.equal(e.grid.querySelectorAll('.news-card').length,36);
 }finally{e.dom.window.close();}
});
test('DOM: sem observer o botão funciona; busca reinicia paginação e não exibe destaques fora da busca',async()=>{
 const items=rows(100);items[91].titulo='Pescadores do Pecém';const e=setup(items,{observer:false});
 try {
   e.start();await settle();e.button.click();await settle();assert.equal(e.grid.querySelectorAll('.news-card').length,36);
   const input=e.w.document.getElementById('search');input.value='Pescadores';input.dispatchEvent(new e.w.Event('input'));
   await new Promise(r=>setTimeout(r,330));await settle();
   assert.equal(e.calls.at(-1).get('offset'),'0');assert.equal(e.grid.querySelectorAll('.news-card').length,1);
   assert.equal(e.grid.querySelectorAll('.feed-highlights').length,0);assert.equal(e.button.hidden,true);
 }finally{e.dom.window.close();}
});
test('DOM: falha mantém cartões e offset, bloqueia repetição automática e botão tenta de novo',async()=>{
 const e=setup(rows(100));try {
   e.start();await settle();const first=e.grid.firstChild,original=e.w.fetch;
   e.w.fetch=async()=>{throw Error('offline');};e.observers[0].hit();await settle();
   assert.equal(e.grid.firstChild,first);assert.equal(e.button.textContent,'Tentar de novo');assert.equal(e.observers[0].target,null);
   assert.equal(e.grid.querySelectorAll('.news-skeleton').length,0);
   e.w.fetch=original;e.button.click();await settle();assert.equal(e.calls.at(-1).get('offset'),'24');assert.equal(e.grid.firstChild,first);
 }finally{e.dom.window.close();}
});
test('DOM: anúncios rotulados, separados da notícia, com fallback e consentimento; capa 16:9 e texto seguro',async()=>{
 const items=rows(24);items[0].titulo='<script>perigo()</script>';const e=setup(items);try {
   e.start();await settle();
   const ads=[...e.grid.querySelectorAll('.feed-ad')];assert.equal(ads.length,2);
   assert.equal([...e.grid.children].indexOf(ads[0]),6);assert.equal([...e.grid.children].indexOf(ads[1]),19);
   for(const ad of ads){assert.equal(ad.querySelector('.ad-label').textContent,'Publicidade');assert.equal(ad.querySelector('a').pathname,'/contato.html');assert.equal(ad.querySelector('.adsbygoogle').hidden,true);}
   assert.equal(e.grid.querySelectorAll('script').length,0);
   const img=e.grid.querySelector('img');assert.equal(img.width,800);assert.equal(img.height,450);assert.match(img.srcset,/-800.webp 800w/);assert.equal(img.getAttribute('loading'),'lazy');
   e.w.TNN_CONFIG.autoAds=true;
   e.w.eval(scripts[2]);assert.equal(e.w.document.getElementById('tnn-adsense'),null);
   e.w.TNNConsent={get:()=>'all'};e.w.TNNAds.refresh();assert.equal(e.w.document.getElementById('tnn-adsense'),null);
   e.w.TNNConsent={get:()=>null};
   e.w.TNN_CONFIG.adSlots.home='1234567890';e.w.TNNAds.refresh();assert.equal(ads[0].querySelector('.house-ad').hidden,false);
   e.w.TNNConsent={get:()=>'all'};e.w.TNNAds.refresh();assert.ok(e.w.document.getElementById('tnn-adsense'));
   for(const ad of ads){assert.equal(ad.querySelector('.house-ad').hidden,true);assert.equal(ad.querySelector('.adsbygoogle').hidden,false);}
   e.w.TNNAds.refresh();assert.equal(e.w.document.querySelectorAll('#tnn-adsense').length,1);
   const css=await fs.readFile(new URL('styles.css',root),'utf8');
   assert.match(css,/\.feed-ad\{[^}]*grid-template-rows:24px 200px;min-height:256px/);
   assert.match(css,/aspect-ratio:16\/9/);assert.match(css,/content-visibility:auto/);assert.match(css,/prefers-reduced-motion:reduce/);
 }finally{e.dom.window.close();}
});
