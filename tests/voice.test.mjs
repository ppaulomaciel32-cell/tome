import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {buildApp} from '../src/app.mjs';

const room='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',origin='https://radar.example';
test('comando de voz exige sessão, registra auditoria e não aceita intenção de aprovação',async t=>{
 const calls=[],context={id:user,redacoes:[{id:room,papel:'redator'}]};
 const provider={login:async()=>({access_token:'fake',refresh_token:'fake-refresh',expires_at:Date.now()/1000+3600}),rpc:async(token,name,args)=>{calls.push({name,args});if(['tn_contexto','tn_ativar_acesso'].includes(name))return context;if(name==='tn_registrar_comando_voz')return {id:'log'};return [];}};
 const voiceInterpreter=async()=>({transcricao:'aprove esta pauta',intencao:'desconhecido',argumentos:{},modelo:'gemini-teste',usage:{total_tokens:3}});
 const app=await buildApp({provider,origin,sessionKey:randomBytes(32),voiceInterpreter});t.after(()=>app.close());
 assert.equal((await app.inject({method:'POST',url:'/api/v1/voice/command',headers:{origin,'x-redacao-id':room},payload:{audio_base64:'YWJjZA==',mime_type:'audio/webm'}})).statusCode,401);
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{email:'a@b.com',password:'fake'}});
 const response=await app.inject({method:'POST',url:'/api/v1/voice/command',headers:{origin,cookie:login.headers['set-cookie'].split(';')[0],'x-redacao-id':room},payload:{audio_base64:'YWJjZA==',mime_type:'audio/webm'}});
 assert.equal(response.statusCode,200);assert.equal(response.json().intencao,'desconhecido');assert.equal(calls.at(-1).name,'tn_registrar_comando_voz');assert.equal(calls.at(-1).args.intencao,'desconhecido');
});
