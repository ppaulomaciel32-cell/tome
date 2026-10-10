const LOCALS = new Set(['sao-goncalo','pecem','taiba','croata','paracuru','regiao']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply = (status,data) => new Response(JSON.stringify(data),{status,headers:HEADERS});
const size = v => [...v].length;
const validString = (v,min,max) => typeof v==='string' && size(v.trim())>=min && size(v)<=max;
export function https(value) {
  try {const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.hash;} catch {return false;}
}
export function redact(value) {
  if (typeof value==='string') return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[e-mail removido]')
    .replace(/\b(?:sk-|dk-|sb_secret_)[A-Za-z0-9_-]+/g,'[segredo removido]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value)
    .filter(([k])=>!/(token|secret|key|phone|whatsapp|authorization)/i.test(k))
    .map(([k,v])=>[k,redact(v)]));
  return value;
}
export function validate(p,now=Date.now()) {
  if(!p || !UUID.test(p.job_id||'') || !Number.isSafeInteger(p.revision) || p.revision<1 || p.revision>now+300000) throw Error('envelope');
  if(!/^[a-f0-9]{64}$/.test(p.source_hash||'') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug||'') || !validString(p.slug,3,240)) throw Error('slug');
  if(!validString(p.titulo,3,300) || !validString(p.resumo,10,500) || !validString(p.texto,1,40000)) throw Error('texto');
  const paragraphs=p.texto.trim().split(/\n\s*\n/);
  if(paragraphs.length<4 || paragraphs.length>12) throw Error('paragrafos');
  if(!https(p.cover_url) || !LOCALS.has(p.localidade) || !['ia','humana','ia+humana'].includes(p.gerada_por)) throw Error('campos');
  if(!Array.isArray(p.fontes) || p.fontes.length<1 || p.fontes.length>5 || p.fontes.some(f=>!https(f.url)||!validString(f.titulo,1,500))) throw Error('fontes');
  return Object.fromEntries(['job_id','revision','source_hash','slug','titulo','resumo','texto','cover_url','localidade','gerada_por','fontes'].map(k=>[k,p[k]]));
}
async function sameSecret(given,expected) {
  if(!given || !expected || expected.length<32) return false;
  const hash=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await hash(given),b=await hash(expected); let result=0;
  for(let i=0;i<a.length;i++) result|=a[i]^b[i];
  return result===0;
}
export function createHandler(env,net=fetch) {
  async function rest(path,options={}) {
    const response=await net(`${env.SUPABASE_URL}/rest/v1/${path}`,{...options,redirect:'error',
      signal:AbortSignal.timeout(10000),headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',...options.headers}});
    if(!response.ok) throw Error('database_unavailable');
    return response.status===204 ? null : response.json();
  }
  return async request => {
    if(!env.INGEST_SERVICE_TOKEN || !env.SUPABASE_SERVICE_ROLE_KEY) return reply(503,{error:'Serviço ainda não configurado.'});
    if(!await sameSecret(request.headers.get('x-service-token'),env.INGEST_SERVICE_TOKEN)) return reply(401,{error:'Não autorizado.'});
    if(request.method==='GET') {
      const url=new URL(request.url), action=url.searchParams.get('action');
      try {
        if(action==='list') return reply(200,await rest('tomenota_publications?select=id,slug,title,localidade,published_at,agent_revision&status=eq.published&gerada_por=eq.ia&order=published_at.desc&limit=5'));
        if(action==='logs') {
          const offset=Number(url.searchParams.get('offset')||0);
          if(!Number.isInteger(offset)||offset<0||offset>10000000) return reply(400,{error:'Offset inválido.'});
          return reply(200,await rest(`agent_log?select=id,job_id,etapa,status,erro,duracao_ms,payload,criado_em&order=criado_em.asc,id.asc&limit=500&offset=${offset}`));
        }
      } catch {return reply(503,{error:'Consulta indisponível.'});}
      return reply(400,{error:'Consulta inválida.'});
    }
    if(request.method!=='POST') return reply(405,{error:'Método não permitido.'});
    if(Number(request.headers.get('content-length')||0)>80000) return reply(413,{error:'Conteúdo muito grande.'});
    let data;
    try {
      const text=await request.text();
      if(new TextEncoder().encode(text).length>80000) return reply(413,{error:'Conteúdo muito grande.'});
      data=JSON.parse(text);
      if(!data || typeof data!=='object' || Array.isArray(data)) return reply(400,{error:'JSON deve ser um objeto.'});
    } catch {return reply(400,{error:'JSON inválido.'});}
    if(data.action==='log') {
      if(!UUID.test(data.job_id||'')||!validString(data.etapa,1,60)||!validString(data.status,1,40)||!Number.isSafeInteger(data.duracao_ms)||data.duracao_ms<0) return reply(400,{error:'Log inválido.'});
      try {await rest('agent_log',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({job_id:data.job_id,etapa:data.etapa,status:data.status,duracao_ms:data.duracao_ms,erro:redact(String(data.erro||'').slice(0,1000))})});return reply(200,{ok:true});}
      catch{return reply(503,{error:'Registro indisponível.'});}
    }
    let payload;
    try {payload=validate(data);} catch{return reply(422,{error:'Matéria inválida ou incompleta.'});}
    // Valida configuração ANTES de permitir escrita. Nunca devolver URL inventada.
    if(!https(env.SITE_URL)||!https(env.SITE_REBUILD_HOOK)) return reply(503,{error:'Publicação estática ainda não configurada.'});
    let result;
    try {result=await rest('rpc/tnn_ingest_agent',{method:'POST',body:JSON.stringify({p:payload,audit_payload:redact(payload)})});}
    catch{return reply(503,{error:'Não foi possível salvar a matéria.'});}
    const url=`${env.SITE_URL.replace(/\/$/,'')}/noticia/${result.slug}/`;
    try {
      // Repetir o hook é seguro; repetir a transação não duplica a matéria.
      const deploy=await net(env.SITE_REBUILD_HOOK,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!deploy.ok) throw Error('rebuild');
      return reply(200,{...result,url,deploy_requested:true});
    } catch {
      return reply(202,{...result,url,deploy_requested:false,warning:'Matéria salva; publicação estática pendente.'});
    }
  };
}
