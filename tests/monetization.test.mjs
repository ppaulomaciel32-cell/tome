import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs/promises';
import {createAnalytics} from '../panel-api/analytics.mjs';
const script=await fs.readFile(new URL('../public-site/assets/js/analytics.js',import.meta.url),'utf8');
test('GA4: nenhum script/evento antes de consentir; carregamento único e URL sem dados privados',()=>{
 const scripts=[],events={};let choice='essential';const window={TNN_CONFIG:{ga4Id:'G-ABC1234567'},TNNConsent:{get:()=>choice},addEventListener:(k,f)=>events[k]=f};
 const document={title:'Matéria',referrer:'https://instagram.com/link?private=email',documentElement:{dataset:{localidade:'pecem'}},head:{append:s=>scripts.push(s)},createElement:()=>({})};
 vm.runInNewContext(script,{window,document,location:{href:'https://tomezap.com.br/noticia/teste/?q=email@example.com&utm_source=whatsapp#privado',pathname:'/noticia/teste/'},URL});
 assert.equal(scripts.length,0);assert.equal(window.dataLayer,undefined);choice='all';events['tnn:consent']();events['tnn:consent']();assert.equal(scripts.length,1);
 const data=JSON.stringify(window.dataLayer);assert.doesNotMatch(data,/email@example|#privado|private=email/);assert.match(data,/utm_source=whatsapp/);assert.match(data,/pecem/);
});
test('GA4: ID vazio e área admin não medem mesmo com consentimento',()=>{
 for(const [id,path] of [['','/'],['G-ABC1234567','/admin/']]){
  const w={TNN_CONFIG:{ga4Id:id},TNNConsent:{get:()=>'all'},addEventListener(){}};
  vm.runInNewContext(script,{window:w,location:{pathname:path}});assert.equal(w.dataLayer,undefined);
 }
});
test('resumo GA4: falta de credencial não chama APIs nem inventa números',async()=>{
 const read=createAnalytics({}, {env:{},fetchImpl:()=>{throw Error('should not call');}});assert.deepEqual(await read(),{configured:false});
});
test('posições e CSP: GA4/Cloudinary, consentimento e IDs configuráveis no build',async()=>{
 const read=p=>fs.readFile(new URL('../'+p,import.meta.url),'utf8');
 const build=await read('scripts/build-public-site.mjs');assert.match(build,/ADSENSE_SLOT_/);assert.match(build,/GA4_MEASUREMENT_ID/);
 const home=await read('public-site/index.html');for(const p of ['top','home','end'])assert.ok(home.includes('data-ad-position="'+p+'"'));
 assert.match(build,/data-ad-position="middle"/);assert.match(await read('public-site/_headers'),/google-analytics\.com/);
});
