import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createViral,parseViral,proof} from '../whatsapp-bridge/viral.mjs';
import {manualQueue} from '../whatsapp-bridge/manual.mjs';
import {createViralHandler,decisionProof,validProposal} from '../supabase/functions/tnn-viral/handler.mjs';
import {viralHTML} from '../public-site/admin/viral.mjs';
const uid=()=>crypto.randomUUID();
const proposal=()=>({id:uid(),numero:12,revisao:1,turno:'manha',cidade:'Caucaia',localidade:'regiao',gatilho:'utilidade',titulos:['Caucaia recebe feira de serviços','Feira terá atendimento gratuito em Caucaia','Moradores de Caucaia terão feira'],hook:'A Prefeitura de Caucaia anunciou feira de serviços.',angulo:'Serviços disponíveis para moradores de Caucaia.',fonte_url:'https://www.caucaia.ce.gov.br/noticia',potencial:8,score_justificativa:'Serviço de interesse local, estimativa editorial.'});
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
function fixture(enabled=true){
 const rows=new Map(),messages=[],requests=[];const vault={get:(k,d)=>rows.get(k)??d,put:(k,v)=>rows.set(k,structuredClone(v)),claimAndPut:(r,t,k,v)=>{if(rows.has('receipt:'+r))return false;rows.set('receipt:'+r,true);rows.set(k,structuredClone(v));return true;}};
 const manual=manualQueue(vault,Date.now,fail);
 const config={radarEnabled:enabled,manualEnabled:true,pipelineToken:'a'.repeat(64),editorialSigningKey:'b'.repeat(64)};
 const v=createViral({config,vault,manual,now:Date.now,fail,sendGroup:async text=>messages.push(text),fetchImpl:async(url,options)=>{requests.push({url,body:options.body?JSON.parse(options.body):null});return Response.json({queued:true});}});
 return {v,vault,manual,messages,requests,config};
}
test('Radar não rouba comandos de aprovação de matéria e exige identificador R explícito',()=>{
 assert.deepEqual(parseViral('RADAR caucaia'),{kind:'scan',city:'caucaia'});
 assert.equal(parseViral('APROVAR 12'),null);assert.equal(parseViral('pode publicar'),null);assert.equal(parseViral('quero uma matéria sobre radar de trânsito'),null);
 assert.equal(parseViral('APROVAR R12').number,12);assert.equal(parseViral('CORRIGIR R12: troque o gancho').action,'correct');
});
test('desligado não usa rede, não envia mensagens e rota própria retorna 503',async()=>{
 const f=fixture(false);assert.equal(await f.v.receive({text:'RADAR',receipt:'c'.repeat(64),editorHash:'d'.repeat(64)}),true);
 assert.equal(f.messages.length,0);assert.equal(f.requests.length,0);await assert.rejects(f.v.state(),e=>e.status===503);
});
test('prévia: mensagem única por turno, fonte, estimativa e decisão separada do texto final',async()=>{
 const f=fixture(),items=[proposal(),{...proposal(),numero:13}];const runId=uid();
 await f.v.preview({runId,turno:'manha',items});assert.equal(f.messages.length,1);assert.match(f.messages[0],/\n---\n/);assert.match(f.messages[0],/APROVAR R12/);assert.match(f.messages[0],/estimativa editorial/);assert.match(f.messages[0],/Aprovar sugestão não publica/);
 assert.equal((await f.v.preview({runId,turno:'manha',items})).duplicate,true);assert.equal(f.messages.length,1);
 await assert.rejects(f.v.preview({runId:uid(),turno:'manha',items:[{...proposal(),fonte_url:'https://127.0.0.1/x'}]}));
});
test('aprovação humana assina a sugestão; encaminhamento só cria pauta e é idempotente',async()=>{
 const f=fixture(),p=proposal();await f.v.preview({runId:uid(),turno:'manha',items:[p]});
 const receipt='c'.repeat(64);await f.v.receive({text:'APROVAR R12',receipt,editorHash:'d'.repeat(64)});
 const decision=f.requests[0].body;assert.equal(proof(decision),decisionProof(decision));assert.equal(decision.signature,createHmac('sha256',f.config.editorialSigningKey).update(proof(decision)).digest('hex'));
 const body={id:p.id,revision:1,receipt};const result=await f.v.handoff(body);assert.match(result.jobId,/^[a-f0-9-]{36}$/);assert.equal(f.manual.claim().kind,'pauta');assert.deepEqual(await f.v.handoff(body),result);
 assert.equal(f.manual.status().publishedToday,0);
 await assert.rejects(f.v.handoff({...body,receipt:'e'.repeat(64)}),e=>e.code==='human_decision_required');
});
test('revisão desatualizada e decisão sem prévia são recusadas',async()=>{
 const f=fixture(),p=proposal();const body={actor:'d'.repeat(64),nonce:uid(),kind:'decision',action:'approve',id:p.id,revision:1};
 await assert.rejects(f.v.panel(body),e=>e.code==='radar_no_preview');
 await f.v.preview({runId:uid(),turno:'tarde',items:[p]});await assert.rejects(f.v.panel({...body,revision:2}),e=>e.code==='radar_stale');
});
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only-fixture',TNN_DRAFT_SERVICE_TOKEN:'a'.repeat(64),TNN_DRAFT_READER_TOKEN:'b'.repeat(64),TNN_EDITORIAL_SIGNING_KEY:'c'.repeat(64)};
const req=(body,token=env.TNN_DRAFT_SERVICE_TOKEN)=>new Request('https://fixture.supabase.co/functions/v1/tnn-viral',{method:body?'POST':'GET',headers:{'content-type':'application/json','x-draft-token':token},...(body?{body:JSON.stringify(body)}:{})});
test('Edge: leitor não grava; token de rascunhos não inventa aprovação; erro não expõe segredo',async()=>{
 const calls=[];const h=createViralHandler(env,{fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});}});
 assert.equal((await h(req({action:'sync'},env.TNN_DRAFT_READER_TOKEN))).status,403);
 const d={action:'approve',id:uid(),revision:1,receipt:'d'.repeat(64),editorHash:'e'.repeat(64),signature:'0'.repeat(64)};
 assert.equal((await h(req(d))).status,403);assert.equal(calls.length,0);
 d.signature=createHmac('sha256',env.TNN_EDITORIAL_SIGNING_KEY).update(decisionProof(d)).digest('hex');assert.equal((await h(req(d))).status,200);assert.match(calls[0].url,/rpc\/tnn_viral_decide/);assert.doesNotMatch(calls[0].url,/tnn_ingest/);
 const failed=createViralHandler(env,{fetchImpl:async()=>{throw Error('server-only-fixture');}});assert.doesNotMatch(await (await failed(req(null))).text(),/server-only-fixture/);
});
test('pauta sem data ou título excessivo não passa pelo validador; painel escapa texto',()=>{
 const p={...proposal(),dedupe_hash:'a'.repeat(64),fonte_titulo:'Comunicado oficial',fonte_trecho:'Texto oficial sobre a feira para consulta e conferência. '.repeat(5),fonte_data:new Date().toISOString()};
 assert.equal(validProposal(p),true);assert.equal(validProposal({...p,fonte_data:''}),false);assert.equal(validProposal({...p,titulos:['x '.repeat(14),...p.titulos.slice(1)]}),false);
 const html=viralHTML({items:[{...p,status:'pending',cidade:'Caucaia <script>'}]});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/texto final exige outra aprovação/);
});
test('Postgres: tabelas privadas, dedupe, concorrência de decisão e expiração sem publicar',{skip:!process.env.TNN_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(process.env.TNN_PGLITE_MODULE);const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;
    create table public.tomenota_publications(id uuid primary key,source_hash text,fontes jsonb,published_at timestamptz,agent_job_id uuid,slug text,status text);
    create table public.rascunhos(id uuid primary key,ciclo_id uuid);grant select on public.tomenota_publications,public.rascunhos to service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261017170554_tnn_viral_proposals.sql',import.meta.url),'utf8'));
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);await assert.rejects(db.query('select * from public.tnn_viral_pautas'),/permission denied/);await assert.rejects(db.query('select public.tnn_viral_save($1,$2)',[uid(),'[]']),/permission denied/);await db.exec('reset role');
  }
  const run=uid(),p={...proposal(),dedupe_hash:'a'.repeat(64),fonte_titulo:'Fonte oficial',fonte_trecho:'Comunicado oficial sobre a feira. '.repeat(8),fonte_data:new Date().toISOString()};
  await db.exec('set role service_role');await db.query("insert into public.tnn_viral_runs(id,turno,status) values($1,'manha','running')",[run]);
  const save=async rows=>(await db.query('select public.tnn_viral_save($1,$2::jsonb) r',[run,JSON.stringify(rows)])).rows[0].r;
  assert.equal((await save([p])).length,1);assert.equal((await save([{...p,id:uid()}])).length,0);
  const seen=await db.query('select public.tnn_viral_seen($1::jsonb) r',[JSON.stringify([{hash:p.dedupe_hash,url:p.fonte_url}])]);assert.deepEqual(seen.rows[0].r,[p.dedupe_hash]);
  const decide=async(id,revision,action,receipt)=>(await db.query('select public.tnn_viral_decide($1,$2,$3,$4) r',[id,revision,action,receipt])).rows[0].r;
  assert.equal((await decide(p.id,1,'approve','b'.repeat(64))).item.status,'approved');assert.equal((await decide(p.id,1,'reject','c'.repeat(64))).code,'revision_conflict');
  assert.equal((await db.query('select count(*)::integer n from public.tomenota_publications')).rows[0].n,0);
  const old={...p,id:uid(),dedupe_hash:'d'.repeat(64),fonte_data:new Date(Date.now()-25*3600000).toISOString()};await save([old]);assert.equal((await decide(old.id,1,'approve','e'.repeat(64))).code,'expired');
 }finally{await db.close();}
});
