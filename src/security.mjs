import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

export function sealSession(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('radar-session-v1'));
  return Buffer.concat([iv,
    cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function openSession(token, key) {
  try {
    const data = Buffer.from(token || '', 'base64url');
    if (data.length < 29 || data.length > 8192) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from('radar-session-v1'));
    decipher.setAuthTag(data.subarray(-16));
    const value = JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString());
    if (!value.access_token || !value.refresh_token || !Number.isFinite(value.deadline) || value.deadline <= Date.now()) return null;
    return value;
  } catch { return null; }
}
const secretKey = /apikey|authorization|password|senha|secret|credential|accesstoken|refreshtoken|servicerole|anthropickey|openai.?key/;
export function sanitize(value, secrets = [], depth = 0) {
  if (depth > 40) throw Object.assign(new Error('JSON excede a profundidade permitida.'), { statusCode: 400 });
  if (typeof value === 'string') {
    let text = value.replace(/sk-(?:ant-|proj-)?[a-zA-Z0-9_-]{12,}|sb_secret_[a-zA-Z0-9_-]+|Bearer\s+[a-zA-Z0-9._-]+|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/gi, '[CREDENCIAL REMOVIDA]');
    for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 8)) text = text.split(secret).join('[CREDENCIAL REMOVIDA]');
    return text;
  }
  if (Array.isArray(value)) return value.map(v => sanitize(v, secrets, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !secretKey.test(k.toLowerCase().replace(/[^a-z0-9]/g, '')) && !['key','token','cookie','cookies','__proto__','constructor','prototype'].includes(k.toLowerCase()))
    .map(([k,v]) => [k, sanitize(v, secrets, depth + 1)]));
  return value;
}
export class RateLimiter {
  #entries = new Map();
  take(key, max, duration, now = Date.now()) {
    if (this.#entries.size > 10000) for (const [k, v] of this.#entries) if (v.until <= now) this.#entries.delete(k);
    const hash = createHash('sha256').update(key).digest('hex');
    let entry = this.#entries.get(hash);
    if (!entry || entry.until <= now) {
      if (this.#entries.size >= 20000) return false;
      entry = { count: 0, until: now + duration }; this.#entries.set(hash, entry);
    }
    return ++entry.count <= max;
  }
}
