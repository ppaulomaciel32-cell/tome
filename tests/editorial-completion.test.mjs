import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {manualQueue,parseManual} from '../whatsapp-bridge/manual.mjs';
import {createEditorialHandler} from '../supabase/functions/tnn-editorial/handler.mjs';
import {articleHTML} from '../scripts/build-public-site.mjs';
import {createPanelServer,loadConfig} from '../panel-api/server.mjs';

test('fila: agendamento persiste, não antecipa, não bloqueia job imediato e permite cancelar',()=>{
  let now=100000;const map=new Map();const vault={get:(k,d)=>map.get(k)??d,put:(k,v)=>map.set(k,structuredClone(v)),claimAndPut:(_,__,k,v)=>{map.set(k,structuredClone(v));return true;}};
  const q=manualQueue(vault,()=>now,()=>{throw Error('invalid');});
  q.add({kind:'approve',draftId:'future',notBefore:now+60000},'a','editor');
  q.add({kind:'pauta',text:'immediate'},'b','editor');
  const immediate=q.claim();assert.equal(immediate.kind,'pauta');q.finish({id:immediate.id,lease:immediate.lease,code:'draft_ready'});
  assert.equal(q.claim(),null);assert.equal(q.scheduled().length,1);
  assert.equal(q.cancel('future').cancelled,true);now+=60001;assert.equal(q.claim(),null);
  q.add({kind:'approve',notBefore:now+60000},'c','editor');
  const restarted=manualQueue(vault,()=>now,()=>{});assert.equal(restarted.claim(),null);now+=60000;assert.equal(restarted.claim().kind,'approve');
});
test('grupo: AGENDAR usa Fortaleza; comando malformado não vira pauta',()=>{
  const p=parseManual('AGENDAR 12 2026-10-17 07:00');assert.equal(p.kind,'approve');assert.equal(p.number,12);assert.equal(new Date(p.notBefore).toISOString(),'2026-10-17T10:00:00.000Z');
  assert.deepEqual(parseManual('CANCELAR #12'),{kind:'cancel',number:12});assert.equal(parseManual('AGENDAR amanhã ao nascer do sol'),null);
});
test('Edge: horário integra a assinatura e nem token editorial permite publicação antes da hora',async()=>{
  const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-server',TNN_EDITORIAL_TOKEN:'a'.repeat(64),TNN_EDITORIAL_SIGNING_KEY:'b'.repeat(64),TNN_DRAFT_SERVICE_TOKEN:'c'.repeat(64),TNN_DRAFT_READER_TOKEN:'d'.repeat(64),TNN_SITE_URL:'https://tomezap.com.br',TNN_SITE_REBUILD_HOOK:'https://api.render.com/deploy/srv-fixture?key=fixture'};
  let calls=0;const handler=createEditorialHandler(env,{fetchImpl:()=>{calls++;throw Error('unexpected');}});
  const proof={action:'approve',draft_id:crypto.randomUUID(),revision:1,receipt:'e'.repeat(64),editor_hash:'f'.repeat(64),not_before:new Date(Date.now()+3600000).toISOString()};
  const payload={...proof,signature:createHmac('sha256',env.TNN_EDITORIAL_SIGNING_KEY).update(JSON.stringify(proof)).digest('hex')};
  const req=body=>new Request('https://fixture.supabase.co/functions/v1/tnn-editorial',{method:'POST',headers:{'content-type':'application/json','x-editorial-token':env.TNN_EDITORIAL_TOKEN},body:JSON.stringify(body)});
  assert.equal((await handler(req(payload))).status,409);
  const stripped={...payload};delete stripped.not_before;assert.equal((await handler(req(stripped))).status,403);assert.equal(calls,0);
});
test('crédito: matéria gerada escapa o nome e mantém imagem no Open Graph',async()=>{
  const template=await readFile(new URL('../public-site/noticia.html',import.meta.url),'utf8');
  const html=articleHTML(template,{slug:'pecem',title:'Pecém em pauta',summary:'Resumo do jornal',body:'Texto.',localidade:'pecem',published_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T10:00:00Z',cover_url:'https://bot.tomezap.com.br/imagens/'+'a'.repeat(32)+'-1600.jpg',cover_credit:'Maria <script>'},{siteUrl:'https://tomezap.com.br',adClient:'ca-pub-2000164835494228'});
  assert.match(html,/Foto: Maria &lt;script&gt;/);assert.match(html,/og:image" content="https:\/\/bot.tomezap.com.br\/imagens/);
});
test('mais lidas é público e agregado; audiência detalhada continua protegida',async t=>{
  const config=loadConfig({NODE_ENV:'development',SITE_URL:'https://tomezap.com.br',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',PANEL_OWNER_EMAIL:'owner@example.com'});
  const server=createPanelServer({config,analyticsReader:async()=>({configured:true,articles:[{slug:'pecem',title:'Pecém',localidade:'pecem',views:10,private:'never-return'},{slug:'zero',views:0}]})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port,options={headers:{Origin:'https://tomezap.com.br'}};
  const r=await fetch(url+'/painel-api/popular',options);assert.equal(r.status,200);const body=await r.json();assert.equal(body.articles.length,1);assert.equal(body.articles[0].private,undefined);
  assert.equal((await fetch(url+'/painel-api/analytics',options)).status,401);
});
test('migration de crédito: somente publicações TNN, copia crédito sem abrir rascunho ou mudar RLS',{skip:!process.env.TNN_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.TNN_PGLITE_MODULE);const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create table public.rascunhos(id uuid primary key,capa_credito text);
      alter table public.rascunhos enable row level security;
      grant select on public.rascunhos to service_role;
      create table public.tomenota_publications(id uuid primary key,agent_job_id uuid,cover_url text,status text);
      alter table public.tomenota_publications enable row level security;
      create policy published_only on public.tomenota_publications for select to anon using(status='published');
      grant select on public.tomenota_publications to anon;grant select,insert,update on public.tomenota_publications to service_role;
      insert into public.rascunhos values('00000000-0000-4000-8000-000000000001','Maria Silva');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261015151014_editorial_photo_credit.sql',import.meta.url),'utf8'));
    await db.exec('set role service_role');
    await db.exec("insert into public.tomenota_publications(id,agent_job_id,cover_url,status) values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','https://example.com/foto.jpg','published')");
    await db.exec('reset role;set role anon');
    assert.equal((await db.query('select cover_credit from public.tomenota_publications')).rows[0].cover_credit,'Maria Silva');
    await assert.rejects(db.query('select * from public.rascunhos'),/permission denied/);
    await assert.rejects(db.query("insert into public.tomenota_publications(id,status) values(gen_random_uuid(),'published')"),/permission denied/);
  }finally{await db.close();}
});
