// A senha vai ao Supabase. Tokens ficam no servidor e no cofre criptografado.
import {randomBytes, createHash} from 'node:crypto';
import {openSessionStore} from './session-store.mjs';

export class PanelError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status, code}); }
}
const unavailable = () => new PanelError(503, 'auth_unavailable', 'O serviço de acesso está indisponível. Tente novamente em instantes.');
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const invalid = () => new PanelError(401, 'invalid_login', 'Não foi possível entrar. Confira seu e-mail, sua senha e sua autorização.');
export function roleFor(user, config) {
  // O e-mail precisa vir de GET /auth/v1/user, nunca do formulário ou user_metadata.
  if (!user?.id || !user.email_confirmed_at || user.is_anonymous ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())) return null;
  const email = normalizeEmail(user.email);
  if (email === config.owner) return 'owner';
  return config.editors.includes(email) ? 'editor' : null;
}

export function createAuth(config, {fetchImpl = fetch, now = Date.now} = {}) {
  const store = openSessionStore(config.sessionDir), sessions = store.sessions;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const cookieName = config.production ? '__Host-tnn_panel' : 'tnn_panel_dev';
  const lifetime = 8 * 60 * 60 * 1000;
  const idle = 30 * 60 * 1000;
  function cookie(value, clear = false) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : lifetime / 1000}${config.production ? '; Secure' : ''}`;
  }
  function idFrom(header = '') {
    const value = header.split(';').map(p => p.trim()).find(p => p.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    return value && /^[a-zA-Z0-9_-]{43}$/.test(value) ? hash(value) : null;
  }
  function prune() {
    store.assertReady?.();
    let changed=false;
    for (const [key, s] of sessions) if (s.deadline <= now() || s.lastSeen + idle <= now()) {sessions.delete(key);changed=true;}
    if(changed)store.save();
  }
  async function request(route, {method = 'GET', body, token} = {}) {
    let response;
    try {
      response = await fetchImpl(config.supabaseUrl + '/auth/v1' + route, {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {apikey: config.publicKey, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
        ...(body ? {body: JSON.stringify(body)} : {})
      });
    } catch { throw unavailable(); }
    if (!response.ok) {
      if (response.status === 429) throw new PanelError(429, 'auth_rate_limit', 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
      if (response.status >= 500) throw unavailable();
      throw invalid();
    }
    if (response.status === 204) return {};
    try { return await response.json(); } catch { throw unavailable(); }
  }
  function verified(user) {
    const role = roleFor(user, config);
    if (!role) throw invalid();
    // Não contornar uma conta que já exige um segundo fator.
    if (user.factors?.some(f => f.status === 'verified')) throw new PanelError(403, 'mfa_required', 'Esta conta exige verificação em duas etapas. A conexão precisa ser concluída pelo responsável técnico.');
    return {id: user.id, email: normalizeEmail(user.email), role};
  }
  function tokenSet(data) {
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw unavailable();
    return {access: data.access_token, refresh: data.refresh_token, expires: now() + data.expires_in * 1000};
  }
  return {
    async login(emailInput, password, previousCookie) {
      const email = normalizeEmail(emailInput);
      if (!email || email.length > 254 || typeof password !== 'string' || password.length < 1 || password.length > 1024) throw invalid();
      if (email !== config.owner && !config.editors.includes(email)) throw invalid();
      prune();
      if (sessions.size >= 500) throw unavailable();
      const tokens = tokenSet(await request('/token?grant_type=password', {method: 'POST', body: {email, password}}));
      let user;
      try {
        user = verified(await request('/user', {token: tokens.access}));
        if (user.email !== email) throw invalid();
      } catch (error) {
        await request('/logout?scope=local', {method: 'POST', token: tokens.access}).catch(() => {});
        throw error;
      }
      sessions.delete(idFrom(previousCookie));
      const raw = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      sessions.set(hash(raw), {...tokens, user, csrf, lastSeen: now(), deadline: now() + lifetime, refreshing: null});
      store.save();
      return {user, csrf, cookie: cookie(raw)};
    },
    async session(cookieHeader) {
      prune();
      const id = idFrom(cookieHeader), s = sessions.get(id);
      if (!s) throw new PanelError(401, 'session_expired', 'Entre na sua conta para continuar.');
      try {
        if (s.expires <= now() + 60000) {
          // Uma única renovação por sessão, mesmo com abas abertas ao mesmo tempo.
          s.refreshing ||= request('/token?grant_type=refresh_token', {method: 'POST', body: {refresh_token: s.refresh}})
            .then(data => {Object.assign(s, tokenSet(data));store.save();}).finally(() => {s.refreshing = null;});
          await s.refreshing;
        }
        const user = verified(await request('/user', {token: s.access}));
        if (user.id !== s.user.id || user.email !== s.user.email) throw invalid();
        if (!sessions.has(id)) throw invalid();
        s.user = user; s.lastSeen = now();
        store.save();
        return {id, user, csrf: s.csrf};
      } catch (error) {
        if (error.status === 401 || error.status === 403) {sessions.delete(id);store.save();}
        throw error;
      }
    },
    async logout(session) {
      store.assertReady?.();
      const s = sessions.get(session.id);
      sessions.delete(session.id);
      store.save();
      // Scope local não encerra sessões do usuário em outros sistemas.
      if (s) await request('/logout?scope=local', {method: 'POST', token: s.access}).catch(() => {});
      return cookie('', true);
    },
    clearCookie: () => cookie('', true)
  };
}
