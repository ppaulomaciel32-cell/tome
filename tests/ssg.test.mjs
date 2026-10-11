import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from '../scripts/build-public-site.mjs';
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
   const canonical=html.match(/<link rel="canonical" href="([^"]+)"/)[1];
   const social=html.match(/<meta property="og:url" content="([^"]+)"/)[1];
   assert.equal(new URL(canonical).origin,site,relative);
   assert.equal(social,canonical,relative);
   assert.ok(!html.includes('https://tomenotanews.com.br'),relative+' must use SITE_URL override');
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
