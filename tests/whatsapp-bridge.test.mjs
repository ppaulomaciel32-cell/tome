import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {parseManual} from '../whatsapp-bridge/manual.mjs';
import {canonicalNumber,identityJid} from '../whatsapp-bridge/identity.mjs';
import {backupSession} from '../whatsapp-bridge/backup-session.mjs';
import {DatabaseSync} from 'node:sqlite';
import {openVault} from '../whatsapp-bridge/vault.mjs';
import {createController,loadBridgeConfig} from '../whatsapp-bridge/controller.mjs';
import {createBridgeServer} from '../whatsapp-bridge/server.mjs';
import {BufferJSON,initAuthCreds,reviveAppState,qrEncoder} from '../whatsapp-bridge/baileys-adapter.mjs';
const number='5511999990000',owner='5511999990001',editor='5511999990002',group='120363123456789000@g.us';
const config=()=>loadBridgeConfig({WA_ENABLED:'true',WA_DEDICATED_NUMBER:number,WA_ALLOWED_SENDERS:owner+','+editor,WA_BRIDGE_TOKEN:'a'.repeat(64),AGENTE_REQUER_APROVACAO:'true'});
test('nono dígito: equivalência restrita a celular brasileiro, sem alterar LIDs e fixos',()=>{
  assert.equal(canonicalNumber('5585991035373'),'558591035373');
  assert.equal(identityJid('5585991035373:4@s.whatsapp.net'),'558591035373@s.whatsapp.net');
  for(const n of ['558533335373','5585933335373','5510991035373','5491191035373','558591035374'])assert.equal(canonicalNumber(n),n);
  assert.equal(identityJid('5585991035373@lid'),'5585991035373@lid');
  assert.notEqual(identityJid('558591035373@s.whatsapp.net'),identityJid('558591035373@lid'));
  const base={WA_DEDICATED_NUMBER:'5585991035373',WA_BRIDGE_TOKEN:'a'.repeat(64),AGENTE_REQUER_APROVACAO:'true'};
  assert.throws(()=>loadBridgeConfig({...base,WA_ALLOWED_SENDERS:'558591035373'}));
  assert.throws(()=>loadBridgeConfig({...base,WA_ALLOWED_SENDERS:'5585987654321,558587654321'}));
});
const draftPreview=()=>({id:crypto.randomUUID(),revision:1,titulo:'Simulação de prévia privada',resumo:'Este conteúdo sintético não representa uma notícia real.',localidade:'regiao',sources:[{name:'Fonte A',url:'https://a.example/test'},{name:'Fonte B',url:'https://b.example/test'}]});
async function vaultFixture(t){const directory=await mkdtemp(join(tmpdir(),'tnn-wa-'));const key=randomBytes(32).toString('hex');let vault=openVault({directory,key,codec:BufferJSON});t.after(async()=>{try{vault.close();}catch{}await rm(directory,{recursive:true,force:true});});return {directory,key,vault,reopen(){vault.close();vault=openVault({directory,key,codec:BufferJSON});return vault;}};}
async function fixture(t,{cfg=config(),wrongNumber=false}={}){
  const v=await vaultFixture(t);const auth=v.vault.auth(()=>({registered:false}),value=>value);
  let callbacks,connections=0,time=Date.now();const sends=[],timers=[];
  let meta={id:group,subject:'Comando Tome Nota',participants:[{id:number+'@s.whatsapp.net'},{id:'100001@lid',phoneNumber:owner+'@s.whatsapp.net'},{id:'100002@lid',phoneNumber:editor+'@s.whatsapp.net'}]};
  const socket={user:{id:(wrongNumber?owner:number)+':1@s.whatsapp.net'},async groupMetadata(id){return {...meta,id};},async groupFetchAllParticipating(){return {[group]:meta,other:{id:'123456789@g.us',subject:'Outro grupo',participants:[]}};},async resolveLid(pn){return pn===owner+'@s.whatsapp.net'?'100001@lid':'100002@lid';},async requestPairingCode(pn){assert.equal(pn,number);return 'ABCD1234';},async sendMessage(id,msg){sends.push({id,msg});return {key:{id:'sent-'+sends.length},message:{conversation:msg.text}};},end(){}};
  const c=createController({config:cfg,vault:v.vault,auth,now:()=>time,qrEncoder:async()=> 'data:image/png;base64,Zml4dHVyZQ==',socketFactory:async args=>{callbacks=args;connections++;return socket;},schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},cancel:()=>{}});
  t.after(()=>c.close());
  const update=async value=>{callbacks.onUpdate(value);await c.idle();};
  const connect=async()=>{await c.start({confirmDedicated:true});await update({connection:'open'});};
  const bind=()=>c.selectGroup({id:group,confirmGroup:true});
  const message=async({sender='100001@lid',id=randomBytes(5).toString('hex'),remote=group,text='STATUS',type='notify',timestamp=time/1000,alt,fromMe=false,requestId}={})=>{callbacks.onMessages({type,requestId,messages:[{key:{remoteJid:remote,participant:sender,participantAlt:alt,id,fromMe},messageTimestamp:timestamp,message:{conversation:text}}]});await c.idle();};
  return {c,...v,auth,connect,bind,update,message,sends,timers,socket,get callbacks(){return callbacks;},get connections(){return connections;},advance:ms=>{time+=ms;},setMeta:fn=>{meta=fn(meta);callbacks?.onGroupsChanged();}};
}
test('Brasil: pareia e recebe dono/editor com e sem nono dígito sem liberar intruso',async t=>{
  for(const reversed of [false,true]) {
    const full='5585991035373',short='558591035373',editorFull='5585987654321',editorShort='558587654321';
    const f=await fixture(t,{cfg:{...config(),number:reversed?short:full,allowedNumbers:[reversed?editorShort:editorFull],acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64)}});
    f.socket.user.id=(reversed?full:short)+':2@s.whatsapp.net';
    f.socket.resolveLid=async()=>undefined;
    f.setMeta(m=>({...m,participants:[{id:(reversed?full:short)+'@s.whatsapp.net'},{id:'500001@lid',phoneNumber:(reversed?editorFull:editorShort)+'@s.whatsapp.net'}]}));
    await f.c.start({confirmRiskAccepted:true});await f.update({connection:'open'});
    assert.equal(f.c.status().connected,true);await f.bind();
    await f.message({fromMe:true,text:'PAUTA: obras na entrada do Pecém nesta semana'});
    await f.message({sender:editorFull+'@s.whatsapp.net',id:'editor-repeat',text:'PAUTA: transporte público para trabalhadores do Pecém'});
    await f.message({sender:editorShort+'@s.whatsapp.net',id:'editor-repeat',text:'PAUTA: transporte público para trabalhadores do Pecém'});
    await f.message({sender:'500001@lid',text:'PAUTA: atendimento da unidade de saúde no Pecém'});
    assert.equal(f.c.status().manual.queued,3);
    await f.message({sender:'558587654320@s.whatsapp.net',text:'PAUTA: mensagem de pessoa sem autorização no grupo'});
    await f.message({sender:editorFull+'@lid',text:'PAUTA: telefone como LID não pode ganhar autorização'});
    assert.equal(f.c.status().manual.queued,3);
    f.setMeta(m=>({...m,participants:[...m.participants,{id:'558587654320@s.whatsapp.net'}]}));
    await assert.rejects(f.c.test(),e=>e.code==='unexpected_members');
  }
});
test('telemetria: aceita somente etapas/códigos fixos, sem texto privado',async t=>{
  const f=await fixture(t,{cfg:{...config(),pipelineToken:'f'.repeat(64)}});
  const body={cycleId:crypto.randomUUID(),state:'running',stage:'redacao',pending:0};
  await f.c.cycleStatus(body);assert.equal(f.c.status().cycle.stage,'redacao');
  await assert.rejects(f.c.cycleStatus({...body,stage:'PRIVATE_TOKEN'}),e=>e.code==='invalid_cycle');
  await assert.rejects(f.c.cycleStatus({...body,code:'PRIVATE_PROVIDER_DETAIL'}),e=>e.code==='invalid_cycle');
  assert.doesNotMatch(JSON.stringify(f.c.status()),/PRIVATE_TOKEN|PRIVATE_PROVIDER/);
});
test('manual: o dono no próprio número envia pauta e STATUS; o robô não entra em loop',async t=>{
  const f=await fixture(t,{cfg:{...config(),acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64),editorialSigningKey:'c'.repeat(64)}});
  await f.connect();await f.bind();
  await f.message({fromMe:true,text:'MANCHETE: Ponte do Pecém recebe vistoria após chuva',id:'own-message'});
  assert.equal(f.c.status().manual.queued,1);assert.match(f.sends[0].msg.text,/Pauta recebida/);
  await f.message({fromMe:true,text:f.sends[0].msg.text,id:'unknown-echo-id'});
  await f.message({fromMe:true,text:'MANCHETE: Ponte do Pecém recebe vistoria após chuva',id:'own-message'});
  assert.equal(f.c.status().manual.queued,1);assert.equal(f.sends.length,1);
  await f.message({fromMe:true,text:'STATUS'});assert.match(f.sends[1].msg.text,/Pautas na fila: 1/);
  const result=await f.c.claimCommand({publisherReady:true});assert.equal(result.command.kind,'pauta');
  assert.doesNotMatch(JSON.stringify(result.command),new RegExp(number));
});
test('manual: namorada continua autorizada; outro grupo, histórico e intruso não entram',async t=>{
  const f=await fixture(t,{cfg:{...config(),acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64)}});await f.connect();await f.bind();
  const text='Texto sobre uma pauta do Pecém para produzir a matéria.';
  await f.message({sender:'100002@lid',text});assert.equal(f.c.status().manual.queued,1);
  await f.message({sender:'malicious@lid',text});await f.message({fromMe:true,remote:'999999@g.us',text});
  await f.message({fromMe:true,timestamp:1,text});await f.message({fromMe:true,type:'append',text});
  assert.equal(f.c.status().manual.queued,1);
});
test('manual: APROVAR exige ID, prévia confirmada e assinatura; publicação duplicada não reenvia',async t=>{
  const f=await fixture(t,{cfg:{...config(),acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64),editorialSigningKey:'c'.repeat(64)}});await f.connect();await f.bind();
  const d=draftPreview();await f.message({fromMe:true,text:'APROVAR #'+d.id});assert.equal(f.c.status().manual.queued,0);
  await f.c.preview(d);await f.message({fromMe:true,text:'APROVAR #'+d.id});
  const {command}=await f.c.claimCommand({publisherReady:true});assert.equal(command.kind,'approve');assert.match(command.signature,/^[a-f0-9]{64}$/);
  const result={id:command.id,lease:command.lease,code:'publication_pending',draftId:d.id,url:'https://tomezap.com.br/noticia/pauta-teste/'};
  await f.c.commandResult(result);const before=f.sends.length;await f.c.commandResult(result);assert.equal(f.sends.length,before);
  await f.c.publicationStatus({id:command.id,draftId:d.id,url:result.url});const sent=f.sends.length;
  await f.c.publicationStatus({id:command.id,draftId:d.id,url:result.url});assert.equal(f.sends.length,sent);
  await assert.rejects(f.c.publicationStatus({id:crypto.randomUUID(),draftId:d.id,url:result.url}),e=>e.code==='approval_required');
});
test('manual: lease expira, fila persiste e tokens não podem abrir o pareamento',async t=>{
  const f=await fixture(t,{cfg:{...config(),acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64)}});await f.connect();await f.bind();
  await f.message({fromMe:true,text:'Faça uma matéria sobre a iluminação no acesso ao Pecém.'});
  const first=(await f.c.claimCommand({})).command;assert.equal((await f.c.claimCommand({})).command,null);
  f.advance(16*60000);const second=(await f.c.claimCommand({})).command;assert.equal(second.id,first.id);assert.notEqual(second.lease,first.lease);
  await assert.rejects(f.c.commandResult({id:first.id,lease:first.lease,code:'failed'}),e=>e.code==='invalid_lease');
  assert.equal(f.vault.get('manual:queue')[0].text.includes('Pecém'),true);
});
test('manual: comandos inválidos não viram pautas e texto comum passa sem prefixo',()=>{
  assert.equal(parseManual('APROVAR #invalido'),null);assert.equal(parseManual('CORRIGIR título'),null);assert.equal(parseManual('STATUS'),null);
  assert.equal(parseManual('Texto suficiente sobre a iluminação pública do Pecém.').kind,'pauta');
});
test('manual: número curto e frases inteiras viram decisão; frase dentro de pauta não',()=>{
  assert.deepEqual(parseManual('APROVAR 12'),{kind:'approve',number:12,revision:1});
  assert.deepEqual(parseManual('rejeitar nº 7.'),{kind:'reject',number:7,revision:1});
  for(const text of ['APROVAR','pode publicar','Pode postar!','ok, pode publicar','publica essa'])assert.deepEqual(parseManual(text),{kind:'approve',latest:true,revision:1});
  for(const text of ['rejeita','não publica','descartar'])assert.deepEqual(parseManual(text),{kind:'reject',latest:true,revision:1});
  // Conversa ou pauta que só contém as palavras nunca aprova nada.
  assert.equal(parseManual('A prefeitura disse que pode publicar o edital da obra na sexta-feira.').kind,'pauta');
  assert.notEqual(parseManual('pode publicar amanhã')?.kind,'approve');assert.equal(parseManual('aprovar depois'),null);
});
test('manual: APROVAR pelo número e "pode publicar" assinam o ID guardado na ponte',async t=>{
  const f=await fixture(t,{cfg:{...config(),acceptOwnCommands:true,manualEnabled:true,pipelineToken:'b'.repeat(64),editorialSigningKey:'c'.repeat(64)}});await f.connect();await f.bind();
  await f.message({fromMe:true,text:'pode publicar'});assert.match(f.sends.at(-1).msg.text,/Não há rascunho aguardando/);
  const a=draftPreview(),b=draftPreview();await f.c.preview(a);assert.match(f.sends.at(-1).msg.text,/RASCUNHO Nº 1 /);assert.match(f.sends.at(-1).msg.text,/APROVAR 1 /);
  await f.c.preview(b);
  await f.message({fromMe:true,text:'pode publicar'});assert.match(f.sends.at(-1).msg.text,/Há 2 rascunhos aguardando/);assert.equal(f.c.status().manual.queued,0);
  await f.message({fromMe:true,text:'APROVAR 9'});assert.match(f.sends.at(-1).msg.text,/Não encontrei o rascunho nº 9/);
  await f.message({fromMe:true,text:'aprovar 1'});
  let {command}=await f.c.claimCommand({publisherReady:true});assert.equal(command.kind,'approve');assert.equal(command.draftId,a.id);assert.match(command.signature,/^[a-f0-9]{64}$/);
  assert.equal('number' in command,false);assert.equal('latest' in command,false);
  // Com um só rascunho em aberto, a frase curta basta.
  await f.message({fromMe:true,text:'Pode publicar!'});
  ({command}=await f.c.claimCommand({publisherReady:true}));assert.equal(command.draftId,b.id);
  await f.c.commandResult({id:command.id,lease:command.lease,code:'publication_pending',draftId:b.id,url:'https://tomezap.com.br/noticia/pauta-teste/'});
  assert.match(f.sends.at(-1).msg.text,/Rascunho nº 2/);
});
test('prévia de fonte única exige marcação oficial ou material do editor',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();
  const one={...draftPreview(),sources:[{name:'Órgão oficial',url:'https://a.example/nota'}]};
  await assert.rejects(f.c.preview(one),e=>e.code==='invalid_preview');
  await assert.rejects(f.c.preview({...draftPreview(),single:'official'}),e=>e.code==='invalid_preview');
  await assert.rejects(f.c.preview({...one,single:'portal'}),e=>e.code==='invalid_preview');
  await f.c.preview({...one,single:'official'});assert.match(f.sends.at(-1).msg.text,/Fonte única \(oficial\): Órgão oficial/);
  await f.c.preview({...one,id:crypto.randomUUID(),single:'owner'});assert.match(f.sends.at(-1).msg.text,/material enviado por você/);
});
test('configuração exige aprovação humana e separa chip dos editores',()=>{
  const base={WA_ENABLED:'true',WA_DEDICATED_NUMBER:number,WA_ALLOWED_SENDERS:owner,WA_BRIDGE_TOKEN:'a'.repeat(64),AGENTE_REQUER_APROVACAO:'true'};
  assert.throws(()=>loadBridgeConfig({...base,AGENTE_REQUER_APROVACAO:'false'}));
  assert.throws(()=>loadBridgeConfig({...base,WA_ALLOWED_SENDERS:number}));
  assert.throws(()=>loadBridgeConfig({...base,WA_BRIDGE_TOKEN:'short'}));
  assert.equal(loadBridgeConfig({...base,WA_ALLOWED_SENDERS:''}).configured,false);
});
test('token do ciclo não pode ser igual ao token do painel',()=>{
  assert.throws(()=>loadBridgeConfig({WA_BRIDGE_TOKEN:'a'.repeat(64),WA_PIPELINE_TOKEN:'a'.repeat(64),AGENTE_REQUER_APROVACAO:'true'}));
});
test('prévia usa grupo autorizado, link privado fixo e deduplica por rascunho',async t=>{
  const f=await fixture(t);const draft=draftPreview();
  await assert.rejects(f.c.preview(draft));assert.equal(f.sends.length,0);
  await f.connect();await f.bind();await f.c.preview(draft);await f.c.preview(draft);
  assert.equal(f.sends.length,1);assert.equal(f.sends[0].id,group);
  assert.match(f.sends[0].msg.text,/RASCUNHO/);assert.match(f.sends[0].msg.text,/https:\/\/tomezap.com.br\/admin\/#rascunho\//);
  assert.match(f.sends[0].msg.text,/Nada publicado/);assert.equal(f.vault.get('preview:'+draft.id+':1'),'sent');
});
test('envio incerto de prévia não se repete e fica registrado no cofre',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();const draft=draftPreview();let attempts=0;
  f.socket.sendMessage=async()=>{attempts++;throw Error('fixture-network');};
  await assert.rejects(f.c.preview(draft));await assert.rejects(f.c.preview(draft),e=>e.code==='delivery_uncertain');
  assert.equal(attempts,1);assert.equal(f.vault.get('preview:'+draft.id+':1'),'claimed');
});
test('prévia e avisos compartilham o limite persistente e validam entrada',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();
  for(const bad of [{localidade:'constructor'},{revision:2},{sources:[{name:'A',url:'javascript:alert(1)'}]}])await assert.rejects(f.c.preview({...draftPreview(),...bad}),e=>e.code==='invalid_preview');
  for(let i=0;i<29;i++)await f.c.test();
  await f.c.preview(draftPreview());assert.equal(f.sends.length,30);
  await assert.rejects(f.c.notice({cycleId:crypto.randomUUID(),code:'weak_sources'}),e=>e.code==='send_limit');assert.equal(f.sends.length,30);
});
test('saúde indica ciclo parado e STATUS mostra pendências sem habilitar publicação',async t=>{
  const f=await fixture(t,{cfg:{...config(),pipelineToken:'b'.repeat(64)}});await f.connect();await f.bind();
  assert.equal(f.c.health().ok,false);
  await f.c.cycleStatus({cycleId:crypto.randomUUID(),state:'completed',pending:2});assert.equal(f.c.health().ok,true);
  await f.message();assert.match(f.sends[0].msg.text,/Rascunhos na fila: 2/);assert.equal(f.c.status().publicationEnabled,false);
  f.advance(46*60000);assert.equal(f.c.health().ok,false);assert.equal(f.c.health().cycleStale,true);
});
test('API do produtor não acessa QR, pareamento ou teste do dono',async t=>{
  const f=await fixture(t);const server=createBridgeServer({controller:f.c,token:'a'.repeat(64),pipelineToken:'b'.repeat(64)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});const base='http://127.0.0.1:'+server.address().port;
  const headers={'x-pipeline-token':'b'.repeat(64)};
  assert.equal((await fetch(base+'/pipeline-state',{headers})).status,200);
  for(const path of ['/pairing','/status','/groups'])assert.equal((await fetch(base+path,{headers})).status,404);
  assert.equal((await fetch(base+'/start',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'})).status,404);
  assert.equal((await fetch(base+'/preview',{method:'POST',headers:{'x-bridge-token':'a'.repeat(64),'Content-Type':'application/json'},body:'{}'})).status,404);
});
test('cofre salva buffers, credenciais e chaves Signal; reabre após reinício sem texto privado',async t=>{
  const f=await vaultFixture(t);const a=f.vault.auth(initAuthCreds,reviveAppState);
  a.saveCreds({registered:true,privateFixture:'segredo-fixture-nao-publico'});
  await a.state.keys.set({'lid-mapping':{[owner]:{number:owner}},session:{[owner+'@s.whatsapp.net']:{key:Buffer.from('signal-private-fixture')}}});
  const reopened=f.reopen(), restored=reopened.auth(initAuthCreds,reviveAppState);
  assert.equal(restored.state.creds.registered,true);assert.equal(restored.state.creds.privateFixture,'segredo-fixture-nao-publico');
  const keys=await restored.state.keys.get('session',[owner+'@s.whatsapp.net']);assert.ok(Buffer.isBuffer(keys[owner+'@s.whatsapp.net'].key));
  const bytes=await readFile(join(f.directory,'session.sqlite'));
  for(const secret of ['segredo-fixture-nao-publico','signal-private-fixture',owner])assert.equal(bytes.includes(Buffer.from(secret)),false);
  assert.equal((await stat(join(f.directory,'session.sqlite'))).mode&0o777,0o600);
  await restored.state.keys.set({session:{[owner+'@s.whatsapp.net']:null}});assert.equal((await restored.state.keys.get('session',[owner+'@s.whatsapp.net']))[owner+'@s.whatsapp.net'],null);
});
test('cofre com chave errada recusa abertura e preserva dados',async t=>{
  const f=await vaultFixture(t);f.vault.put('private',{value:'fixture'});
  const wrong=openVault({directory:f.directory,key:'f'.repeat(64)});assert.throws(()=>wrong.get('private'),/Não foi possível abrir/);wrong.close();assert.deepEqual(f.vault.get('private'),{value:'fixture'});
});
test('não conecta sem configuração e sem confirmação de chip dedicado',async t=>{
  const f=await fixture(t);await assert.rejects(f.c.start({}),e=>e.code==='confirmation_required');assert.equal(f.connections,0);
  const g=await fixture(t,{cfg:{...config(),configured:false}});await assert.rejects(g.c.start({confirmDedicated:true}),e=>e.code==='awaiting_configuration');assert.equal(g.connections,0);
});
test('QR privado expira, código alternativo usa só o número configurado e status não vaza ambos',async t=>{
  const f=await fixture(t);await f.c.start({confirmDedicated:true});
  await assert.rejects(f.c.pairCode(),e=>e.code==='pairing_not_ready');
  await f.update({qr:'private-qr-fixture'});assert.ok(f.c.pairing().qr);
  assert.doesNotMatch(JSON.stringify(f.c.status())+JSON.stringify(f.c.health()),/base64|private-qr|ABCD1234/);
  assert.equal((await f.c.pairCode()).pairingCode,'ABCD1234');assert.equal(f.c.pairing().qr,null);
  await f.update({qr:'other-private-qr'});assert.equal(f.c.pairing().qr,null);
  f.advance(61000);assert.equal(f.c.pairing().pairingCode,null);
  await f.update({connection:'open'});assert.equal(f.c.pairing().qr,null);assert.equal(f.c.pairing().pairingCode,null);
});
test('chip pessoal escaneado por engano é bloqueado',async t=>{
  const f=await fixture(t,{wrongNumber:true});await f.connect();assert.equal(f.c.status().state,'wrong_number');assert.equal(f.c.health().ok,false);
  await assert.rejects(f.bind());assert.equal(f.sends.length,0);
});
test('grupo é validado por ID e membros; outros grupos não são listados',async t=>{
  const f=await fixture(t);await f.connect();assert.deepEqual((await f.c.groups()).groups.map(g=>g.id),[group]);
  await assert.rejects(f.c.selectGroup({id:'not-a-group',confirmGroup:true}));
  f.setMeta(m=>({...m,participants:m.participants.slice(0,2)}));await assert.rejects(f.bind(),e=>e.code==='editor_not_member');
  f.setMeta(m=>({...m,participants:[...m.participants,{id:'100002@lid',phoneNumber:editor+'@s.whatsapp.net'},{id:'199999@lid'}]}));await assert.rejects(f.bind(),e=>e.code==='unexpected_members');
});
test('grupo confirmado não pode ser trocado por outro homônimo',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();
  await assert.rejects(f.c.selectGroup({id:'120363999999999999@g.us',confirmGroup:true}),e=>e.code==='group_locked');assert.equal(f.c.status().group.id,group);
});
test('apenas remetente verificado do grupo autorizado recebe STATUS',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();
  await f.message({sender:'attacker@lid',alt:owner+'@s.whatsapp.net'});
  await f.message({remote:'120363999999999999@g.us'});
  await f.message({type:'append'});await f.message({requestId:'spoof-fixture'});await f.message({fromMe:true});await f.message({timestamp:(Date.now()-300000)/1000});
  assert.equal(f.sends.length,0);
  await f.message({id:'unique-event'});await f.message({id:'unique-event'});assert.equal(f.sends.length,1);assert.match(f.sends[0].msg.text,/Publicação bloqueada/);
  f.setMeta(m=>({...m,participants:m.participants.slice(0,1)}));await f.message();assert.equal(f.sends.length,1);assert.equal(f.c.health().ok,false);
});
test('APROVAR, EDITAR e REELS não publicam neste marco',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();for(const text of ['APROVAR #123','EDITAR #123: outro texto','REELS #123'])await f.message({text});
  assert.equal(f.sends.length,3);assert.ok(f.sends.every(m=>m.msg.text.includes('Nenhuma matéria foi publicada')));assert.equal(f.c.status().publicationEnabled,false);
});
test('todas as mensagens, incluindo teste, respeitam limite persistente de 30 por hora',async t=>{
  const f=await fixture(t);await f.connect();await f.bind();for(let i=0;i<30;i++)await f.c.test();
  await assert.rejects(f.c.test(),e=>e.code==='send_limit');await f.message();assert.equal(f.sends.length,30);
  assert.equal(f.vault.get('sends').length,30);f.advance(3600001);await f.c.test();assert.equal(f.sends.length,31);
});
test('reconexão usa backoff, restartRequired reconecta e logout não apaga sessão',async t=>{
  const f=await fixture(t);await f.c.start({confirmDedicated:true});
  for(const expected of [1000,2000,4000]){await f.update({connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});const timer=f.timers.at(-1);assert.equal(timer.ms,expected);timer.fn();await f.c.idle();}
  await f.update({connection:'close',lastDisconnect:{error:{output:{statusCode:515}}}});assert.equal(f.timers.at(-1).ms,1000);f.timers.at(-1).fn();await f.c.idle();
  await f.update({connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});assert.equal(f.c.status().state,'needs_attention');assert.ok(f.vault.get('auth:creds'));assert.equal(f.c.pairing().qr,null);
});
test('sessão registrada retoma sem pedir novo QR',async t=>{
  const f=await fixture(t);f.auth.saveCreds({registered:true});await f.c.resume();assert.equal(f.connections,1);await f.update({connection:'open'});assert.equal(f.c.status().connected,true);assert.equal(f.c.pairing().qr,null);
});
test('API interna exige segredo; saúde nunca expõe QR nem informa redação pronta',async t=>{
  const f=await fixture(t);const server=createBridgeServer({controller:f.c,token:'a'.repeat(64)});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));const base='http://127.0.0.1:'+server.address().port;
  const denied=await fetch(base+'/pairing');assert.equal(denied.status,401);
  const health=await fetch(base+'/healthz');assert.equal(health.status,503);const data=await health.json();assert.equal(data.cycle,'not_implemented');assert.equal(data.publicationEnabled,false);assert.equal('qr' in data,false);
  const ok=await fetch(base+'/status',{headers:{'X-Bridge-Token':'a'.repeat(64)}});assert.equal(ok.status,200);assert.equal((await ok.json()).requiresApproval,true);
});
test('biblioteca real gera PNG QR local, sem conectar WhatsApp',async()=>{
  const png=await qrEncoder('TOMEZAP-TEST-ONLY-NOT-A-SESSION');assert.match(png,/^data:image\/png;base64,/);assert.ok(Buffer.from(png.split(',')[1],'base64').length>500);
});

test('backup consistente mantém sessão criptografada enquanto o cofre está aberto',async t=>{
  const f=await vaultFixture(t);f.vault.put('private',{value:'fixture-private-backup'});const file=await backupSession(f.directory);
  const bytes=await readFile(file);assert.equal(bytes.includes(Buffer.from('fixture-private-backup')),false);
  const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('SELECT COUNT(*) AS count FROM vault').get().count,1);db.close();
  assert.deepEqual(f.vault.get('private'),{value:'fixture-private-backup'});assert.equal((await stat(file)).mode&0o777,0o600);
});
