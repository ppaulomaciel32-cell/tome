import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiClient} from '../src/gemini-client.mjs';

test('Gemini usa chave somente no cabeçalho e telemetria nunca contém segredo',async()=>{
 const logs=[];let time=0;
 const request=async(url,options)=>{assert.match(url,/generativelanguage\.googleapis\.com/);assert.equal(options.headers['x-goog-api-key'],'segredo-de-teste');assert.equal(options.body.includes('segredo-de-teste'),false);return {ok:true,status:200,json:async()=>({modelVersion:'gemini-real',candidates:[{content:{parts:[{text:'{"ok":true}'}]}}],usageMetadata:{promptTokenCount:2,candidatesTokenCount:1,totalTokenCount:3}})}};
 const client=createGeminiClient({apiKey:'segredo-de-teste',model:'gemini-teste',embeddingModel:'vetor-teste',request,clock:()=>++time,onTelemetry:x=>logs.push(x)});
 const result=await client.generateJson({system:'sistema',prompt:'teste',schema:{type:'object',properties:{ok:{type:'boolean'}}}});
 assert.deepEqual(result.output,{ok:true});assert.equal(logs[0].provider,'google-gemini');assert.equal(JSON.stringify(logs).includes('segredo-de-teste'),false);
});

test('Gemini retorna vetores na mesma ordem dos textos',async()=>{
 const request=async()=>({ok:true,status:200,json:async()=>({embeddings:[{values:[1,0]},{values:[0,1]}]})});
 const client=createGeminiClient({apiKey:'segredo-de-teste',model:'gemini-teste',embeddingModel:'vetor-teste',request});
 assert.deepEqual((await client.embeddings(['um','dois'])).vectors,[[1,0],[0,1]]);
});
