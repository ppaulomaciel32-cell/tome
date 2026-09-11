import { buildApp } from './app.mjs';
import { supabaseProvider } from './supabase.mjs';

const appOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;
const required = ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SESSION_ENCRYPTION_KEY'];
if (!appOrigin || required.some(name => !process.env[name])) {
  process.stderr.write('Configuração incompleta. Preencha as variáveis indicadas em .env.example.\n'); process.exit(1);
}
const origin = new URL(appOrigin).origin;
const secure = origin.startsWith('https://');
if (!secure && !['localhost','127.0.0.1'].includes(new URL(origin).hostname)) {
  process.stderr.write('HTTPS é obrigatório fora do computador local.\n'); process.exit(1);
}
try {
  const app = await buildApp({ provider: supabaseProvider({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY }),
    origin, secure, sessionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'base64'),
    secrets: [process.env.GEMINI_API_KEY, process.env.SESSION_ENCRYPTION_KEY],
    audit: event => process.stdout.write(JSON.stringify(event) + '\n'),
  });
  await app.listen({ port: Number(process.env.PORT || 3000), host: secure ? '0.0.0.0' : '127.0.0.1' });
  process.stdout.write('Radar Tome Nota: servidor iniciado.\n');
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
} catch { process.stderr.write('Falha ao iniciar o servidor. Verifique a configuração.\n'); process.exit(1); }
