import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,renameSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createAuth} from '../panel-api/auth.mjs';
const user={id:'fixture-owner',email:'owner@example.com',email_confirmed_at:'2026-10-13T00:00:00Z'};
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'tnn-panel-session-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const config={sessionDir:directory,production:true,supabaseUrl:'https://fixture.supabase.co',publicKey:'sb_publishable_fixture',owner:user.email,editors:[]};
  let time=Date.now(),liveUser=user,refreshes=0;const refreshInputs=[];
  const fetchImpl=async(url,options)=>{
    if(url.endsWith('/user'))return Response.json(liveUser);
    if(url.includes('refresh_token')){refreshInputs.push(JSON.parse(options.body).refresh_token);refreshes++;await new Promise(r=>setTimeout(r,5));return Response.json({access_token:'private-access-'+refreshes,refresh_token:'private-refresh-'+refreshes,expires_in:3600});}
    if(url.includes('/token?'))return Response.json({access_token:'private-access-0',refresh_token:'private-refresh-0',expires_in:3600});
    return new Response(null,{status:204});
  };
  return {directory,config,open:()=>createAuth(config,{fetchImpl,now:()=>time}),advance:ms=>time+=ms,setUser:u=>liveUser=u,refreshInputs,get refreshes(){return refreshes;}};
}
test('sessão: outro processo recupera login e CSRF, sem tokens em texto no volume',async t=>{
  const f=fixture(t),a=f.open(),login=await a.login(user.email,'fixture-password');
  const cookie=login.cookie.split(';')[0];
  const moduleURL=new URL('../panel-api/auth.mjs',import.meta.url).href;
  const code=`import {createAuth} from ${JSON.stringify(moduleURL)}; const config=${JSON.stringify(f.config)};
    const auth=createAuth(config,{fetchImpl:async()=>Response.json(${JSON.stringify(user)})});
    const s=await auth.session(${JSON.stringify(cookie)});console.log(JSON.stringify({user:s.user,csrf:s.csrf}));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
  assert.equal(result.user.role,'owner');assert.equal(result.csrf,login.csrf);
  const data=readFileSync(join(f.directory,'sessions.enc'));
  for(const secret of ['private-access','private-refresh','fixture-password',user.email,login.csrf,cookie.split('=')[1]])assert.equal(data.includes(Buffer.from(secret)),false);
  assert.equal(statSync(join(f.directory,'key')).mode&0o777,0o600);
  assert.equal(statSync(join(f.directory,'sessions.enc')).mode&0o777,0o600);
});
test('sessão: renovação única persiste token novo; logout continua revogado após recriar',async t=>{
  const f=fixture(t);let a=f.open();const login=await a.login(user.email,'password'),cookie=login.cookie.split(';')[0];
  // Mantém atividade antes de vencer o access token.
  for(let i=0;i<3;i++){f.advance(19*60000);await a.session(cookie);}
  f.advance(3*60000);a=f.open();await Promise.all([a.session(cookie),a.session(cookie)]);assert.equal(f.refreshes,1);
  a=f.open();for(let i=0;i<3;i++){f.advance(19*60000);await a.session(cookie);}
  f.advance(3*60000);a=f.open();const s=await a.session(cookie);
  assert.deepEqual(f.refreshInputs,['private-refresh-0','private-refresh-1']);
  await a.logout(s);a=f.open();await assert.rejects(a.session(cookie),e=>e.code==='session_expired');
});
test('sessão: reinício não zera prazo ocioso nem limite absoluto de oito horas',async t=>{
  const f=fixture(t);let a=f.open(),login=await a.login(user.email,'password'),cookie=login.cookie.split(';')[0];
  f.advance(31*60000);a=f.open();await assert.rejects(a.session(cookie),e=>e.code==='session_expired');
  login=await a.login(user.email,'password');cookie=login.cookie.split(';')[0];
  for(let i=0;i<25;i++){f.advance(19*60000);a=f.open();await a.session(cookie);}
  f.advance(6*60000);a=f.open();await assert.rejects(a.session(cookie),e=>e.code==='session_expired');
});
test('sessão: identidade é revalidada depois de reiniciar e conta revogada continua bloqueada',async t=>{
  const f=fixture(t);let a=f.open();const login=await a.login(user.email,'password'),cookie=login.cookie.split(';')[0];
  f.setUser({...user,email_confirmed_at:null});a=f.open();await assert.rejects(a.session(cookie),e=>e.code==='invalid_login');
  f.setUser(user);a=f.open();await assert.rejects(a.session(cookie),e=>e.code==='session_expired');
});
test('sessão: arquivo adulterado ou chave perdida bloqueia acesso sem apagar evidência',async t=>{
  const f=fixture(t);await f.open().login(user.email,'password');const path=join(f.directory,'sessions.enc');
  const data=readFileSync(path);data[data.length-1]^=1;writeFileSync(path,data);
  assert.throws(()=>f.open(),e=>e.code==='session_storage_unavailable');assert.deepEqual(readFileSync(path),data);
  rmSync(join(f.directory,'key'));assert.throws(()=>f.open(),e=>e.code==='session_storage_unavailable');
  assert.deepEqual(readFileSync(path),data);
});
test('sessão: falha na gravação não permite continuar usando memória como se persistisse',async t=>{
  const f=fixture(t),a=f.open();const login=await a.login(user.email,'password'),cookie=login.cookie.split(';')[0];
  renameSync(join(f.directory,'sessions.enc'),join(f.directory,'original.enc'));
  mkdirSync(join(f.directory,'sessions.enc'));
  await assert.rejects(a.session(cookie),e=>e.code==='session_storage_unavailable');
  await assert.rejects(a.session(cookie),e=>e.code==='session_storage_unavailable');
});
