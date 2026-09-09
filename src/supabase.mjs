import { createClient } from '@supabase/supabase-js';

export function supabaseProvider({ url, key }) {
  const client = token => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  });
  const unwrap = ({ data, error }) => { if (error) throw Object.assign(new Error('Falha no serviço de autenticação.'), { code: error.code, status: error.status }); return data; };
  return {
    async login(email, password) { return unwrap(await client().auth.signInWithPassword({ email, password })).session; },
    async refresh(refresh_token) { return unwrap(await client().auth.refreshSession({ refresh_token })).session; },
    async logout(token) { unwrap(await client().auth.admin.signOut(token, 'local')); },
    async rpc(token, name, args = {}) {
      const { data, error } = await client(token).rpc(name, args);
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      return data;
    },
  };
}
