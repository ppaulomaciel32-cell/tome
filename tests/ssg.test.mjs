import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from '../scripts/build-public-site.mjs';
test('SSG: home e cidade entregam até 24 cartões, estado seguro e publicidade no mesmo lugar antes do JS',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tnn-feed-ssg-'));
 const base={title:'Notícia segura </script>',summary:'Resumo local.',body:'Texto da notícia.',status:'published',localidade:'pecem',published_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z'};
 try {
   for(const count of [0,1,100]) {
     const fixture=path.join(temp,'input.json');await fs.writeFile(fixture,JSON.stringify(Array.from({length:count},(_,i)=>({...base,id:String(i),slug:'noticia-'+i}))));
     const out=path.join(temp,'out');await build({fixture,out});
     for(const page of ['index.html','localidade/pecem/index.html']) {
       const html=await fs.readFile(path.join(out,page),'utf8');
       assert.equal((html.match(/<article class="news-card">/g)||[]).length,Math.min(24,count));
       const seed=JSON.parse(html.match(/<script id="news-seed" type="application\/json">([\s\S]*?)<\/script>/)[1]);
       assert.equal(seed.items.length,Math.min(24,count));assert.equal(seed.total,count);assert.equal(seed.items[0]?.titulo,count?base.title:undefined);
       assert.equal((html.match(/<aside class="feed-ad"/g)||[]).length,count>=24?2:0);
       assert.match(html,/feed-model.js/);assert.match(html,/id="load-more"/);assert.doesNotMatch(html,/<aside hidden class="ad-space wrap"/);
       assert.equal((html.match(/<h1/g)||[]).length,1);
     }
   }
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
test('SSG publishes only visible stories, escapes data, builds localities and preserves legacy pages',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tnn-ssg-'));
 const previousSite=process.env.SITE_URL;
 const site='https://publicacao.example';
 process.env.SITE_URL=site;
 try {
 const story={id:'1',slug:'teste-da-taiba',title:'Notícia <segura>',summary:'Resumo seguro para o teste.',body:'Primeiro <script>alert(1)</script>.\n\nSegundo.\n\nTerceiro.\n\nQuarto.',status:'published',localidade:'taiba',gerada_por:'ia',published_at:'2026-01-01T12:00:00Z',updated_at:'2026-01-02T12:00:00Z',agent_revision:123,cover_url:'https://example.com/image.jpg',fontes:[{titulo:'Fonte',url:'https://example.com/fonte'}]};
 const fixture=path.join(temp,'input.json');await fs.writeFile(fixture,JSON.stringify([story,{...story,slug:'rascunho',status:'draft'},{...story,slug:'futura',published_at:'2099-01-01T12:00:00Z'}]));
 const out=path.join(temp,'out');const result=await build({fixture,out});assert.equal(result.articles,1);assert.equal(result.localities,6);
 const page=await fs.readFile(path.join(out,'noticia/teste-da-taiba/index.html'),'utf8');
 assert.ok(page.includes('name="tnn-agent-revision" content="123"'));assert.ok(page.includes('NewsArticle'));assert.ok(page.includes('BreadcrumbList'));assert.ok(page.includes('dateModified'));assert.ok(page.includes('&lt;script&gt;'));assert.ok(!page.includes('<script>alert(1)</script>'));assert.ok(!page.includes('src="/app.js"'));
 assert.equal((page.match(/<h1/g)||[]).length,1);assert.ok(page.includes('google-adsense-account'));
 const local=await fs.readFile(path.join(out,'localidade/taiba/index.html'),'utf8');assert.ok(local.includes('data-localidade="taiba"'));assert.ok(local.includes('/noticia/teste-da-taiba/'));assert.ok(!local.includes('id="article-view"'));
 const sitemap=await fs.readFile(path.join(out,'sitemap.xml'),'utf8');assert.ok(!sitemap.includes('rascunho'));assert.ok(!sitemap.includes('futura'));assert.ok(sitemap.includes('2026-01-02'));
 await fs.access(path.join(out,'noticia.html'));await fs.access(path.join(out,'index.html'));
 // Exercise a domain change through the public build interface, including generated routes.
 for(const relative of ['index.html','sobre.html','contato.html','politica-de-privacidade.html','termos-de-uso.html','politica-de-cookies.html','noticia.html','noticia/teste-da-taiba/index.html',...['sao-goncalo','pecem','taiba','croata','paracuru','regiao'].map(slug=>'localidade/'+slug+'/index.html')]) {
   const html=await fs.readFile(path.join(out,relative),'utf8');
   const pageHead=html.split('</head>')[0];
   assert.equal((pageHead.match(/<script src="[^\"]*assets\/js\/ads\.js" defer><\/script>/g)||[]).length,1,relative+' loads the consent-aware AdSense integration once');
   assert.ok(pageHead.indexOf('assets/js/consent.js')<pageHead.indexOf('assets/js/ads.js'),relative+' checks consent first');
   const canonical=html.match(/<link rel="canonical" href="([^"]+)"/)[1];
   const social=html.match(/<meta property="og:url" content="([^"]+)"/)[1];
   assert.equal(new URL(canonical).origin,site,relative);
   assert.equal(social,canonical,relative);
   assert.ok(!html.includes('https://tomezap.com.br'),relative+' must use SITE_URL override');
   assert.ok(!html.includes('https://tome-nota-publico.onrender.com'),relative+' must not retain legacy origin');
 }
 for(const [,url] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g))assert.equal(new URL(url).origin,site);
 const schema=JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
 assert.equal(schema[0].mainEntityOfPage['@id'],site+'/noticia/teste-da-taiba/');
 assert.equal(new URL(schema[0].publisher.logo.url).origin,site);
 assert.ok((await fs.readFile(path.join(out,'robots.txt'),'utf8')).includes('Sitemap: '+site+'/sitemap.xml'));
 assert.ok((await fs.readFile(path.join(out,'assets/js/config.js'),'utf8')).includes('"siteUrl":"'+site+'"'));
 }finally{
   if(previousSite===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=previousSite;
   await fs.rm(temp,{recursive:true,force:true});
 }
});
test('SSG: capa gerada pela redação ganha versão leve; capa externa não',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tnn-ssg-'));
 const cover='https://bot.tomezap.com.br/imagens/'+'a'.repeat(32)+'-1600.jpg';
 const story={id:'1',slug:'capa-propria',title:'Notícia com capa própria',summary:'Resumo seguro para o teste.',body:'Primeiro.\n\nSegundo.\n\nTerceiro.\n\nQuarto.',status:'published',localidade:'pecem',gerada_por:'ia',published_at:'2026-01-01T12:00:00Z',updated_at:'2026-01-02T12:00:00Z',agent_revision:1,cover_url:cover,fontes:[]};
 const fixture=path.join(temp,'input.json');await fs.writeFile(fixture,JSON.stringify([story,{...story,slug:'capa-externa',cover_url:'https://example.com/image.jpg'}]));
 try {
   const out=path.join(temp,'out');await build({fixture,out});
   const read=file=>fs.readFile(path.join(out,file),'utf8');
   assert.ok((await read('noticia/capa-propria/index.html')).includes(cover.replace('-1600.jpg','-800.webp')+' 800w'));
   assert.ok(!(await read('noticia/capa-externa/index.html')).includes('srcset='));
   assert.ok((await read('index.html')).includes('srcset='));
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
