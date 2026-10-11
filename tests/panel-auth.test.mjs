import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelServer, loadConfig} from '../panel-api/server.mjs';
import {roleFor} from '../panel-api/auth.mjs';
const owner = 'p.paulomaciel.32@gmail.com';
const publicKey = 'sb_publishable_test_only';
const env = {SITE_URL:'https://tomezap.com.br', SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:publicKey, PANEL_OWNER_EMAIL:owner, PANEL_EDITOR_EMAILS:'editor@example.com', PANEL_TRUST_PROXY:'true'};
const ownerUser = {id:'owner-id',email:owner,email_confirmed_at:'2026-10-11T00:00:00Z',is_anonymous:false};
async function fixture(t, {user = ownerUser, tokenSeconds = 3600, configured = true, fail, clock} = {}) {
  const calls = []; let liveUser = structuredClone(user), count = 0;
  const fetchImpl = async (url, options) => {
    calls.push({url, options});
    if (fail?.(url)) throw Error('secret-provider-error-must-not-leak');
    if (url.endsWith('/user')) return Response.json(liveUser);
    if (url.includes('/token?')) {
      if (url.includes('grant_type=password') && JSON.parse(options.body).password !== 'fixture-password') return Response.json({error:'private provider detail'}, {status:400});
      if (url.includes('grant_type=refresh_token')) await new Promise(resolve=>setTimeout(resolve,20));
      return Response.json({access_token:'private-access-'+(++count),refresh_token:'private-refresh-'+count,expires_in:tokenSeconds});
    }
    if (url.endsWith('/logout?scope=local')) return new Response(null,{status:204});
    throw Error('Unexpected upstream: ' + url);
  };
  const config = loadConfig(configured ? env : {...env,SUPABASE_PUBLISHABLE_KEY:''});
  const server = createPanelServer({config, fetchImpl, ...(clock ? {now:clock} : {})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, {method='GET',body,cookie,csrf,origin=config.siteUrl,secure=true,headers={}} = {}) {
    return fetch(base + path, {method, headers:{...(origin ? {Origin:origin} : {}), ...(secure ? {'X-Forwarded-Proto':'https'} : {}), ...(cookie ? {Cookie:cookie} : {}), ...(csrf ? {'X-CSRF-Token':csrf} : {}), ...(body ? {'Content-Type':'application/json'} : {}), ...headers}, ...(body ? {body:typeof body === 'string' ? body : JSON.stringify(body)} : {})});
  }
  async function login(email=owner) {
    const response = await request('/painel-api/login',{method:'POST',body:{email,password:'fixture-password'}});
    const data = await response.json();
    return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  return {request,login,calls,setUser:value=>{liveUser=value;}};
}
test('configuração rejeita service_role, host externo e origem insegura', () => {
  const secret = 'eyJ.fake.';
  assert.throws(()=>loadConfig({...env,SUPABASE_PUBLISHABLE_KEY:secret}),/somente chave pública/);
  const role = Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url');
  assert.throws(()=>loadConfig({...env,SUPABASE_PUBLISHABLE_KEY:`a.${role}.b`}),/somente chave pública/);
  assert.throws(()=>loadConfig({...env,SUPABASE_URL:'https://attacker.example'}));
  assert.throws(()=>loadConfig({...env,SITE_URL:'http://tomezap.com.br'}));
  assert.throws(()=>loadConfig({...env,SITE_URL:'https://user:pass@tomezap.com.br'}));
});
test('healthcheck informa configuração pendente sem expor chaves', async t => {
  const f=await fixture(t,{configured:false});
  const health=await f.request('/healthz',{origin:null,secure:false});
  assert.deepEqual(await health.json(),{ok:true,service:'tomezap-panel',authConfigured:false});
  const response=await f.request('/painel-api/session');
  assert.equal(response.status,503); assert.equal((await response.json()).code,'awaiting_connection'); assert.equal(f.calls.length,0);
});
test('rotas privadas recusam visitantes e cookies inventados',async t=>{
  const f=await fixture(t);
  for(const cookie of [undefined,'__Host-tnn_panel='+ 'A'.repeat(43)]){
    const response=await f.request('/painel-api/bootstrap',{cookie});
    assert.equal(response.status,401); assert.match(response.headers.get('cache-control'),/no-store/);
  }
  assert.equal(f.calls.length,0);
});
test('login do dono cria cookie protegido e não entrega tokens ao navegador', async t=>{
  const f=await fixture(t), result=await f.login();
  assert.equal(result.response.status,200); assert.equal(result.data.user.role,'owner');
  const cookie=result.response.headers.get('set-cookie');
  for(const flag of ['__Host-tnn_panel=','HttpOnly','Secure','SameSite=Strict','Path=/']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  assert.doesNotMatch(JSON.stringify(result.data)+cookie,/private-access|private-refresh|fixture-password/);
  const response=await f.request('/painel-api/bootstrap',{cookie:result.cookie});
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.modules.length,6);assert.ok(data.modules.every(m=>m.status==='awaiting_connection'));
  assert.ok(f.calls.filter(c=>c.url.endsWith('/user')).length>=2);
});
test('editores autorizados recebem papel de editor, nunca de dono', async t=>{
  const f=await fixture(t,{user:{...ownerUser,id:'editor-id',email:'editor@example.com',user_metadata:{role:'owner'}}});
  const result=await f.login('editor@example.com');assert.equal(result.response.status,200);assert.equal(result.data.user.role,'editor');
});
test('e-mail fora da lista não chega ao Supabase',async t=>{
  const f=await fixture(t), result=await f.login('intruso@example.com');
  assert.equal(result.response.status,401);assert.equal(f.calls.length,0);
});
test('senha incorreta recebe erro genérico sem detalhes do provedor',async t=>{
  const f=await fixture(t),response=await f.request('/painel-api/login',{method:'POST',body:{email:owner,password:'wrong'}});
  assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/provider|private/i);
});
test('e-mail não confirmado, usuário anônimo e identidade trocada são recusados',async t=>{
  for(const user of [{...ownerUser,email_confirmed_at:null},{...ownerUser,is_anonymous:true},{...ownerUser,email:'attacker@example.com',user_metadata:{email:owner,role:'owner'}}]){
    const f=await fixture(t,{user}), result=await f.login(); assert.equal(result.response.status,401);
    assert.ok(f.calls.some(c=>c.url.endsWith('/logout?scope=local')));
  }
  assert.equal(roleFor({...ownerUser,email:'other@example.com',user_metadata:{email:owner}},loadConfig(env)),null);
});
test('não contorna segundo fator já configurado na conta',async t=>{
  const f=await fixture(t,{user:{...ownerUser,factors:[{status:'verified'}]}}), result=await f.login();
  assert.equal(result.response.status,403);assert.equal(result.data.code,'mfa_required');
});
test('origem externa, origem ausente e HTTP em produção são bloqueados',async t=>{
  const f=await fixture(t);
  for(const options of [{origin:'https://chat.tomezap.com.br'},{origin:'https://evil.example'},{origin:null},{secure:false}]){
    const r=await f.request('/painel-api/login',{method:'POST',body:{email:owner,password:'fixture-password'},...options});assert.equal(r.status,403);
    assert.notEqual(r.headers.get('access-control-allow-origin'),'*');
  }
  assert.equal(f.calls.length,0);
});
test('preflight permite apenas a origem exata e os métodos esperados',async t=>{
  const f=await fixture(t),r=await f.request('/painel-api/login',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}});
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),env.SITE_URL);
  const bad=await f.request('/painel-api/login',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'DELETE'}});assert.equal(bad.status,403);
});
test('corpo malformado e formulário grande são recusados',async t=>{
  const f=await fixture(t);
  const malformed=await f.request('/painel-api/login',{method:'POST',body:'{bad'});assert.equal(malformed.status,400);
  const big=await f.request('/painel-api/login',{method:'POST',body:'a'.repeat(9000)});assert.equal(big.status,413);
  const type=await f.request('/painel-api/login',{method:'POST',body:'text',headers:{'Content-Type':'text/plain'}});assert.equal(type.status,415);
});
test('limite de tentativas não pode ser driblado com X-Forwarded-For',async t=>{
  const f=await fixture(t);
  for(let i=0;i<11;i++){
    const response=await f.request('/painel-api/login',{method:'POST',body:{email:owner,password:'wrong'},headers:{'X-Forwarded-For':`1.1.1.${i}`}});
    assert.equal(response.status,i===10?429:401);
  }
  assert.equal(f.calls.length,10);
});
test('renovação simultânea usa o refresh token uma única vez',async t=>{
  const f=await fixture(t,{tokenSeconds:30}),result=await f.login();
  const responses=await Promise.all([f.request('/painel-api/session',{cookie:result.cookie}),f.request('/painel-api/session',{cookie:result.cookie})]);
  assert.ok(responses.every(r=>r.status===200));
  assert.equal(f.calls.filter(c=>c.url.includes('grant_type=refresh_token')).length,1);
});
test('sessão expira após 30 minutos sem uso',async t=>{
  let time=Date.now();const f=await fixture(t,{clock:()=>time}),result=await f.login();
  time+=31*60000;const response=await f.request('/painel-api/bootstrap',{cookie:result.cookie});assert.equal(response.status,401);
});
test('identidade revalidada bloqueia conta que perdeu confirmação',async t=>{
  const f=await fixture(t),result=await f.login();f.setUser({...ownerUser,email_confirmed_at:null});
  const response=await f.request('/painel-api/bootstrap',{cookie:result.cookie});assert.equal(response.status,401);
});
test('logout exige CSRF e revoga só a sessão local do painel',async t=>{
  const f=await fixture(t),result=await f.login();
  const denied=await f.request('/painel-api/logout',{method:'POST',cookie:result.cookie});assert.equal(denied.status,403);
  const ok=await f.request('/painel-api/logout',{method:'POST',cookie:result.cookie,csrf:result.data.csrf});assert.equal(ok.status,204);
  assert.match(ok.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.request('/painel-api/bootstrap',{cookie:result.cookie})).status,401);
  assert.ok(f.calls.some(c=>c.url.endsWith('/logout?scope=local')));
  assert.ok(f.calls.every(c=>!c.url.includes('scope=global')));
});
test('falha de rede não mostra segredos nem libera o painel',async t=>{
  const f=await fixture(t,{fail:()=>true}),result=await f.login();
  assert.equal(result.response.status,503);assert.doesNotMatch(JSON.stringify(result.data),/secret|private|token/);
});
