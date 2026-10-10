import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LOCALS={'sao-goncalo':'São Gonçalo do Amarante',pecem:'Pecém',taiba:'Taíba',croata:'Croatá',paracuru:'Paracuru',regiao:'Região'};
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const absolute=(p,site)=>new URL(p,site).href;
function validUrl(value) {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('HTTPS required');return u.href.replace(/\/$/,'');}
function safePhoto(value,fallback){try{return validUrl(value);}catch{return fallback;}}
const date=value=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'long',timeZone:'America/Fortaleza'}).format(new Date(value));
const nav=()=>'<nav class="wrap locality-nav" aria-label="Notícias por localidade">'+Object.entries(LOCALS).map(([slug,label])=>`<a href="/localidade/${slug}/">${label==='São Gonçalo do Amarante'?'São Gonçalo':label}</a>`).join('')+'</nav>';
function head(template,{title,description,url,image,type='website'}) {
  let page=template.replace(/(href|src)="\.\//g,'$1="/');
  page=page.replace(/<title>[^<]*<\/title>/,`<title>${esc(title)}</title>`);
  for(const [attribute,key,value] of [['name','description',description],['property','og:type',type],['property','og:title',title],['property','og:description',description],['property','og:url',url],['property','og:image',image],['property','og:image:alt',title],['name','twitter:title',title],['name','twitter:description',description],['name','twitter:image',image]]){
    page=page.replace(new RegExp(`<meta ${attribute}="${key}" content="[^"]*">`),`<meta ${attribute}="${key}" content="${esc(value)}">`);
  }
  page=page.replace(/<link rel="canonical" href="[^"]*">/,`<link rel="canonical" href="${esc(url)}">`);
  return page.replace('</head>','<link rel="stylesheet" href="/assets/localidades.css">\n</head>').replace('</header>','</header>'+nav());
}
export function articleHTML(template,item,config) {
  const url=absolute('/noticia/'+item.slug+'/',config.siteUrl),photo=safePhoto(item.cover_url,absolute('/assets/images/og-tome-nota.png',config.siteUrl));
  const label=LOCALS[item.localidade]||LOCALS.regiao;
  let page=head(template,{title:item.title+' | Tome Nota News',description:item.summary,url,image:photo,type:'article'});
  const middleAd=`<aside class="ad-space ad-in-article" aria-label="Publicidade" hidden><span class="ad-label">Publicidade</span><ins class="adsbygoogle" style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid" data-ad-client="${esc(config.adClient)}" data-ad-slot="0000000000"></ins></aside>`;
  const paragraphs=item.body.split(/\n\s*\n/).map((p,i)=>'<p>'+esc(p)+'</p>'+(i===1?middleAd:'')).join('');
  const sources=(item.fontes||[]).filter(s=>{try{return validUrl(s.url);}catch{return false;}}).map(s=>`<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.titulo)}</a></li>`).join('');
  const content=`<article id="article-view" class="wrap article-view"><a class="back-link" href="/localidade/${item.localidade in LOCALS?item.localidade:'regiao'}/">${esc(label)}</a><h1>${esc(item.title)}</h1><p class="article-summary">${esc(item.summary)}</p><p class="article-meta">${esc(item.author||'Redação Tome Nota')} · <time datetime="${esc(item.published_at)}">${esc(date(item.published_at))}</time></p><img class="article-cover" src="${esc(photo)}" alt="${esc(item.title)}" width="1600" height="900" fetchpriority="high"><div class="article-body">${paragraphs}</div>${sources?'<h2>Fontes consultadas</h2><ul>'+sources+'</ul>':''}${item.gerada_por==='ia'?'<p class="article-meta">Texto produzido com auxílio de inteligência artificial a partir das fontes indicadas.</p>':''}</article>`;
  page=page.replace(/<article id="article-view"[\s\S]*?<\/article>/,content).replace(/<script src="\/app.js" defer><\/script>\n?/,'');
  const schema=[{'@context':'https://schema.org','@type':'NewsArticle',headline:item.title,description:item.summary,image:[photo],datePublished:item.published_at,dateModified:item.updated_at,
    author:{'@type':'Organization',name:item.author||'Redação Tome Nota'},publisher:{'@type':'Organization',name:item.publisher||'Tome Nota News',logo:{'@type':'ImageObject',url:absolute('/assets/images/og-tome-nota.png',config.siteUrl)}},mainEntityOfPage:{'@type':'WebPage','@id':url}},
    {'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:'Início',item:config.siteUrl+'/'},{'@type':'ListItem',position:2,name:label,item:absolute('/localidade/'+(item.localidade in LOCALS?item.localidade:'regiao')+'/',config.siteUrl)},{'@type':'ListItem',position:3,name:item.title,item:url}]}];
  return page.replace('</head>',`<meta name="tnn-agent-revision" content="${Number(item.agent_revision)||0}">\n<script type="application/ld+json">${json(schema)}</script>\n</head>`);
}
function card(item,config){return `<article class="news-card"><a class="card-link" href="/noticia/${esc(item.slug)}/"><img class="card-image" src="${esc(safePhoto(item.cover_url,absolute('/assets/images/og-tome-nota.png',config.siteUrl)))}" alt="${esc(item.title)}" width="800" height="450" loading="lazy"><div class="card-body"><time class="card-meta" datetime="${esc(item.published_at)}">${esc(date(item.published_at))}</time><h3 class="card-title">${esc(item.title)}</h3><p class="card-summary">${esc(item.summary)}</p></div></a></article>`;}
export async function build({fixture,out=path.join(ROOT,'dist-public')}={}) {
  const context={window:{}};
  vm.runInNewContext(await fs.readFile(path.join(ROOT,'public-site/assets/js/config.js'),'utf8'),context,{timeout:1000});
  const config={...context.window.TNN_CONFIG};
  config.siteUrl=validUrl(process.env.SITE_URL||config.siteUrl);
  config.supabaseUrl=validUrl(process.env.SUPABASE_URL||config.supabaseUrl);
  config.supabaseAnonKey=process.env.SUPABASE_ANON_KEY||config.supabaseAnonKey;
  // Falha fechada se alguém colocar uma chave administrativa na variável pública.
  try {if(JSON.parse(Buffer.from(config.supabaseAnonKey.split('.')[1],'base64url')).role!=='anon')throw Error();}catch{throw Error('Build exige exclusivamente a chave anon pública.');}
  config.adClient=process.env.ADSENSE_CLIENT||config.adClient;
  if(!/^ca-pub-\d{16}$/.test(config.adClient))throw Error('Publisher AdSense inválido.');
  config.contactEmail=process.env.CONTACT_EMAIL||config.contactEmail||'';
  let items=[];
  if(fixture)items=JSON.parse(await fs.readFile(fixture,'utf8'));
  else {
    for(let offset=0;offset<50000;offset+=500){
      const query=new URLSearchParams({select:'id,slug,title,summary,body,cover_url,author,publisher,status,localidade,gerada_por,published_at,updated_at,fontes,agent_revision',status:'eq.published',published_at:'lte.'+new Date().toISOString(),order:'published_at.desc,slug.asc',limit:'500',offset:String(offset)});
      const result=await fetch(config.supabaseUrl+'/rest/v1/tomenota_publications?'+query,{headers:{apikey:config.supabaseAnonKey,Authorization:'Bearer '+config.supabaseAnonKey},signal:AbortSignal.timeout(15000)});
      if(!result.ok)throw Error('Falha ao consultar notícias públicas: '+result.status);
      const page=await result.json();if(!Array.isArray(page))throw Error('Resposta de notícias inválida.');
      items.push(...page);if(page.length<500)break;
      if(offset===49500)throw Error('Limite de build atingido; nenhuma publicação parcial.');
    }
  }
  items=items.filter(p=>p.status==='published'&&new Date(p.published_at).valueOf()<=Date.now());
  for(const item of items) {
    if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.slug)||item.slug.length>240||typeof item.body!=='string'||!item.title||!item.summary||!Number.isFinite(new Date(item.updated_at).valueOf()))throw Error('Notícia inválida para o build.');
  }
  config.builtSlugs=items.map(p=>p.slug);
  if(path.resolve(out)===path.join(ROOT,'public-site')||path.resolve(out)===ROOT)throw Error('Destino de build inseguro.');
  await fs.rm(out,{recursive:true,force:true});await fs.cp(path.join(ROOT,'public-site'),out,{recursive:true});
  await fs.writeFile(path.join(out,'assets/js/config.js'),'window.TNN_CONFIG = Object.freeze('+json(config)+');\n');
  await fs.writeFile(path.join(out,'assets/localidades.css'),'.locality-nav{display:flex;flex-wrap:wrap;gap:.6rem;padding-top:1rem;padding-bottom:1rem}.locality-nav a{color:#123958;background:#edf4fb;padding:.55rem .85rem;border-radius:8px;font-weight:700;text-decoration:none}.locality-nav a:focus-visible{outline:3px solid #358dda}.article-cover{width:100%;height:auto}.article-body{overflow-wrap:anywhere}\n');
  const template=(await fs.readFile(path.join(ROOT,'public-site/noticia.html'),'utf8')).replaceAll(context.window.TNN_CONFIG.adClient,config.adClient);
  const sitemap=[];
  for(const name of ['index.html','sobre.html','contato.html','politica-de-privacidade.html','termos-de-uso.html','politica-de-cookies.html','noticia.html']) {
    const file=path.join(out,name);let html=await fs.readFile(file,'utf8');
    html=html.replaceAll(context.window.TNN_CONFIG.siteUrl,config.siteUrl).replaceAll(context.window.TNN_CONFIG.adClient,config.adClient);
    html=html.replace('</header>','</header>'+nav()).replace('</head>','<link rel="stylesheet" href="/assets/localidades.css">\n</head>');
    if(name==='index.html')html=html.replace('<div id="news-grid" class="news-grid"></div>','<div id="news-grid" class="news-grid">'+items.slice(0,24).map(i=>card(i,config)).join('')+'</div>');
    await fs.writeFile(file,html);
    if(name!=='noticia.html')sitemap.push({url:absolute(name==='index.html'?'/':'/'+name,config.siteUrl)});
  }
  for(const item of items){const directory=path.join(out,'noticia',item.slug);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'index.html'),articleHTML(template,item,config));sitemap.push({url:absolute('/noticia/'+item.slug+'/',config.siteUrl),lastmod:item.updated_at});}
  for(const [slug,label] of Object.entries(LOCALS)){
    const news=items.filter(i=>i.localidade===slug);let html=head(template,{title:'Notícias de '+label+' | Tome Nota News',description:'Acompanhe as notícias de '+label+' no Tome Nota News.',url:absolute('/localidade/'+slug+'/',config.siteUrl),image:absolute('/assets/images/og-tome-nota.png',config.siteUrl)});
    html=html.replace('<html lang="pt-BR">',`<html lang="pt-BR" data-localidade="${slug}">`);
    html=html.replace(/<article id="article-view"[\s\S]*?<\/article>/,`<section class="wrap news-section"><h1>Notícias de ${esc(label)}</h1><div class="filters"><label class="search-box"><span class="sr-only">Buscar nesta localidade</span><input id="search" maxlength="100" type="search" placeholder="Buscar nesta localidade..."></label></div><p id="result-count" aria-live="polite">${Math.min(24,news.length)} de ${news.length} matérias</p><div id="status-message" role="status"></div><div id="news-grid" class="news-grid">${news.slice(0,24).map(i=>card(i,config)).join('')}</div><button id="load-more" class="primary-button" hidden>Carregar mais notícias</button></section>`);
    const directory=path.join(out,'localidade',slug);await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'index.html'),html);
    sitemap.push({url:absolute('/localidade/'+slug+'/',config.siteUrl),lastmod:news[0]?.updated_at});
  }
  await fs.writeFile(path.join(out,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+sitemap.map(i=>`<url><loc>${esc(i.url)}</loc>${i.lastmod?'<lastmod>'+esc(i.lastmod)+'</lastmod>':''}</url>`).join('')+'</urlset>\n');
  await fs.writeFile(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /preview/\nDisallow: /assets/js/config.js\nHost: ${new URL(config.siteUrl).host}\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  await fs.writeFile(path.join(out,'ads.txt'),`google.com, ${config.adClient.replace('ca-','')}, DIRECT, f08c47fec0942fa0\n`);
  const manifest=JSON.parse(await fs.readFile(path.join(out,'manifest.webmanifest'),'utf8'));manifest.start_url='/';manifest.scope='/';await fs.writeFile(path.join(out,'manifest.webmanifest'),JSON.stringify(manifest,null,2)+'\n');
  return {articles:items.length,localities:Object.keys(LOCALS).length,out};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const fixtureIndex=process.argv.indexOf('--fixture');
  try {console.log(JSON.stringify(await build({fixture:fixtureIndex>=0?process.argv[fixtureIndex+1]:undefined})));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
