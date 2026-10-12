import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDraftHandler,validateDraft} from '../supabase/functions/tnn-drafts/handler.mjs';
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-fixture-only',TNN_DRAFT_SERVICE_TOKEN:'a'.repeat(64),TNN_DRAFT_READER_TOKEN:'b'.repeat(64)};
const makeDraft=()=>{
  const content='Segundo a fonte, este conteúdo é uma simulação técnica para testar validação e privacidade. '.repeat(9);
  const fontes=['aa','bb'].map(id=>({id,name:'Fonte '+id,publisher_group:id,title:'Fonte fictícia para testes',url:'https://'+id+'.example/news',content,published_date:'2026-10-11T12:00:00Z'}));
  const texto=Array.from({length:4},()=>Array.from({length:80},()=> 'teste').join(' ')).join('\n\n');
  return {id:crypto.randomUUID(),slug:'simulacao-privada',titulo:'Simulação privada de testes',resumo:'Este texto sintético não é uma reportagem.',texto,localidade:'regiao',fontes,evidencias:['titulo','resumo','paragrafo_1','paragrafo_2','paragrafo_3','paragrafo_4'].map(campo=>({campo,fonte_id:'aa',trecho:content.slice(0,80)}))};
};
const seen=()=>['a','b','c'].map((x,i)=>({hash:x.repeat(64),tipo:i?'url':'titulo',titulo:'Simulação privada de testes'}));
const req=(body,token=env.TNN_DRAFT_SERVICE_TOKEN,action='context')=>new Request('https://fixture.supabase.co/functions/v1/tnn-drafts?action='+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-draft-token':token},...(body?{body:JSON.stringify(body)}:{})});
test('rascunhos: segredo inválido, leitor e ação publish nunca escrevem',async()=>{
  let calls=0;const fn=createDraftHandler(env,{fetchImpl:async()=>{calls++;return Response.json([]);}});
  assert.equal((await fn(req(null,'invalid'))).status,401);
  assert.equal((await fn(req({action:'begin',id:crypto.randomUUID(),max_pending:5},env.TNN_DRAFT_READER_TOKEN))).status,403);
  assert.equal((await fn(req({action:'publish',draft:makeDraft()}))).status,400);
  assert.equal(calls,0);
});
test('rascunhos: configuração parcial e tokens iguais bloqueiam tudo',async()=>{
  for(const change of [{TNN_DRAFT_READER_TOKEN:''},{TNN_DRAFT_READER_TOKEN:env.TNN_DRAFT_SERVICE_TOKEN}]){
    const fn=createDraftHandler({...env,...change},{fetchImpl:()=>assert.fail('não acessar banco')});assert.equal((await fn(req(null))).status,503);
  }
});
test('rascunhos: dados incompletos e falsas evidências recusados antes do banco',async()=>{
  assert.equal(validateDraft(makeDraft(),seen()),true);
  for(const change of [{texto:'curto'},{localidade:'outro'},{fontes:[]},{evidencias:[]},{slug:'../inválido'}])assert.equal(validateDraft({...makeDraft(),...change},seen()),false);
  const draft=makeDraft();draft.evidencias[0].trecho='citação inventada que não existe';assert.equal(validateDraft(draft,seen()),false);
  const fn=createDraftHandler(env,{fetchImpl:()=>assert.fail('não acessar banco')});assert.equal((await fn(req({action:'save',cycle_id:crypto.randomUUID(),max_pending:5,draft,seen:seen()}))).status,400);
});
test('rascunhos: gravação chama apenas RPC isolada, sem publicação ou rebuild',async()=>{
  const calls=[];const draft=makeDraft();const fn=createDraftHandler(env,{fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({saved:true,id:draft.id});}});
  const response=await fn(req({action:'save',cycle_id:crypto.randomUUID(),max_pending:5,draft,seen:seen()}));assert.equal(response.status,200);assert.equal(calls.length,1);
  assert.equal(calls[0].url,env.SUPABASE_URL+'/rest/v1/rpc/tnn_drafts_save');assert.match(calls[0].options.headers.Authorization,/server-fixture-only/);
  assert.doesNotMatch(await response.text(),/server-fixture-only/);
});
test('rascunhos: contexto de leitor não retorna o histórico de deduplicação',async()=>{
  const fn=createDraftHandler(env,{fetchImpl:async url=>Response.json(url.includes('noticias_vistas')?[{hash:'private-hash'}]:[])});
  const response=await fn(req(null,env.TNN_DRAFT_READER_TOKEN));assert.equal(response.status,200);assert.equal('seen' in await response.json(),false);
});
test('rascunhos: erros do provedor não expõem corpo, SQL ou credenciais',async()=>{
  const fn=createDraftHandler(env,{fetchImpl:async()=>new Response('secret-fixture',{status:500})});const response=await fn(req(null));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret-fixture/);
});
test('Postgres local: RLS, repetição de ciclo, deduplicação e transação atômica', {skip:!process.env.TNN_PGLITE_MODULE},async()=>{
  const {PGlite}=await import(process.env.TNN_PGLITE_MODULE);const db=new PGlite();
  try{
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
    await db.exec(await readFile(new URL('../supabase/migrations/20261011224051_autonomous_private_drafts.sql',import.meta.url),'utf8'));
    const tables=await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'");
    assert.equal(tables.rows.length,3);assert.ok(tables.rows.every(r=>r.relrowsecurity));
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      for(const table of ['rascunhos','noticias_vistas','ciclo_log'])await assert.rejects(db.query('select * from public.'+table),/permission denied/);
      await assert.rejects(db.query('select public.tnn_drafts_begin($1,5)',[crypto.randomUUID()]),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const cycle=crypto.randomUUID();
    const begin=async id=>(await db.query('select public.tnn_drafts_begin($1,5) as value',[id])).rows[0].value;
    assert.equal((await begin(cycle)).started,true);assert.equal((await begin(cycle)).started,true);
    assert.equal((await begin(crypto.randomUUID())).started,false);
    const draft=makeDraft();
    const save=async(d,s,c=cycle)=>(await db.query('select public.tnn_drafts_save($1,$2::jsonb,$3::jsonb,5) as value',[c,JSON.stringify(d),JSON.stringify(s)])).rows[0].value;
    // Um erro no segundo INSERT desfaz também o primeiro: nada pela metade.
    await assert.rejects(save(draft,[...seen(),{hash:'invalid',tipo:'url',titulo:'inválido'}]),/check constraint/);
    assert.equal((await db.query('select count(*)::int as n from public.rascunhos')).rows[0].n,0);
    assert.equal((await save(draft,seen())).saved,true);
    assert.equal((await save({...draft,id:crypto.randomUUID()},seen())).id,draft.id);
    assert.equal((await db.query('select count(*)::int as n from public.rascunhos')).rows[0].n,1);
    const other=crypto.randomUUID();await db.query("insert into public.ciclo_log(id,janela,status,etapa) values($1,-1,'running','inicio')",[other]);
    assert.equal((await save({...draft,id:crypto.randomUUID()},seen(),other)).reason,'already_seen');
    assert.equal((await db.query('select count(*)::int as n from public.noticias_vistas')).rows[0].n,3);
  }finally{await db.close();}
});
