import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.mjs';
import { sealSession, openSession, sanitize, RateLimiter } from '../src/security.mjs';

const r='00000000-0000-4000-8000-000000000001',p='00000000-0000-4000-8000-000000000002';
const origin='https://radar.example';
const secret='sk-ant-ficticia-abcdefghijklmnopqrstuv';
const rawSession={access_token:'access-ficticio-apenas-no-servidor',refresh_token:'refresh-ficticio-apenas-no-servidor',expires_at:Math.floor(Date.now()/1000)+3600};
const context={id:p,nome:'Pessoa de teste',redacoes:[{id:r,nome:'Redação de teste',papel:'editor_chefe'}]};
async function fixture(overrides={}) {
 const calls=[],logs=[];
 const provider={login:async()=>rawSession,refresh:async()=>rawSession,logout:async()=>{},rpc:async(token,name,args)=>{calls.push({token,name,args});return ['tn_contexto','tn_ativar_acesso'].includes(name)?context:[]},...overrides};
 const key=randomBytes(32);
 const app=await buildApp({provider,origin,sessionKey:key,secrets:[secret],audit:x=>logs.push(x)});
 const login=()=>app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'pessoa@teste.invalid',password:'senha-ficticia-para-teste'}});
 const cookie=reply=>reply.headers['set-cookie'].split(';')[0];
 return {app,key,calls,logs,login,cookie};
}
test('cookie é cifrado, expira e rejeita adulteração',()=>{
 const key=randomBytes(32),v={...rawSession,deadline:Date.now()+50000},token=sealSession(v,key);
 assert.deepEqual(openSession(token,key),v);assert.equal(token.includes(rawSession.access_token),false);
 const data=Buffer.from(token,'base64url');data[20]^=1;assert.equal(openSession(data.toString('base64url'),key),null);
 assert.equal(openSession(token,randomBytes(32)),null);assert.equal(openSession(sealSession({...v,deadline:1},key),key),null);
});
test('remoção recursiva de credenciais conserva conteúdo editorial',()=>{
 assert.deepEqual(sanitize({title:'Pecém',api_key:secret,nested:{senha:'teste',evidencia:`Antes ${secret} depois`},items:[{checked:true,token:'teste'}]},[secret]),{title:'Pecém',nested:{evidencia:'Antes [CREDENCIAL REMOVIDA] depois'},items:[{checked:true}]});
});
test('rate limit tem janela e recuperação',()=>{
 const limit=new RateLimiter();assert.equal(limit.take('user',1,100,0),true);assert.equal(limit.take('user',1,100,50),false);assert.equal(limit.take('user',1,100,101),true);
});
test('saúde e interface podem abrir; fila exige sessão',async t=>{
 const f=await fixture();t.after(()=>f.app.close());
 assert.equal((await f.app.inject('/api/v1/health')).statusCode,200);
 const page=await f.app.inject('/');assert.equal(page.statusCode,200);assert.match(page.body,/Radar Tome Nota/);
 const res=await f.app.inject({url:'/api/v1/pautas',headers:{'x-redacao-id':r}});assert.equal(res.statusCode,401);assert.equal(f.calls.length,0);
});
test('login devolve somente contexto e cookie Secure/HttpOnly; sem senha ou tokens em resposta e logs',async t=>{
 const f=await fixture();t.after(()=>f.app.close());const res=await f.login();
 assert.equal(res.statusCode,200);assert.deepEqual(res.json(),{usuario:context});assert.match(res.headers['set-cookie'],/HttpOnly/);assert.match(res.headers['set-cookie'],/Secure/);assert.match(res.headers['set-cookie'],/SameSite=Strict/);
 const all=JSON.stringify([res.headers,res.body,f.logs]);for(const s of [rawSession.access_token,rawSession.refresh_token,'senha-ficticia-para-teste',secret])assert.equal(all.includes(s),false);
});
test('erro de login não revela credencial nem distingue conta existente',async t=>{
 const f=await fixture({login:async()=>{throw Error(secret)}});t.after(()=>f.app.close());const res=await f.login();assert.equal(res.statusCode,401);assert.equal(res.body.includes(secret),false);
});
test('conta autenticada sem associação não recebe cookie',async t=>{
 const f=await fixture({rpc:async()=>{throw Object.assign(Error('Conta sem acesso à redação.'),{code:'42501'})}});t.after(()=>f.app.close());const res=await f.login();assert.equal(res.statusCode,403);assert.equal(res.headers['set-cookie'],undefined);
});
test('mutações rejeitam origem ausente ou de outro site',async t=>{
 const f=await fixture();t.after(()=>f.app.close());for(const headers of [{},{origin:'https://outro.example'}]){const res=await f.app.inject({method:'POST',url:'/api/v1/auth/login',headers,payload:{email:'pessoa@teste.invalid',password:'teste'}});assert.equal(res.statusCode,403)}
});
test('pauta e revisão chegam à RPC com JWT do usuário; papel vindo do formulário não é usado',async t=>{
 const f=await fixture();t.after(()=>f.app.close());const login=await f.login();
 const res=await f.app.inject({method:'PATCH',url:`/api/v1/pautas/${p}/conteudo`,headers:{origin,cookie:f.cookie(login),'x-redacao-id':r},payload:{dados:{titulo:'Título de teste'},nota:'Corrigir título',revisao_esperada:7,papel:'editor_chefe'}});
 assert.equal(res.statusCode,200);const call=f.calls.at(-1);assert.equal(call.token,rawSession.access_token);assert.deepEqual(call.args,{redacao_id:r,pauta_id:p,acao:'editar',revisao_esperada:7,dados:{titulo:'Título de teste'},nota:'Corrigir título'});
});
test('modo Gestão usa a redação da sessão e registra justificativa',async t=>{
 const f=await fixture();t.after(()=>f.app.close());const login=await f.login(),headers={origin,cookie:f.cookie(login),'x-redacao-id':r};
 const list=await f.app.inject({url:'/api/v1/gestao',headers});assert.equal(list.statusCode,200);assert.equal(f.calls.at(-1).name,'tn_painel_gestao');
 const created=await f.app.inject({method:'POST',url:'/api/v1/gestao/tarefas',headers,payload:{dados:{titulo:'Preparar briefing',categoria:'Prioridade'},nota:'Organizar a operação de hoje'}});assert.equal(created.statusCode,200);assert.deepEqual(f.calls.at(-1).args,{redacao_id:r,tarefa_id:null,acao:'criar',dados:{titulo:'Preparar briefing',categoria:'Prioridade'},nota:'Organizar a operação de hoje'});
 const changed=await f.app.inject({method:'POST',url:`/api/v1/gestao/tarefas/${p}/concluir`,headers,payload:{nota:'Entrega revisada e concluída'}});assert.equal(changed.statusCode,200);assert.equal(f.calls.at(-1).args.acao,'concluir');
});
test('API mantém recusa de aprovação pelo banco e conflito de versão',async t=>{
 const f=await fixture({rpc:async(token,name,args)=>{if(['tn_contexto','tn_ativar_acesso'].includes(name))return context;throw Object.assign(Error('Acesso não autorizado para esta ação.'),{code:args.acao==='aprovar'?'42501':'40001'})}});t.after(()=>f.app.close());const login=await f.login();
 for(const [acao,status]of[['aprovar',403],['notas',409]]){const res=await f.app.inject({method:'POST',url:`/api/v1/pautas/${p}/${acao}`,headers:{origin,cookie:f.cookie(login),'x-redacao-id':r},payload:{nota:'Tentativa de teste',revisao_esperada:1}});assert.equal(res.statusCode,status)}
});
test('export e logs removem segredo mesmo se provedor devolver conteúdo indevido',async t=>{
 const f=await fixture({rpc:async(token,name)=>['tn_contexto','tn_ativar_acesso'].includes(name)?context:{pautas:[{titulo:`Teste ${secret}`,apiKey:secret}],password:secret}});t.after(()=>f.app.close());const login=await f.login();
 const res=await f.app.inject({url:'/api/v1/exportacoes',headers:{cookie:f.cookie(login),'x-redacao-id':r}});assert.equal(res.statusCode,200);assert.equal(JSON.stringify([res.json(),f.logs]).includes(secret),false);assert.equal(res.json().password,undefined);
});
test('import remove segredo antes da chamada ao banco',async t=>{
 const f=await fixture();t.after(()=>f.app.close());const login=await f.login();
 const res=await f.app.inject({method:'POST',url:'/api/v1/importacoes/validar',headers:{origin,cookie:f.cookie(login),'x-redacao-id':r},payload:{format:'tome-nota-local-v1',apiKey:secret,items:[],memories:[],events:[]}});
 assert.equal(res.statusCode,200);assert.equal(JSON.stringify(f.calls.at(-1).args).includes(secret),false);
});
test('logout revoga sessão no provedor antes de apagar cookie',async t=>{
 let revoked=false;const f=await fixture({logout:async token=>{assert.equal(token,rawSession.access_token);revoked=true}});t.after(()=>f.app.close());const login=await f.login();
 const res=await f.app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{origin,cookie:f.cookie(login)}});assert.equal(res.statusCode,200);assert.equal(revoked,true);assert.match(res.headers['set-cookie'],/Max-Age=0/);
});
test('falha ao revogar sessão não é apresentada como logout concluído',async t=>{
 const f=await fixture({logout:async()=>{throw Error(secret)}});t.after(()=>f.app.close());const login=await f.login();const res=await f.app.inject({method:'POST',url:'/api/v1/auth/logout',headers:{origin,cookie:f.cookie(login)}});assert.equal(res.statusCode,503);assert.equal(res.body.includes(secret),false);
});
test('renova acesso perto do vencimento sem expor tokens',async t=>{
 let count=0;const f=await fixture({login:async()=>({...rawSession,expires_at:1}),refresh:async()=>{count++;return rawSession}});t.after(()=>f.app.close());const login=await f.login();const res=await f.app.inject({url:'/api/v1/auth/me',headers:{cookie:f.cookie(login)}});assert.equal(res.statusCode,200);assert.equal(count,1);assert.equal(res.body.includes(rawSession.access_token),false);assert.ok(res.headers['set-cookie']);
});
test('tentativas de login são limitadas no servidor',async t=>{
 const f=await fixture({login:async()=>{throw Error('Falha fictícia')}});t.after(()=>f.app.close());for(let i=0;i<8;i++)assert.equal((await f.login()).statusCode,401);assert.equal((await f.login()).statusCode,429);
});
