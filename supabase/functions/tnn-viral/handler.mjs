const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const triggers=['curiosidade-concreta','espanto','identidade-local','utilidade','prova-social','nostalgia','historia-humana','contraste'];
const text=(s,min,max)=>typeof s==='string' && s.length>=min && s.length<=max && !/[<>\x00-\x08\x0b-\x1f]/.test(s);
const https=s=>{try{const u=new URL(s);return u.protocol==='https:' && !u.username && !u.password && !u.hash && !u.port && /[a-z]/i.test(u.hostname) && !u.hostname.includes(':') && u.hostname.includes('.') && u.href.length<=1500;}catch{return false;}};
async function equal(a,b){const sum=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v || '')));const [x,y]=await Promise.all([sum(a),sum(b)]);return Boolean(a && b) && x.reduce((n,b,i)=>n|(b^y[i]),0)===0;}
export function validAngle(p){return p && triggers.includes(p.gatilho) && Array.isArray(p.titulos) && p.titulos.length===3 && p.titulos.every(t=>text(t,3,180) && t.trim().split(/\s+/).length<=12) && text(p.hook,10,500) && text(p.angulo,10,500) && Number.isInteger(p.potencial) && p.potencial>=7 && p.potencial<=10 && text(p.score_justificativa,5,300);}
export function validProposal(p){return validAngle(p) && uuid.test(p.id || '') && hash.test(p.dedupe_hash || '') && ['manha','tarde','noite','demanda'].includes(p.turno) && text(p.cidade,2,100)
 && ['sao-goncalo','pecem','taiba','croata','paracuru','regiao'].includes(p.localidade) && https(p.fonte_url) && text(p.fonte_titulo,3,500) && text(p.fonte_trecho,160,12000)
 && Number.isFinite(Date.parse(p.fonte_data)) && Date.parse(p.fonte_data)<=Date.now()+300000 && Date.parse(p.fonte_data)>=Date.now()-36*3600000
 && (p.cover_candidato==null || https(p.cover_candidato));}
export const decisionProof=p=>JSON.stringify({namespace:'tnn-viral',action:p.action,proposal_id:p.id,revision:p.revision,receipt:p.receipt,editor_hash:p.editorHash,title_index:p.titleIndex??0,instruction:p.instruction??''});
async function sign(proof,key){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(proof))),b=>b.toString(16).padStart(2,'0')).join('');}
export function createViralHandler(env,{fetchImpl=fetch}={}){
 const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 async function db(path,body,method){const r=await fetchImpl(env.SUPABASE_URL+'/rest/v1/'+path,{method:method || (body?'POST':'GET'),redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('database');const raw=await r.text();if(raw.length>500000)throw Error('too_large');return raw?JSON.parse(raw):null;}
 return async req=>{try{
   if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL || '') || !env.SUPABASE_SERVICE_ROLE_KEY || !hash.test(env.TNN_DRAFT_SERVICE_TOKEN || '') || !hash.test(env.TNN_DRAFT_READER_TOKEN || '') || env.TNN_DRAFT_SERVICE_TOKEN===env.TNN_DRAFT_READER_TOKEN)return reply(503,{code:'awaiting_configuration'});
   const token=req.headers.get('x-draft-token'),writer=await equal(token,env.TNN_DRAFT_SERVICE_TOKEN);
   if(!writer && !await equal(token,env.TNN_DRAFT_READER_TOKEN))return reply(401,{code:'unauthorized'});
   const u=new URL(req.url);
   if(req.method==='GET'){
     const id=u.searchParams.get('id');if(id && !uuid.test(id))return reply(400,{code:'invalid_id'});
     const path='tnn_viral_pautas?select=id,numero,run_id,turno,cidade,localidade,gatilho,titulos,hook,angulo,fonte_url,fonte_titulo,fonte_data,potencial,cover_candidato,score_justificativa,status,revisao,redacao_job_id,published_slug,criado_em'+(id?',fonte_trecho&id=eq.'+id:'&status=in.(pending,approved)&order=criado_em.desc&limit=40');
     return reply(200,{items:await db(path)});
   }
   if(req.method!=='POST')return reply(405,{code:'method_denied'});
   if(!writer)return reply(403,{code:'read_only'});
   if(!/^application\/json(?:;|$)/.test(req.headers.get('content-type') || ''))return reply(415,{code:'json_required'});
   const reader=req.body?.getReader();if(!reader)return reply(400,{code:'invalid_body'});
   let n=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>60000){await reader.cancel();return reply(413,{code:'too_large'});}chunks.push(value);}
   const bytes=new Uint8Array(n);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}const p=JSON.parse(new TextDecoder().decode(bytes));
   if(!p || typeof p!=='object' || Array.isArray(p))return reply(400,{code:'invalid_body'});
   if(p.action==='run' && uuid.test(p.id || '') && ['manha','tarde','noite','demanda'].includes(p.turno) && ['running','completed','failed','skipped'].includes(p.status) && /^[a-z0-9_]{0,60}$/.test(p.code || '') && p.metrics && typeof p.metrics==='object' && !Array.isArray(p.metrics) && Object.keys(p.metrics).length<=12 && Object.values(p.metrics).every(x=>Number.isSafeInteger(x) && x>=0 && x<=1000000)){
     return reply(200,await db('tnn_viral_runs?on_conflict=id',{id:p.id,turno:p.turno,status:p.status,metricas:p.metrics,codigo:p.code || '',atualizado_em:new Date().toISOString()},'POST'));
   }
   if(p.action==='seen' && Array.isArray(p.items) && p.items.length<=150 && p.items.every(r=>r && hash.test(r.hash || '') && https(r.url)))return reply(200,{hashes:await db('rpc/tnn_viral_seen',{p_rows:p.items})});
   if(p.action==='save' && uuid.test(p.runId || '') && Array.isArray(p.items) && p.items.length<=3 && p.items.every(validProposal))return reply(200,{items:await db('rpc/tnn_viral_save',{p_run:p.runId,p_rows:p.items})});
   if(p.action==='sync')return reply(200,await db('rpc/tnn_viral_sync',{}));
   if(p.action==='expire' && uuid.test(p.id || ''))return reply(200,await db('tnn_viral_pautas?id=eq.'+p.id+'&status=eq.pending&fonte_data=lt.'+new Date(Date.now()-86400000).toISOString(),{status:'expired',resolvido_em:new Date().toISOString()},'PATCH'));
   if(p.action==='link' && uuid.test(p.id || '') && uuid.test(p.jobId || '') && hash.test(p.receipt || '') && Number.isInteger(p.revision) && hash.test(p.signature || '') && hash.test(env.TNN_EDITORIAL_SIGNING_KEY || '')){
     // Só liga uma aprovação existente; nenhuma coluna do jornal é editada aqui.
     const proof=JSON.stringify({namespace:'tnn-viral-handoff',id:p.id,revision:p.revision,receipt:p.receipt,job_id:p.jobId});
     if(!await equal(p.signature,await sign(proof,env.TNN_EDITORIAL_SIGNING_KEY)))return reply(403,{code:'handoff_proof_required'});
     return reply(200,await db('tnn_viral_pautas?id=eq.'+p.id+'&status=eq.approved&revisao=eq.'+p.revision+'&decisao_recibo=eq.'+p.receipt+'&or=(redacao_job_id.is.null,redacao_job_id.eq.'+p.jobId+')',{redacao_job_id:p.jobId},'PATCH'));
   }
   if(['approve','reject','correct'].includes(p.action) && uuid.test(p.id || '') && Number.isInteger(p.revision) && p.revision>0 && hash.test(p.receipt || '') && hash.test(p.editorHash || '') && hash.test(p.signature || '') && hash.test(env.TNN_EDITORIAL_SIGNING_KEY || '') && Number.isInteger(p.titleIndex??0) && (p.titleIndex??0)>=0 && (p.titleIndex??0)<=2 && text(p.instruction??'',0,1000)){
     const sig=await sign(decisionProof(p),env.TNN_EDITORIAL_SIGNING_KEY);
     if(!await equal(sig,p.signature))return reply(403,{code:'human_decision_required'});
     if(p.action==='correct' && !validAngle(p.edit))return reply(400,{code:'invalid_angle'});
     return reply(200,await db('rpc/tnn_viral_decide',{p_id:p.id,p_revision:p.revision,p_action:p.action,p_receipt:p.receipt,p_edit:p.edit??null,p_title:p.titleIndex??0,p_reason:p.instruction??''}));
   }
   return reply(400,{code:'invalid_action'});
 }catch{return reply(503,{code:'viral_unavailable'});}};
}
