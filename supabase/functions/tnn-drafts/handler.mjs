const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const locales = ['sao-goncalo','pecem','taiba','croata','paracuru','regiao'];
const codes = ['','ok','no_candidates','weak_sources','already_seen','queue_full','quota_limit','collect_failed','write_failed','store_failed','preview_failed','internal_error'];
const text = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max;
const https = value => {try {const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash && (!u.port || u.port === '443');} catch {return false;}};
const equal = async(a,b) => {
  const digest = async s => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s || '')));
  const [x,y] = await Promise.all([digest(a),digest(b)]); let diff = 0;
  for(let i=0;i<x.length;i++) diff |= x[i]^y[i]; return diff === 0 && Boolean(a && b);
};
export function validateDraft(draft, seen) {
  if(!draft || !uuid.test(draft.id || '') || !text(draft.slug,3,240) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.slug)
    || !text(draft.titulo,3,300) || !text(draft.resumo,10,500) || !text(draft.texto,100,20000) || !locales.includes(draft.localidade)) return false;
  const paragraphs = draft.texto.trim().split(/\n\s*\n/);
  const count = draft.texto.trim().split(/\s+/).length;
  if(paragraphs.length<4 || paragraphs.length>12 || count<300 || count>500) return false;
  if(!Array.isArray(draft.fontes) || draft.fontes.length<2 || draft.fontes.length>5) return false;
  const ids = new Set(), groups = new Set();
  for(const s of draft.fontes) {
    if(!s || !/^[a-z0-9-]{2,50}$/.test(s.id || '') || ids.has(s.id) || !text(s.title,3,500)
      || !text(s.name,2,100) || !/^[a-z0-9-]{2,80}$/.test(s.publisher_group || '')
      || !https(s.url) || !text(s.content,160,12000) || !Number.isFinite(Date.parse(s.published_date))) return false;
    ids.add(s.id); groups.add(s.publisher_group);
  }
  if(groups.size < 2 || !Array.isArray(draft.evidencias) || draft.evidencias.length !== paragraphs.length+2) return false;
  const normalize = s => s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
  const fields = ['titulo','resumo',...paragraphs.map((_,i)=>'paragrafo_'+(i+1))];
  for(const field of fields) {
    const matches=draft.evidencias.filter(e=>e?.campo===field);
    if(matches.length!==1) return false;
    const e=matches[0], source=draft.fontes.find(s=>s.id===e.fonte_id);
    if(!source || !text(e.trecho,20,500) || !normalize(source.content).includes(normalize(e.trecho))) return false;
  }
  if(!Array.isArray(seen) || seen.length < 3 || seen.length>6 || new Set(seen.map(s=>s?.hash)).size!==seen.length) return false;
  if(seen.filter(s=>s.tipo==='titulo').length!==1 || seen.some(s=>!hash.test(s.hash || '') || !['url','titulo'].includes(s.tipo) || !text(s.titulo,3,500))) return false;
  return true;
}

export function createDraftHandler(env, {fetchImpl=fetch}={}) {
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL || '') && env.SUPABASE_SERVICE_ROLE_KEY
    && hash.test(env.TNN_DRAFT_SERVICE_TOKEN || '') && hash.test(env.TNN_DRAFT_READER_TOKEN || '')
    && env.TNN_DRAFT_SERVICE_TOKEN !== env.TNN_DRAFT_READER_TOKEN;
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  async function db(path, payload, method) {
    const result=await fetchImpl(env.SUPABASE_URL+'/rest/v1/'+path,{
      method:method || (payload ? 'POST':'GET'), redirect:'error', signal:AbortSignal.timeout(10000),
      headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},
      ...(payload ? {body:JSON.stringify(payload)}:{})
    });
    if(!result.ok) throw Error('database');
    if(result.status===204) return null;
    const raw=await result.text(); if(raw.length>150000) throw Error('large'); return raw ? JSON.parse(raw):null;
  }
  return async request => {
    try {
      if(!ready) return reply(503,{code:'awaiting_configuration'});
      const token=request.headers.get('x-draft-token');
      const writer=await equal(token,env.TNN_DRAFT_SERVICE_TOKEN);
      const reader=writer || await equal(token,env.TNN_DRAFT_READER_TOKEN);
      if(!reader) return reply(401,{code:'unauthorized'});
      const url=new URL(request.url), action=url.searchParams.get('action');
      if(request.method==='GET') {
        if(action==='context') {
          const [drafts,cycles,seen]=await Promise.all([
            db('rascunhos?select=id,titulo,resumo,localidade,status,revisao,criado_em&order=criado_em.desc&limit=10'),
            db('ciclo_log?select=id,status,etapa,codigo,duracao_ms,criado_em,atualizado_em&order=criado_em.desc&limit=1'),
            db('noticias_vistas?select=hash,tipo,titulo,criado_em&order=criado_em.desc&limit=500')
          ]);
          return reply(200,{drafts,cycle:cycles[0] || null,...(writer ? {seen}:{})});
        }
        if(action==='draft' && uuid.test(url.searchParams.get('id') || '')) {
          const rows=await db('rascunhos?select=id,slug,titulo,resumo,texto,localidade,fontes,evidencias,author,publisher,gerada_por,status,revisao,criado_em&id=eq.'+url.searchParams.get('id')+'&limit=1');
          return reply(rows.length?200:404,rows[0] || {code:'not_found'});
        }
        return reply(400,{code:'invalid_action'});
      }
      if(request.method!=='POST') return reply(405,{code:'method_denied'});
      if(!writer) return reply(403,{code:'read_only'});
      if(!/^application\/json(?:;|$)/.test(request.headers.get('content-type') || '')) return reply(415,{code:'json_required'});
      if(Number(request.headers.get('content-length'))>140000) return reply(413,{code:'too_large'});
      const stream=request.body?.getReader(); let size=0, chunks=[];
      if(!stream) return reply(400,{code:'invalid_body'});
      while(true) {const {done,value}=await stream.read();if(done)break;size+=value.length;if(size>140000){await stream.cancel();return reply(413,{code:'too_large'});}chunks.push(value);}
      const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      let body; try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply(400,{code:'invalid_body'});}
      if(!body || typeof body!=='object' || Array.isArray(body)) return reply(400,{code:'invalid_body'});
      const max=body.max_pending;
      if(body.action==='begin' && uuid.test(body.id || '') && Number.isInteger(max) && max>=1 && max<=10)
        return reply(200,await db('rpc/tnn_drafts_begin',{p_id:body.id,p_max_pending:max}));
      if(body.action==='seen' && Array.isArray(body.hashes) && body.hashes.length>=1 && body.hashes.length<=6 && body.hashes.every(h=>hash.test(h))) {
        const rows=await db('noticias_vistas?select=hash&hash=in.('+body.hashes.join(',')+')&limit=1');
        return reply(200,{seen:rows.length>0});
      }
      if(body.action==='save' && uuid.test(body.cycle_id || '') && Number.isInteger(max) && max>=1 && max<=10 && validateDraft(body.draft,body.seen))
        return reply(200,await db('rpc/tnn_drafts_save',{p_cycle:body.cycle_id,p_draft:body.draft,p_seen:body.seen,p_max_pending:max}));
      if(body.action==='finish' && uuid.test(body.id || '') && ['completed','skipped','failed'].includes(body.status)
        && ['coleta','redacao','rascunho','previa','fim'].includes(body.stage) && codes.includes(body.code)
        && Number.isInteger(body.duration_ms) && body.duration_ms>=0 && body.duration_ms<=900000) {
        await db('ciclo_log?id=eq.'+body.id+'&status=eq.running',{status:body.status,etapa:body.stage,codigo:body.code,duracao_ms:body.duration_ms,atualizado_em:new Date().toISOString()},'PATCH');
        return reply(200,{ok:true});
      }
      return reply(400,{code:'invalid_body'});
    } catch {return reply(503,{code:'draft_store_unavailable'});}
  };
}
