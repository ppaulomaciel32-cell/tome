import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../src/app.mjs';
import {suggestHeadlines} from '../src/headlines.mjs';
const r='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',origin='https://radar.example';
for(const [label,role,checked,status] of [['leitor bloqueado','leitor',true,403],['evidência não conferida bloqueada','redator',false,422],['redator com conferência gera e audita','redator',true,200]])test(label,async t=>{
 let calls=0;const events=[];
 const item={pauta:{id,versao:1,revisao_registro:1,evidencia:'Texto lido',hash_evidencia:'abc'},conferencia_evidencia:checked?{versao:1,hash_verificado:'abc'}:null};
 const provider={login:async()=>({access_token:'fake',refresh_token:'fake-refresh',expires_at:Date.now()/1000+3600}),rpc:async(token,name,args)=>{
 if(['tn_contexto','tn_ativar_acesso'].includes(name))return {id,redacoes:[{id:r,papel:role}]};
 if(name==='tn_consultar')return args.recurso==='memorias'?[]:item;
 if(name==='tn_listar_pautas')return [];
 if(name==='tn_comando'){events.push(args);return {pauta:{...item.pauta,revisao_registro:events.length+1}};}
 }};
 const app=await buildApp({provider,origin,sessionKey:randomBytes(32),headlineGenerator:async()=>{calls++;return {sugestoes:[{titulo:'Exemplo',justificativa:'Clareza'}]}}});t.after(()=>app.close());
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'a@b.com',password:'fake'}});
 const res=await app.inject({method:'POST',url:'/api/v1/headlines/'+id,headers:{origin,cookie:login.headers['set-cookie'].split(';')[0],'x-redacao-id':r},payload:{nota:'Avaliar clareza',revisao_esperada:1}});
 assert.equal(res.statusCode,status);assert.equal(calls,status===200?1:0);assert.equal(events.length,status===200?2:0);assert.ok(events.every(e=>e.acao==='nota'));
});
test('cliente valida JSON e não expõe segredo; custo desconhecido',async()=>{
 const item={pauta:{versao:1,evidencia:'Texto lido',hash_evidencia:'abc'},conferencia_evidencia:{versao:1,hash_verificado:'abc'}};
 const env={OMNIROUTE_API_KEY:'segredo-ficticio',OMNIROUTE_BASE_URL:'https://api.example/v1',OMNIROUTE_MODEL:'teste'};
 const result=await suggestHeadlines(item,env,async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer segredo-ficticio');return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({sugestoes:Array.from({length:3},()=>({titulo:'Título',justificativa:'Clareza'}))})}}],usage:{total_tokens:5}})}});
 assert.equal(result.custo_usd,null);assert.equal(JSON.stringify(result).includes('segredo-ficticio'),false);
});
