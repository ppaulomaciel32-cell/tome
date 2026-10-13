// Um único processo usa este cofre. SQLite garante gravações atômicas;
// AES-GCM protege cada registro, inclusive credenciais e chaves do WhatsApp.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes, createCipheriv, createDecipheriv, createHash} from 'node:crypto';

export function openVault({directory, key, codec = JSON}) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) throw Error('WA_SESSION_KEY precisa conter 64 caracteres hexadecimais.');
  mkdirSync(directory, {recursive:true, mode:0o700}); chmodSync(directory, 0o700);
  const file = join(directory, 'session.sqlite');
  const db = new DatabaseSync(file); chmodSync(file, 0o600);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, value BLOB NOT NULL); CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);');
  const secret = Buffer.from(key, 'hex');
  const rowId = id=>createHash('sha256').update(id).digest('hex');
  const getRow = db.prepare('SELECT value FROM vault WHERE id = ?');
  const putRow = db.prepare('INSERT INTO vault(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
  const removeRow = db.prepare('DELETE FROM vault WHERE id = ?');
  function get(id, fallback = null) {
    const row = getRow.get(rowId(id)); if (!row) return fallback;
    const bytes = Buffer.from(row.value);
    try {
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0,12));
      decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(bytes.subarray(12,28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), codec.reviver);
    } catch {throw Error('Não foi possível abrir a sessão salva. Confira a chave do cofre; não apague o volume.');}
  }
  function put(id, value) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, nonce);
    cipher.setAAD(Buffer.from(id));
    const body = Buffer.concat([cipher.update(JSON.stringify(value, codec.replacer)), cipher.final()]);
    putRow.run(rowId(id), Buffer.concat([nonce, cipher.getAuthTag(), body]));
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result = fn(); db.exec('COMMIT'); return result;}
    catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  return {
    get, put, transaction, remove:id=>removeRow.run(rowId(id)),
    claimAndPut(id,now,key,value,ttl=86400000){
      return transaction(()=>{
        db.prepare('DELETE FROM receipts WHERE expires <= ?').run(now);
        const inserted=db.prepare('INSERT OR IGNORE INTO receipts(id,expires) VALUES (?,?)').run(id,now+ttl).changes===1;
        if(inserted)put(key,value);return inserted;
      });
    },
    claim(id, now, ttl = 86400000) {
      return transaction(()=>{
        db.prepare('DELETE FROM receipts WHERE expires <= ?').run(now);
        return db.prepare('INSERT OR IGNORE INTO receipts(id,expires) VALUES (?,?)').run(id, now+ttl).changes === 1;
      });
    },
    auth(initCredentials, reviveAppState = value=>value) {
      const creds = get('auth:creds') || initCredentials(); put('auth:creds', creds);
      return {
        state:{creds, keys:{
          async get(type, ids) {
            const result = Object.create(null);
            for (const id of ids) {let value = get('key:'+JSON.stringify([type,id])); if (value && type === 'app-state-sync-key') value = reviveAppState(value); result[id] = value;}
            return result;
          },
          async set(data) {transaction(()=>{for (const [type, entries] of Object.entries(data)) for (const [id,value] of Object.entries(entries)) {
            const key = 'key:'+JSON.stringify([type,id]); if (value == null) removeRow.run(rowId(key)); else put(key,value);
          }});}
        }},
        saveCreds(update) {Object.assign(creds, update); put('auth:creds',creds);}
      };
    },
    close() {db.close(); secret.fill(0);}
  };
}
