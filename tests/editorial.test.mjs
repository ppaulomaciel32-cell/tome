import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {createEditorialHandler} from '../supabase/functions/tnn-editorial/handler.mjs';
const id=()=>crypto.randomUUID();
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'SERVER_FIXTURE',TNN_EDITORIAL_TOKEN:'a'.repeat(64),TNN_EDITORIAL_SIGNING_KEY:'b'.repeat(64),TNN_DRAFT_SERVICE_TOKEN:'c'.repeat(64),TNN_DRAFT_READER_TOKEN:'d'.repeat(64),TNN_SITE_URL:'https://tomezap.com.br',TNN_SITE_REBUILD_HOOK:'https://api.render.com/deploy/srv-fixture?key=PRIVATE_HOOK'};
const signed=(p={})=>{const body={action:'approve',draft_id:id(),revision:1,receipt:'e'.repeat(64),editor_hash:'f'.repeat(64),...p};return {...body,signature:createHmac('sha256',env.TNN_EDITORIAL_SIGNING_KEY).update(JSON.stringify(body)).digest('hex')};};
const request=(p,token=env.TNN_EDITORIAL_TOKEN)=>new Request('https://fixture.supabase.co/functions/v1/tnn-editorial',{method:'POST',headers:{'content-type':'application/json','x-editorial-token':token},body:JSON.stringify(p)});
test('editorial: token de redação não publica; token editorial sem prova não chega ao banco',async()=>{
  let calls=0;const fn=createEditorialHandler(env,{fetchImpl:()=>{calls++;assert.fail();}});
  assert.equal((await fn(request(signed(),env.TNN_DRAFT_SERVICE_TOKEN))).status,401);
  const p=signed();delete p.signature;assert.equal((await fn(request(p))).status,403);
  const changed={...signed(),draft_id:id()};assert.equal((await fn(request(changed))).status,403);assert.equal(calls,0);
});
test('editorial: segredo/hook inválido bloqueia escrita; falha de rebuild não é anunciada como no ar',async()=>{
  let calls=0;const data=signed();
  const absent=createEditorialHandler({...env,TNN_SITE_REBUILD_HOOK:''},{fetchImpl:()=>{calls++;}});assert.equal((await absent(request(data))).status,503);assert.equal(calls,0);
  const fn=createEditorialHandler(env,{fetchImpl:async url=>url.includes('/rpc/')?Response.json({ok:true,publication:{id:id(),slug:'teste',revision:1}}):new Response(null,{status:500})});
  const response=await fn(request(data));assert.equal(response.status,202);const body=await response.json();assert.equal(body.deploy_requested,false);assert.equal(body.status,'publication_pending');assert.doesNotMatch(JSON.stringify(body),/SERVER_FIXTURE|PRIVATE_HOOK|signature/);
});
test('editorial: rejeição não chama rebuild e payload não aceita alteração do artigo',async()=>{
  const calls=[];const fn=createEditorialHandler(env,{fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});}});
  assert.equal((await fn(request(signed({action:'reject'})))).status,200);assert.equal(calls.length,1);
  assert.doesNotMatch(calls[0].options.body,/texto|cover_url|service_role/);
});
test('Postgres local: aprovação/publicação atômicas, replay, rejeição, fila e RLS', {skip:!process.env.TNN_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.TNN_PGLITE_MODULE);const db=new PGlite();
  try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;create table public.tomenota_publications(id uuid primary key default gen_random_uuid(),slug text unique,title text,summary text,body text,cover_url text,city text,author text,publisher text,status text,published_at timestamptz,updated_at timestamptz default now());alter table public.tomenota_publications enable row level security;grant select,insert,update on public.tomenota_publications to service_role;");
    for(const name of ['20261009221026_whatsapp_news_agent.sql','20261011224051_autonomous_private_drafts.sql','20261013010357_manual_editorial_approval.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
    for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query('select * from public.aprovacoes'),/permission denied/);await assert.rejects(db.query('select * from public.tnn_pending_drafts'),/permission denied/);await assert.rejects(db.query('select public.tnn_editorial_decide($1,1,$2,$3,$4)',[id(),'a'.repeat(64),'b'.repeat(64),'approve']),/permission denied/);await db.exec('reset role');}
    await db.exec('set role service_role');
    const make=async n=>{
      const cycle=id(),draft=id();const receipt=String(n).repeat(64);
      assert.equal((await db.query('select public.tnn_manual_begin($1,$2,5) as r',[cycle,receipt])).rows[0].r.started,true);
      const p={id:draft,slug:'pauta-'+n,titulo:'Pauta de teste do Pecém',resumo:'Resumo sintético para um teste local.',texto:'Texto fictício para o teste privado. '.repeat(12),localidade:'pecem',fontes:[{title:'Fonte A',url:'https://a.example/a'},{title:'Fonte B',url:'https://b.example/b'}],evidencias:Array(6).fill({campo:'teste'})};
      const seen=['a','b','c'].map((s,i)=>({hash:String(n)+s.repeat(63),tipo:i?'url':'titulo',titulo:p.titulo}));
      await db.query('select public.tnn_drafts_save($1,$2::jsonb,$3::jsonb,5)',[cycle,JSON.stringify(p),JSON.stringify(seen)]);return draft;
    };
    const a=await make(1);assert.equal((await db.query('select count(*)::int n from public.tomenota_publications')).rows[0].n,0);
    const decide=async(d,receipt,decision='approve')=>(await db.query('select public.tnn_editorial_decide($1,1,$2,$3,$4) r',[d,receipt,'f'.repeat(64),decision])).rows[0].r;
    const publication=await decide(a,'d'.repeat(64));assert.equal(publication.ok,true);assert.equal((await decide(a,'d'.repeat(64))).publication.id,publication.publication.id);
    assert.equal((await db.query('select count(*)::int n from public.tomenota_publications')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from public.aprovacoes')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from public.tnn_pending_drafts')).rows[0].n,0);
    const b=await make(2);assert.equal((await decide(b,'d'.repeat(64))).code,'receipt_conflict');
    assert.equal((await decide(b,'e'.repeat(64),'reject')).ok,true);assert.equal((await decide(b,'0'.repeat(64))).code,'already_decided');
    assert.equal((await db.query('select count(*)::int n from public.tomenota_publications')).rows[0].n,1);
    const c=await make(3);
    await db.exec('reset role');await db.exec("create function public.fail_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture publication failure'; end $$; create trigger fail_fixture before insert on public.tomenota_publications for each row execute function public.fail_fixture();");await db.exec('set role service_role');
    await assert.rejects(decide(c,'9'.repeat(64)),/fixture publication failure/);
    assert.equal((await db.query('select count(*)::int n from public.aprovacoes where rascunho_id=$1',[c])).rows[0].n,0);
  }finally{await db.close();}
});
