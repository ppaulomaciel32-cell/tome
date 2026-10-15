// Token exclusivo de decisões editoriais; o escritor de rascunhos não publica.
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function equals(a,b){const sum=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s || '')));const [x,y]=await Promise.all([sum(a),sum(b)]);let n=0;for(let i=0;i<32;i++)n|=x[i]^y[i];return n===0 && Boolean(a && b);}
export function createEditorialHandler(env,{fetchImpl=fetch}={}){
  const configured=hash.test(env.TNN_EDITORIAL_TOKEN || '') && hash.test(env.TNN_EDITORIAL_SIGNING_KEY || '') && ![env.TNN_EDITORIAL_TOKEN,env.TNN_DRAFT_SERVICE_TOKEN,env.TNN_DRAFT_READER_TOKEN].includes(env.TNN_EDITORIAL_SIGNING_KEY) && env.TNN_EDITORIAL_TOKEN!==env.TNN_DRAFT_SERVICE_TOKEN && env.TNN_EDITORIAL_TOKEN!==env.TNN_DRAFT_READER_TOKEN && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL || '') && Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
  let hook=false;try{const h=new URL(env.TNN_SITE_REBUILD_HOOK);hook=h.protocol==='https:' && h.hostname==='api.render.com' && /^\/deploy\/srv-[a-z0-9]+$/.test(h.pathname) && !h.username && !h.password;}catch{}
  const publishReady=configured && env.TNN_SITE_URL==='https://tomezap.com.br' && hook;
  return async request=>{
    if(!configured)return reply(503,{code:'awaiting_configuration'});
    if(!await equals(request.headers.get('x-editorial-token'),env.TNN_EDITORIAL_TOKEN))return reply(401,{code:'unauthorized'});
    if(request.method==='GET' && new URL(request.url).searchParams.get('action')==='capabilities')return reply(200,{approval:publishReady,requiresApproval:true});
    if(request.method!=='POST')return reply(405,{code:'method_denied'});
    try{
      if(!/^application\/json(?:;|$)/.test(request.headers.get('content-type') || ''))return reply(415,{code:'json_required'});
      if(Number(request.headers.get('content-length'))>1200)return reply(413,{code:'too_large'});
      const reader=request.body?.getReader();if(!reader)return reply(400,{code:'invalid_body'});
      let size=0,chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1200){await reader.cancel();return reply(413,{code:'too_large'});}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      const p=JSON.parse(new TextDecoder().decode(bytes));
      if(!p || !uuid.test(p.draft_id || '') || !hash.test(p.receipt || '') || !hash.test(p.editor_hash || '') || p.revision!==1 || !['approve','reject'].includes(p.action))return reply(400,{code:'invalid_decision'});
      if(p.not_before!==undefined && (p.action!=='approve' || typeof p.not_before!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.not_before) || !Number.isFinite(Date.parse(p.not_before))))return reply(400,{code:'invalid_decision'});
      const signingKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TNN_EDITORIAL_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const proof=JSON.stringify({action:p.action,draft_id:p.draft_id,revision:1,receipt:p.receipt,editor_hash:p.editor_hash,...(p.not_before?{not_before:p.not_before}: {})});
      const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,new TextEncoder().encode(proof))),b=>b.toString(16).padStart(2,'0')).join('');
      if(!hash.test(p.signature || '') || !await equals(p.signature,signature))return reply(403,{code:'approval_proof_required'});
      if(p.not_before && Date.parse(p.not_before)>Date.now())return reply(409,{code:'scheduled_not_due'});
      // Conferir rebuild ANTES da transação; sem hook, não escrever publicação.
      if(p.action==='approve' && !publishReady)return reply(503,{code:'awaiting_configuration'});
      const response=await fetchImpl(env.SUPABASE_URL+'/rest/v1/rpc/tnn_editorial_decide',{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({p_id:p.draft_id,p_revision:p.revision,p_receipt:p.receipt,p_editor:p.editor_hash,p_decision:p.action})});
      if(!response.ok)return reply(503,{code:'decision_unavailable'});
      const result=await response.json();
      if(!result?.ok)return reply(409,{code:['not_found','already_decided','receipt_conflict','revision_conflict'].includes(result?.code)?result.code:'decision_conflict'});
      if(p.action==='reject')return reply(200,{rejected:true,draft_id:p.draft_id});
      const item=result.publication;
      if(!uuid.test(item?.id || '') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item?.slug || '') || item.slug.length>240 || item.revision!==1)return reply(503,{code:'decision_unavailable'});
      const url=env.TNN_SITE_URL+'/noticia/'+item.slug+'/';
      let requested=false;
      try{requested=(await fetchImpl(env.TNN_SITE_REBUILD_HOOK,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)})).ok;}catch{}
      return reply(requested?200:202,{draft_id:p.draft_id,id:item.id,slug:item.slug,revision:1,url,deploy_requested:requested,status:'publication_pending'});
    }catch{return reply(503,{code:'decision_unavailable'});}
  };
}
