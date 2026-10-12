import http from 'node:http';
import {isIP} from 'node:net';
import {createHash, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createAuth, PanelError, normalizeEmail} from './auth.mjs';
import {createWhatsAppClient} from './whatsapp.mjs';
import {createDraftReader} from './drafts.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV !== 'development';
  const siteUrl = env.SITE_URL || 'https://tomezap.com.br';
  const site = new URL(siteUrl);
  if (site.href !== site.origin + '/' || site.username || site.password || (site.protocol !== 'https:' && !( !production && ['localhost','127.0.0.1'].includes(site.hostname) && site.protocol === 'http:'))) throw Error('SITE_URL precisa ser uma origem HTTPS.');
  const supabaseUrl = (env.SUPABASE_URL || '').replace(/\/$/, '');
  if (supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) throw Error('SUPABASE_URL inválida.');
  const publicKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '';
  if (publicKey && !publicKey.startsWith('sb_publishable_')) {
    try { if (JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url')).role !== 'anon') throw Error(); }
    catch { throw Error('O painel aceita somente chave pública publishable/anon.'); }
  }
  const owner = normalizeEmail(env.PANEL_OWNER_EMAIL);
  const editors = (env.PANEL_EDITOR_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean);
  if ((owner && !emailPattern.test(owner)) || editors.some(e => !emailPattern.test(e))) throw Error('E-mail autorizado inválido.');
  const agentUrl = env.AGENT_PUBLIC_URL || 'https://bot.tomezap.com.br';
  if(agentUrl !== 'https://bot.tomezap.com.br') throw Error('AGENT_PUBLIC_URL precisa ser https://bot.tomezap.com.br.');
  const waUrl=env.WA_BRIDGE_URL || '', waToken=env.WA_BRIDGE_TOKEN || '';
  if(waUrl && waUrl!=='http://whatsapp:3090')throw Error('WA_BRIDGE_URL precisa apontar para o serviço privado whatsapp.');
  if(waToken && !/^[a-f0-9]{64}$/i.test(waToken))throw Error('WA_BRIDGE_TOKEN inválido.');
  const draftsUrl=env.TNN_DRAFTS_URL || '',draftsToken=env.TNN_DRAFT_READER_TOKEN || '';
  if(draftsUrl && draftsUrl!==supabaseUrl+'/functions/v1/tnn-drafts')throw Error('TNN_DRAFTS_URL deve usar o mesmo projeto Supabase do painel.');
  if(draftsToken && !/^[a-f0-9]{64}$/.test(draftsToken))throw Error('TNN_DRAFT_READER_TOKEN inválido.');
  return {production, siteUrl: site.origin, supabaseUrl, publicKey, owner, editors,
    draftsUrl,draftsToken,
    agentUrl,waUrl,waToken,waConfigured:Boolean(waUrl && waToken),
    configured: Boolean(owner && publicKey && supabaseUrl), trustProxy: env.PANEL_TRUST_PROXY === 'true'};
}
function limiter(now = Date.now) {
  const buckets = new Map();
  return (key, limit, duration) => {
    if (buckets.size > 5000) for (const [k, value] of buckets) if (value.until <= now()) buckets.delete(k);
    if (buckets.size > 10000 && !buckets.has(key)) throw new PanelError(429, 'rate_limit', 'Muitas tentativas. Aguarde alguns minutos.');
    let entry = buckets.get(key);
    if (!entry || entry.until <= now()) {entry = {count: 0, until: now() + duration}; buckets.set(key, entry);}
    if (++entry.count > limit) throw new PanelError(429, 'rate_limit', 'Muitas tentativas. Aguarde alguns minutos.');
  };
}
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new PanelError(415, 'json_required', 'Envie os dados no formato esperado.');
  if (Number(req.headers['content-length']) > 8192) throw new PanelError(413, 'too_large', 'O formulário excedeu o tamanho permitido.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {size += chunk.length; if (size > 8192) throw new PanelError(413, 'too_large', 'O formulário excedeu o tamanho permitido.'); chunks.push(chunk);}
  try {const data = JSON.parse(Buffer.concat(chunks)); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data;}
  catch {throw new PanelError(400, 'invalid_json', 'Confira os dados e tente novamente.');}
}
const sameSecret = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function createPanelServer({config = loadConfig(), fetchImpl = fetch, now = Date.now, whatsappClient,draftReader} = {}) {
  const auth = createAuth(config, {fetchImpl, now}), limit = limiter(now);
  const wa=whatsappClient || createWhatsAppClient(config,{fetchImpl});
  const drafts=draftReader || createDraftReader(config,{fetchImpl});
  const connectAssets=new Map([
    ['/conectar',['text/html; charset=utf-8','index.html']],
    ['/conectar/',['text/html; charset=utf-8','index.html']],
    ['/conectar/connection.css',['text/css; charset=utf-8','connection.css']],
    ['/conectar/connection.mjs',['text/javascript; charset=utf-8','connection.mjs']]
  ].map(([route,[type,file]])=>[route,{type,bytes:readFileSync(new URL('./connect/'+file,import.meta.url))}]));
  return http.createServer({requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384}, async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Vary', 'Origin');
    const send = (code, value) => {res.statusCode = code; res.end(value === undefined ? undefined : JSON.stringify(value));};
    try {
      const path = new URL(req.url, 'http://panel.invalid').pathname;
      // Esta rota confirma apenas o processo local; não anuncia integrações ativas.
      if (path === '/healthz' && req.method === 'GET') return send(200, {ok: true, service: 'tomezap-panel', authConfigured: config.configured});
      const asset=connectAssets.get(path);
      if (!path.startsWith('/painel-api/') && !asset) throw new PanelError(404, 'not_found', 'Endereço não encontrado.');
      if (config.production && !(req.socket.encrypted || (config.trustProxy && req.headers['x-forwarded-proto'] === 'https'))) throw new PanelError(403, 'https_required', 'Use uma conexão HTTPS.');
      const origin = req.headers.origin;
      const sameOriginRead=req.method==='GET' && !origin && req.headers['sec-fetch-site']==='same-origin' && req.headers.host===new URL(config.agentUrl).host;
      if (origin ? ![config.siteUrl,config.agentUrl].includes(origin) : !(asset && req.method==='GET') && !sameOriginRead) throw new PanelError(403, 'origin_denied', 'Origem não autorizada.');
      if(origin)res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (req.method === 'OPTIONS') {
        if (!['GET', 'POST'].includes(req.headers['access-control-request-method'])) throw new PanelError(403, 'method_denied', 'Operação não permitida.');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
        return send(204);
      }
      const proxyIp = req.headers['x-real-ip'];
      const ip = config.trustProxy && typeof proxyIp === 'string' && isIP(proxyIp) ? proxyIp : req.socket.remoteAddress;
      limit('all:' + ip, 120, 60000);
      if (!config.configured) throw new PanelError(503, 'awaiting_connection', 'Aguardando conexão: o acesso seguro ainda precisa ser ativado no servidor.');
      if(asset && req.method==='GET') {
        const session=await auth.session(req.headers.cookie);
        if(session.user.role!=='owner')throw new PanelError(403,'owner_required','Somente o dono pode parear o chip e escolher o grupo.');
        res.setHeader('Content-Type',asset.type);
        res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
        res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        return res.end(asset.bytes);
      }
      if (path === '/painel-api/login' && req.method === 'POST') {
        limit('login:' + ip, 10, 15 * 60000);
        const body = await jsonBody(req);
        const emailHash = createHash('sha256').update(normalizeEmail(body.email)).digest('hex');
        limit('email:' + emailHash, 10, 15 * 60000);
        const result = await auth.login(body.email, body.password, req.headers.cookie);
        res.setHeader('Set-Cookie', result.cookie);
        return send(200, {user: result.user, csrf: result.csrf});
      }
      const waPaths=new Map([['status','GET'],['pairing','GET'],['groups','GET'],['start','POST'],['pair-code','POST'],['group','POST'],['test','POST']].map(([p,m])=>['/painel-api/whatsapp/'+p,{p,m}]));
      const waRoute=waPaths.get(path);
      const draftRoute=path.match(/^\/painel-api\/drafts(?:\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}))?$/);
      if (!['/painel-api/session','/painel-api/logout','/painel-api/bootstrap'].includes(path) && !waRoute && !draftRoute) throw new PanelError(404, 'not_found', 'Endereço não encontrado.');
      const session = await auth.session(req.headers.cookie);
      if(draftRoute){
        if(req.method!=='GET')throw new PanelError(405,'read_only','Nesta etapa, o painel só permite conferir os rascunhos.');
        limit('draft-read:'+session.user.id,30,60000);
        return send(200,await drafts(draftRoute[1]));
      }
      if(waRoute){
        if(req.method!==waRoute.m)throw new PanelError(405,'method_denied','Operação não permitida.');
        if(waRoute.p!=='status' && session.user.role!=='owner')throw new PanelError(403,'owner_required','Somente o dono pode parear o chip e escolher o grupo.');
        if(waRoute.m==='POST'){
          if(!sameSecret(req.headers['x-csrf-token'],session.csrf))throw new PanelError(403,'csrf_denied','Atualize a página antes de continuar.');
          limit('wa-mutation:'+session.user.id,6,60000);
          return send(200,await wa('/'+waRoute.p,await jsonBody(req)));
        }
        if(waRoute.p==='groups')limit('wa-groups:'+session.user.id,6,60000);
        const data=await wa('/'+waRoute.p);
        if(waRoute.p==='status'){
          // Uma mudança futura no provedor não pode vazar QR para editores.
          const fields=['state','connected','configured','group','dedicatedNumber','authorizedEditors','connectedAt','lastError','publicationEnabled','requiresApproval','cycle'];
          return send(200,Object.fromEntries(fields.filter(k=>k in data).map(k=>[k,data[k]])));
        }
        return send(200,data);
      }
      if (path === '/painel-api/session' && req.method === 'GET') return send(200, {user: session.user, csrf: session.csrf});
      if (path === '/painel-api/bootstrap' && req.method === 'GET') return send(200, {
        user: session.user, milestone: 1,
        modules: ['biblioteca','infraestrutura','tracking','whatsapp','instagram','dashboard'].map(id => ({id, status: 'awaiting_connection'}))
      });
      if (path === '/painel-api/logout' && req.method === 'POST') {
        if (!sameSecret(req.headers['x-csrf-token'], session.csrf)) throw new PanelError(403, 'csrf_denied', 'Atualize a página antes de continuar.');
        res.setHeader('Set-Cookie', await auth.logout(session));
        return send(204);
      }
      throw new PanelError(405, 'method_denied', 'Operação não permitida.');
    } catch (error) {
      if (error.status === 401) res.setHeader('Set-Cookie', auth.clearCookie());
      if(error.status===401 && ['/conectar','/conectar/'].includes(req.url)) {
        res.statusCode=303;res.setHeader('Location',config.siteUrl+'/admin/#whatsapp');return res.end();
      }
      if (error.status === 429) res.setHeader('Retry-After', '900');
      // Não registrar corpo, senha, cookie ou resposta bruta do provedor.
      send(error instanceof PanelError ? error.status : 500, {code: error instanceof PanelError ? error.code : 'internal_error', message: error instanceof PanelError ? error.message : 'Não foi possível concluir. Tente novamente.'});
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 3080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT inválida.');
    const server = createPanelServer();
    server.listen(port, process.env.HOST || '127.0.0.1', () => console.log('API do painel iniciada.'));
    for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => {server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 10000).unref();});
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
