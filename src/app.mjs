import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sealSession, openSession, sanitize, RateLimiter } from './security.mjs';

export async function buildApp({ provider, origin, sessionKey, secure = true, audit = () => {}, secrets = [], webRoot = fileURLToPath(new URL('../dist', import.meta.url)) }) {
  if (!provider || !origin || !Buffer.isBuffer(sessionKey) || sessionKey.length !== 32) throw new Error('Configuração do servidor incompleta.');
  const app = Fastify({ logger: false, bodyLimit: 10_000_000, trustProxy: false });
  const limiter = new RateLimiter();
  const refreshing = new Map();
  const cookieName = secure ? '__Host-radar' : 'radar-local';
  await app.register(cookie);
  const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
  const setSession = (reply, session) => reply.setCookie(cookieName, sealSession(session, sessionKey), {
    path: '/', secure, httpOnly: true, sameSite: 'strict', maxAge: Math.max(0, Math.floor((session.deadline - Date.now()) / 1000)),
  });
  const clearSession = reply => reply.clearCookie(cookieName, { path: '/', secure, httpOnly: true, sameSite: 'strict' });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (secure) reply.header('Strict-Transport-Security', 'max-age=31536000');
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')) throw fail(403, 'Origem da solicitação não autorizada.');
  });
  app.addHook('onResponse', async (req, reply) => {
    // Nunca passa objeto de request, cabeçalhos, corpo, query ou erro ao logger.
    audit({ route: req.routeOptions.url || 'unmatched', method: req.method, status: reply.statusCode });
  });
  app.setErrorHandler((error, req, reply) => {
    const codes = { '28000': 401, '42501': 403, '22023': 422, '23505': 409, '40001': 409, 'P0002': 404, '23514': 400, '23502': 400, '22P02': 400, '22007': 400, '22008': 400 };
    const status = error.validation ? 400 : (codes[error.code] || error.statusCode || 503);
    const own = error.statusCode && status < 500;
    const controlled = ['28000','42501','22023','P0002','40001'].includes(error.code);
    const message = own || controlled ? String(sanitize(error.message, secrets)).slice(0, 300)
      : status === 409 ? 'Há um registro em conflito. Atualize a tela e confira a prévia.'
        : status < 500 ? 'Solicitação inválida. Confira os campos e tente novamente.' : 'Não foi possível concluir a operação. Tente novamente.';
    reply.code(status).send({ erro: message });
  });
  const sessionFor = async (req, reply) => {
    let session = openSession(req.cookies[cookieName], sessionKey);
    if (!session) throw fail(401, 'Entre na sua conta para continuar.');
    if (session.expires_at * 1000 <= Date.now() + 30_000) {
      const id = createHash('sha256').update(session.refresh_token).digest('hex');
      try {
        if (!refreshing.has(id)) {
          const pending = provider.refresh(session.refresh_token);
          refreshing.set(id, pending);
          const timer = setTimeout(() => refreshing.delete(id), 15_000); timer.unref();
        }
        const fresh = await refreshing.get(id);
        session = { access_token: fresh.access_token, refresh_token: fresh.refresh_token, expires_at: fresh.expires_at, deadline: session.deadline };
        setSession(reply, session);
      } catch { clearSession(reply); throw fail(401, 'Sua sessão expirou. Entre novamente.'); }
    }
    return session;
  };
  const rpc = async (req, reply, name, args = {}) => {
    const session = await sessionFor(req, reply);
    return sanitize(await provider.rpc(session.access_token, name, args), secrets);
  };
  const uuid = { type: 'string', format: 'uuid' };
  const roomHeaders = { type: 'object', required: ['x-redacao-id'], properties: { 'x-redacao-id': uuid } };
  const roomParams = { type: 'object', properties: { id: uuid, acao: { type: 'string', enum: ['notas','conferir-evidencia','conferir-pacote','aprovar','descartar','apurar'] } } };
  const note = { type: 'string', minLength: 1, maxLength: 20000 };
  app.get('/api/v1/health', async () => ({ ok: true, produto: 'Radar Tome Nota', etapa: 'acesso-e-importacao' }));
  app.post('/api/v1/auth/login', { schema: { body: { type: 'object', additionalProperties: false, required: ['email','password'], properties: { email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 1000 } } } } }, async (req, reply) => {
    if (!limiter.take(`ip:${req.ip}`, 30, 900000) || !limiter.take(`email:${req.body.email.trim().toLowerCase()}`, 8, 900000)) throw fail(429, 'Muitas tentativas de entrada. Aguarde 15 minutos.');
    let session;
    try { session = await provider.login(req.body.email.trim(), req.body.password); } catch { throw fail(401, 'Não foi possível entrar. Confira e-mail e senha.'); }
    if (!session?.access_token) throw fail(401, 'Não foi possível entrar. Confira e-mail e senha.');
    let context;
    try { context = await provider.rpc(session.access_token, 'tn_ativar_acesso', {}); }
    catch (error) { try { await provider.logout(session.access_token); } catch {} throw error; }
    setSession(reply, { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at, deadline: Date.now() + 8 * 3600000 });
    return { usuario: sanitize(context, secrets) };
  });
  app.post('/api/v1/auth/logout', async (req, reply) => {
    const session = await sessionFor(req, reply);
    // Só confirma saída após revogação no provedor. A RPC também verifica auth.sessions.
    await provider.logout(session.access_token); clearSession(reply); return { ok: true };
  });
  app.get('/api/v1/auth/me', async (req, reply) => ({ usuario: await rpc(req, reply, 'tn_contexto') }));
  app.post('/api/v1/auth/renovar', async (req, reply) => ({ usuario: await rpc(req, reply, 'tn_contexto') }));
  app.get('/api/v1/pautas', { schema: { headers: roomHeaders, params: roomParams } }, (req, reply) => rpc(req, reply, 'tn_listar_pautas', { redacao_id: req.headers['x-redacao-id'], limite: 250 }));
  app.get('/api/v1/pautas/:id', { schema: { headers: roomHeaders, params: roomParams } }, (req, reply) => rpc(req, reply, 'tn_consultar', { redacao_id: req.headers['x-redacao-id'], recurso: 'pauta', pauta_id: req.params.id }));
  app.get('/api/v1/eventos', { schema: { headers: roomHeaders, params: roomParams } }, (req, reply) => rpc(req, reply, 'tn_consultar', { redacao_id: req.headers['x-redacao-id'], recurso: 'eventos' }));
  app.post('/api/v1/pautas', { schema: { headers: roomHeaders, params: roomParams, body: { type: 'object', required: ['dados','nota'], additionalProperties: false, properties: { dados: { type: 'object' }, nota: note } } } }, (req, reply) => rpc(req, reply, 'tn_comando', { redacao_id: req.headers['x-redacao-id'], pauta_id: null, acao: 'criar', revisao_esperada: null, dados: sanitize(req.body.dados, secrets), nota: sanitize(req.body.nota, secrets) }));
  app.patch('/api/v1/pautas/:id/conteudo', { schema: { headers: roomHeaders, params: roomParams, body: { type: 'object', required: ['revisao_esperada','nota'], additionalProperties: false, properties: { dados: { type: 'object', default: {} }, revisao_esperada: { type: 'integer', minimum: 1 }, nota: note } } } }, (req, reply) => rpc(req, reply, 'tn_comando', { redacao_id: req.headers['x-redacao-id'], pauta_id: req.params.id, acao: 'editar', revisao_esperada: req.body.revisao_esperada, dados: sanitize(req.body.dados, secrets), nota: sanitize(req.body.nota, secrets) }));
  app.post('/api/v1/pautas/:id/:acao', { schema: { headers: roomHeaders, params: roomParams, body: { type: 'object', required: ['revisao_esperada','nota'], additionalProperties: false, properties: { dados: { type: 'object', default: {} }, revisao_esperada: { type: 'integer', minimum: 1 }, nota: note } } } }, (req, reply) => rpc(req, reply, 'tn_comando', { redacao_id: req.headers['x-redacao-id'], pauta_id: req.params.id, acao: ({notas:'nota', 'conferir-evidencia':'conferir_evidencia', 'conferir-pacote':'conferir_pacote'})[req.params.acao] || req.params.acao, revisao_esperada: req.body.revisao_esperada, dados: sanitize(req.body.dados, secrets), nota: sanitize(req.body.nota, secrets) }));
  app.post('/api/v1/importacoes/validar', { schema: { headers: roomHeaders, params: roomParams, body: { type: 'object' } } }, (req, reply) => rpc(req, reply, 'tn_prever_importacao', { redacao_id: req.headers['x-redacao-id'], arquivo: sanitize(req.body, secrets) }));
  app.post('/api/v1/importacoes/:id/confirmar', { schema: { headers: roomHeaders, params: roomParams, body: { type: 'object', additionalProperties: false, required: ['confirmacao','nota'], properties: { confirmacao: { type: 'boolean' }, nota: note } } } }, (req, reply) => rpc(req, reply, 'tn_confirmar_importacao', { redacao_id: req.headers['x-redacao-id'], importacao_id: req.params.id, confirmacao: req.body.confirmacao, nota: sanitize(req.body.nota, secrets) }));
  app.get('/api/v1/exportacoes', { schema: { headers: roomHeaders, params: roomParams } }, async (req, reply) => {
    reply.header('Content-Disposition', 'attachment; filename="Radar-Tome-Nota-export.json"');
    return rpc(req, reply, 'tn_exportar', { redacao_id: req.headers['x-redacao-id'] });
  });
  await app.register(staticFiles, { root: webRoot, index: ['index.html'], wildcard: false });
  return app;
}
