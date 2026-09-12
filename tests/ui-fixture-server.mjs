// Local-only UI diagnostic harness. Not imported by the production server.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const room='00000000-0000-4000-8000-000000000001';
const candidate={pauta:{id:'00000000-0000-4000-8000-000000000002',titulo:'TESTE LOCAL — candidato coletado sem rascunho',codigo:'TESTE-LOCAL',localidade:'Pecém',categoria:'Serviço',status:'apurar',versao:1,revisao_registro:1,url_fonte:'http://127.0.0.1:4174/fixture-source',evidencia:'Evidência fictícia para testar a interface. Não é notícia.',conferida:false},rascunho:null};
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/fixture-source'){res.setHeader('Content-Type','text/html');return res.end('<h1>Fonte de teste aberta</h1>');}
 if(req.url.startsWith('/api/v1/')){
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/v1/auth/me')return res.end(JSON.stringify({usuario:{id:room,nome:'TESTE LOCAL',redacoes:[{id:room,nome:'TESTE LOCAL',papel:'redator'}]}}));
  if(req.url==='/api/v1/pautas')return res.end(JSON.stringify([candidate]));
  if(req.url==='/api/v1/gestao')return res.end(JSON.stringify({agente:null,tarefas:[],eventos:[]}));
  if(req.url==='/api/v1/eventos')return res.end('[]');
  res.statusCode=405;return res.end('{"erro":"Este teste local não grava dados."}');
 }
 const asset={'/':'index.html','/app.js':'app.js','/app.css':'app.css'}[req.url];
 if(!asset){res.statusCode=404;return res.end();}
 try{res.setHeader('Content-Type',asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../dist/'+asset,import.meta.url)));}catch{res.statusCode=500;res.end('Compile antes do teste.');}
});
server.listen(4174,'127.0.0.1',()=>process.stdout.write('Fixture local na porta 4174. Sem credenciais ou dados reais.\n'));
