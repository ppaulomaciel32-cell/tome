// Teste técnico: não lê pautas, não publica e nunca imprime credenciais.
import { pathToFileURL } from 'node:url';
export async function testOmniRoute(env = process.env, request = fetch) {
  const missing = ['OMNIROUTE_BASE_URL','OMNIROUTE_API_KEY','OMNIROUTE_MODEL'].filter(k => !env[k]?.trim());
  if (missing.length) return { ok: false, etapa: 'configuracao', faltando: missing };
  let base;
  try { base = new URL(env.OMNIROUTE_BASE_URL); } catch { return {ok:false, etapa:'url_invalida'}; }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return {ok:false, etapa:'url_invalida'};
  const root = base.href.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${env.OMNIROUTE_API_KEY}`, 'Content-Type': 'application/json' };
  const result = {ok:false};
  for (const stage of ['modelos','geracao']) {
    result.etapa = stage;
    try {
      const response = await request(root + (stage === 'modelos' ? '/models' : '/chat/completions'), {
        method: stage === 'modelos' ? 'GET' : 'POST', headers, redirect:'error', signal:AbortSignal.timeout(30000),
        ...(stage === 'geracao' ? {body:JSON.stringify({model:env.OMNIROUTE_MODEL, max_tokens:64, stream:false,
          response_format:{type:'json_object'}, messages:[{role:'user',content:'Teste técnico de conexão. Responda apenas o JSON {"ok":true}. Não gere notícia.'}]})} : {})
      });
      result[stage + '_http'] = response.status;
      if (!response.ok) return {...result, tentar_novamente:response.status === 429 || response.status >= 500};
      const data = await response.json();
      if (stage === 'modelos') {
        if (!Array.isArray(data.data)) return {...result, erro:'catalogo_invalido'};
        result.quantidade_modelos = data.data.length;
      } else {
        const answer = JSON.parse(data.choices?.[0]?.message?.content);
        if (answer?.ok !== true) return {...result, erro:'json_inesperado'};
        result.json_valido = true;
        result.usage = Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens']
          .filter(k=>Number.isSafeInteger(data.usage?.[k]) && data.usage[k]>=0).map(k=>[k,data.usage[k]]));
        result.custo_usd = null; // Tokens não comprovam custo monetário.
      }
    } catch { return {...result, erro:'falha_de_rede_ou_resposta_invalida'}; }
  }
  return {...result,ok:true};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await testOmniRoute();
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode = result.ok ? 0 : 1;
}
