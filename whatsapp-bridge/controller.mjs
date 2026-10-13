import {createHash,createHmac} from 'node:crypto';
import {manualQueue,parseManual,messageDigest,commandUUID} from './manual.mjs';
import {normalizeJid,identityJid,canonicalNumber,numberVariants} from './identity.mjs';
export {normalizeJid} from './identity.mjs';

export class BridgeError extends Error {
  constructor(status, code, message) {super(message); Object.assign(this,{status,code});}
}
const fail = (status,code,message)=>{throw new BridgeError(status,code,message);};
const groupPattern = /^[0-9]{5,25}(?:-[0-9]{5,25})?@g\.us$/;
export function loadBridgeConfig(env = process.env) {
  const number = env.WA_DEDICATED_NUMBER || '';
  const allowedNumbers = [...new Set((env.WA_ALLOWED_SENDERS || '').split(',').map(x=>x.trim()).filter(Boolean))];
  if ((number && !/^[1-9]\d{9,14}$/.test(number)) || allowedNumbers.some(n=>!/^[1-9]\d{9,14}$/.test(n))) throw Error('Use DDI + DDD + número, somente dígitos.');
  const identities=allowedNumbers.map(canonicalNumber);
  if (allowedNumbers.length > 2 || new Set(identities).size!==identities.length || identities.includes(canonicalNumber(number))) throw Error('Autorize até dois editores distintos, diferentes do número conectado.');
  const enabled = env.WA_ENABLED === 'true';
  if (env.AGENTE_REQUER_APROVACAO !== 'true') throw Error('Este robô exige AGENTE_REQUER_APROVACAO=true.');
  if (!/^[a-f0-9]{64}$/i.test(env.WA_BRIDGE_TOKEN || '')) throw Error('Configure um WA_BRIDGE_TOKEN aleatório de 64 caracteres hexadecimais.');
  const pipelineToken=env.WA_PIPELINE_TOKEN || '';
  if(pipelineToken && (!/^[a-f0-9]{64}$/.test(pipelineToken) || pipelineToken===env.WA_BRIDGE_TOKEN)) throw Error('WA_PIPELINE_TOKEN deve ser exclusivo, diferente do token do painel.');
  const editorialSigningKey=env.TNN_EDITORIAL_SIGNING_KEY || '';
  if(editorialSigningKey && (!/^[a-f0-9]{64}$/.test(editorialSigningKey) || [pipelineToken,env.WA_BRIDGE_TOKEN].includes(editorialSigningKey)))throw Error('A assinatura editorial exige um segredo exclusivo.');
  return {enabled, number, allowedNumbers, groupName:'Comando Tome Nota', token:env.WA_BRIDGE_TOKEN,
    acceptOwnCommands:env.WA_ACCEPT_OWN_COMMANDS==='true',manualEnabled:env.WA_MANUAL_ENABLED==='true' && Boolean(pipelineToken),editorialSigningKey,
    pipelineToken,
    configured:enabled && Boolean(number && allowedNumbers.length), directory:env.WA_SESSION_DIR || '/data/session', key:env.WA_SESSION_KEY};
}

export function createController({config, vault, auth, socketFactory, qrEncoder, now = Date.now, schedule = setTimeout, cancel = clearTimeout}) {
  let socket = null, generation = 0, state = config.configured ? 'idle' : 'awaiting_configuration';
  if(vault.get('blocked'))state='needs_attention';
  let qr = null, pairingCode = null, pairingExpires = 0, retryTimer, attempt = 0, stopped = false, chain = Promise.resolve();
  let connectingReady = false, connectedAt = null, lastError = null, pending = 0, groupCache = null;
  const run = task => {if (pending >= 100) return Promise.reject(new BridgeError(429,'busy','A conexão está ocupada. Aguarde.')); pending++; const p=chain.then(task); chain=p.catch(()=>{}).finally(()=>pending--); return p;};
  const clearPairing = ()=>{qr=null;pairingCode=null;pairingExpires=0;};
  const record = code => {const events=vault.get('events',[]); events.push({at:new Date(now()).toISOString(),code});vault.put('events',events.slice(-50));lastError=code;};
  const selection = ()=>vault.get('group',null);
  const manual=manualQueue(vault,now,fail);
  const cycleState = ()=>{
    if(!config.pipelineToken)return {state:'not_implemented'};
    const cycle=vault.get('cycle',null);
    return cycle ? {...cycle,stale:now()-cycle.at>45*60000} : {state:'awaiting_configuration',stale:true};
  };
  const online = ()=>{if (state!=='connected' || !socket) fail(409,'not_connected','Conecte o chip dedicado antes de continuar.');};
  const closeSocket = ()=>{generation++; const old=socket;socket=null;groupCache=null;connectingReady=false;clearPairing();try{old?.end();}catch{}};
  const safeEvent = task=>{run(task).catch(()=>{state='error';closeSocket();try{record('storage_or_connection_error');}catch{}});};
  async function metadata(id, fresh = false) {
    online();
    if (!fresh && groupCache?.id===id && groupCache.expires>now()) return groupCache.value;
    const value = await socket.groupMetadata(id);
    groupCache = {id,value,expires:now()+30000}; return value;
  }
  async function members(meta) {
    if (!meta || !groupPattern.test(meta.id) || meta.subject!==config.groupName || !Array.isArray(meta.participants)) fail(409,'wrong_group','Escolha o grupo Comando Tome Nota.');
    const participants = meta.participants.map(p=>({id:identityJid(p.id), pn:identityJid(p.phoneNumber), lid:identityJid(p.lid)}));
    const ownIds = [identityJid(socket.user?.id),identityJid(socket.user?.lid)].filter(Boolean);
    if (!participants.some(p=>[p.id,p.pn,p.lid].some(id=>id && ownIds.includes(id)))) fail(409,'bot_not_member','Adicione o chip do robô ao grupo pelo seu celular.');
    const allowed = new Set();
    for (const number of config.allowedNumbers) {
      const pn = identityJid(number+'@s.whatsapp.net');
      let lid='';
      for(const candidate of numberVariants(number)) {
        lid=normalizeJid(await socket.resolveLid?.(candidate+'@s.whatsapp.net'));
        if(lid)break;
      }
      const p = participants.find(p=>p.id===pn || p.pn===pn || (lid && (p.id===lid || p.lid===lid)));
      if (!p) fail(409,'editor_not_member','Um editor autorizado não foi identificado no grupo. Confira os números configurados.');
      // Identidades vêm dos metadados/resolução autenticada, nunca do texto ou participantAlt da mensagem.
      for (const id of [p.id,p.pn,p.lid,pn,lid]) if(id) allowed.add(id);
    }
    if(participants.some(p=>![p.id,p.pn,p.lid].some(id=>id && (allowed.has(id) || ownIds.includes(id))))) fail(409,'unexpected_members','O grupo contém alguém além dos editores autorizados e do robô. Confira os participantes.');
    return allowed;
  }
  async function sendGroup(text) {
    const group=selection(); if(!group) fail(409,'no_group','Escolha o grupo autorizado.');
    await members(await metadata(group.id));
    const sends=vault.get('sends',[]).filter(t=>t>now()-3600000);
    if(sends.length>=20) fail(429,'send_limit','Limite de 20 mensagens por hora atingido. Aguarde.');
    // Reserva antes do envio: falha ou reinício nunca libera mais mensagens que o limite.
    sends.push(now());vault.put('sends',sends);
    // Reserva antes do envio; a resposta incerta também não pode virar nova pauta.
    vault.put('outboundHashes',[...vault.get('outboundHashes',[]).filter(x=>x.at>now()-72*3600000),{hash:messageDigest(text),at:now()}].slice(-100));
    const sent=await socket.sendMessage(group.id,{text});
    if(!sent?.key?.id)fail(503,'delivery_uncertain','O envio não foi confirmado. Confira o grupo e o painel antes de tentar de novo.');
    if(sent?.key?.id && sent.message) vault.put('outbound', [...vault.get('outbound',[]).filter(m=>m.at>now()-3600000),{id:sent.key.id,group:group.id,message:sent.message,at:now()}].slice(-20));
    return {sent:true};
  }
  async function receive(event) {
    if(event.type!=='notify' || event.requestId || state!=='connected') return;
    const group=selection();if(!group)return;
    for(const message of (event.messages || []).slice(0,20)) {
      const key=message.key || {}, timestamp=Number(message.messageTimestamp)*1000;
      if(key.remoteJid!==group.id || !key.id || message.requestId || !Number.isFinite(timestamp) || Math.abs(now()-timestamp)>120000) continue;
      if(key.fromMe && !config.acceptOwnCommands)continue;
      const sender=identityJid(key.participant);
      const allowed=await members(await metadata(group.id));
      if(!key.fromMe && !allowed.has(sender)) continue;
      const text=message.message?.conversation ?? message.message?.extendedTextMessage?.text ?? message.message?.imageMessage?.caption;
      if(typeof text!=='string' || text.length>4000) continue;
      if(key.fromMe && (vault.get('outbound',[]).some(x=>x.id===key.id) || vault.get('outboundHashes',[]).some(x=>x.hash===messageDigest(text) && x.at>now()-72*3600000)))continue;
      const command=text.trim().toUpperCase();
      const identity=key.fromMe?identityJid(config.number+'@s.whatsapp.net'):sender;
      const receipt=createHash('sha256').update(group.id+'|'+identity+'|'+key.id).digest('hex');
      const parsed=parseManual(text);
      if(config.manualEnabled && parsed){
        try{
          if(parsed.kind==='approve' && vault.get('preview:'+parsed.draftId+':1')!=='sent'){
            if(vault.claim(receipt,now()))await sendGroup('Não há prévia confirmada para esse ID. Confira o rascunho e aguarde a prévia antes de aprovar.');continue;
          }
          const editorHash=messageDigest(identity);
          if(parsed.kind!=='pauta'){
            if(!config.editorialSigningKey){if(vault.claim(receipt,now()))await sendGroup('A aprovação ainda precisa da assinatura editorial configurada na ponte e no Supabase. Nada foi publicado.');continue;}
            parsed.signature=createHmac('sha256',config.editorialSigningKey).update(JSON.stringify({action:parsed.kind,draft_id:parsed.draftId,revision:1,receipt,editor_hash:editorHash})).digest('hex');
          }
          const result=manual.add(parsed,receipt,editorHash);
          if(result.job)await sendGroup(parsed.kind==='pauta'?'Pauta recebida. Vou conferir as fontes e preparar um rascunho com capa padrão. Depois você precisa enviar APROVAR #ID.':'Comando recebido. Vou conferir o ID e a revisão antes de executar.');
        }catch(error){if(error.code==='queue_full')try{await sendGroup(error.message);}catch{}}
        continue;
      }
      if(!/^(STATUS|APROVAR|REJEITAR|EDITAR|STORIES|REELS|PAUSAR|RETOMAR)(?:\s|:|$)/.test(command) && !parsed)continue;
      if(!vault.claim(receipt,now()))continue;
      try {
        if(parsed && parsed.kind==='pauta'){await sendGroup('Recebi seu texto, mas a produção manual ainda não foi ativada na VPS. A conexão WhatsApp está funcionando; confira o trabalhador e os tokens.');continue;}
        if(command==='STATUS' && config.manualEnabled){const q=manual.status();await sendGroup('WhatsApp conectado. Pautas na fila: '+q.queued+'. Em processamento: '+q.processing+'.\nÚltimo resultado: '+(q.lastCode || 'aguardando trabalhador')+'.\nPublicação exige APROVAR #ID após a prévia.');continue;}
        const cycle=cycleState();
        const labels={running:'Em apuração',completed:'Último ciclo concluído',skipped:'Último ciclo sem nova matéria',failed:'Último ciclo precisa de atenção',queue_full:'Fila cheia; revise os rascunhos',awaiting_configuration:'Aguardando configuração'};
        await sendGroup(command==='STATUS' ? (cycle.state==='not_implemented' ? 'WhatsApp conectado. Grupo autorizado. A busca e a redação ainda não estão ativadas. Publicação bloqueada até a implementação e aprovação humana.' :
          'WhatsApp conectado. '+(cycle.stale?'Ciclo sem atualização recente.':(labels[cycle.state] || 'Ciclo em preparação')+'.')+'\nRascunhos na fila: '+(cycle.pending ?? 'não informado')+'\nÚltima atualização: '+(cycle.at?new Date(cycle.at).toISOString():'pendente')+'\nPublicação bloqueada. Aprovação será ativada no próximo marco.') : 'Este comando será ativado no módulo de aprovação. Nenhuma matéria foi publicada.');
      } catch(error) {if(error.code!=='send_limit') record('send_failed');}
    }
  }
  async function open() {
    if(stopped)return;
    closeSocket();const current=generation;state='connecting';
    socket=await socketFactory({auth, getMessage:async key=>vault.get('outbound',[]).find(m=>m.id===key.id && m.group===key.remoteJid && m.at>now()-3600000)?.message,
      cachedGroupMetadata:async id=>groupCache?.id===id && groupCache.expires>now() ? groupCache.value : undefined,
      onGroupsChanged:()=>{groupCache=null;},
      onCreds:update=>safeEvent(()=>{if(current===generation)auth.saveCreds(update);}),
      onMessages:event=>safeEvent(()=>current===generation ? receive(event) : undefined),
      onUpdate:update=>safeEvent(async()=>{
        if(current!==generation)return;
        if(update.connection==='connecting' || update.qr)connectingReady=true;
        if(update.qr && !auth.state.creds.registered && !(pairingCode && pairingExpires>now())) {pairingCode=null;qr=await qrEncoder(update.qr);pairingExpires=now()+55000;state='awaiting_scan';}
        if(update.connection==='open') {
          const own=identityJid(socket.user?.id);
          if(own!==identityJid(config.number+'@s.whatsapp.net')) {state='wrong_number';vault.put('blocked','wrong_number');closeSocket();record('wrong_number');return;}
          state='connected';clearPairing();attempt=0;connectedAt=new Date(now()).toISOString();lastError=null;record('connected');lastError=null;
        }
        if(update.connection==='close') {
          const code=update.lastDisconnect?.error?.output?.statusCode;
          closeSocket(); record([401,403,411,440,500].includes(code)?'session_attention':'disconnected');
          if([401,403,411,440,500].includes(code)){state='needs_attention';vault.put('blocked','session_attention');return;}
          if(++attempt>8){state='needs_attention';record('reconnect_exhausted');vault.put('blocked','reconnect_exhausted');return;}
          state='reconnecting';const delay=code===515 ? 1000 : Math.min(300000,1000*2**(attempt-1));
          retryTimer=schedule(()=>{retryTimer=null;safeEvent(open);},delay);retryTimer?.unref?.();
        }
      })});
  }
  function status() {
    const group=selection();return {state,connected:state==='connected',configured:config.configured,group:group?{id:group.id,name:config.groupName}:null,
      dedicatedNumber:config.number ? '••••'+config.number.slice(-4):null,authorizedEditors:config.allowedNumbers.length,
      manual:{enabled:Boolean(config.manualEnabled),acceptOwnCommands:Boolean(config.acceptOwnCommands),...manual.status(),workerSeenAt:vault.get('manual:workerAt',null),publisherReady:vault.get('manual:publisherReady',false)},
      connectedAt,lastError,publicationEnabled:false,requiresApproval:true,cycle:cycleState(),cycleEvents:vault.get('cycleEvents',[]).slice(-12),events:vault.get('events',[]).slice(-5)};
  }
  return {
    status,
    health:()=>({ok:state==='connected' && Boolean(selection()) && (!config.pipelineToken || (!cycleState().stale && ['completed','skipped','queue_full'].includes(cycleState().state))),service:'tomezap-whatsapp',whatsapp:state,groupConfigured:Boolean(selection()),publicationEnabled:false,cycle:cycleState().state,cycleStale:cycleState().stale ?? false}),
    pipelineState:()=>({connected:state==='connected',groupConfigured:Boolean(selection())}),
    claimCommand:body=>run(async()=>{
      if(!config.manualEnabled)return {enabled:false,command:null};
      online();const group=selection();if(!group)fail(409,'no_group','Confirme o grupo.');await members(await metadata(group.id,true));
      vault.put('manual:workerAt',now());vault.put('manual:publisherReady',body?.publisherReady===true && Boolean(config.editorialSigningKey));
      return {enabled:true,command:manual.claim()};
    }),
    publicationStatus:body=>run(async()=>{
      if(!commandUUID.test(body?.id || '') || !commandUUID.test(body?.draftId || '') || !/^https:\/\/tomezap\.com\.br\/noticia\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(body?.url || ''))fail(400,'invalid_result','Resultado inválido.');
      const result=manual.publication(body);if(result.duplicate)return result;
      await sendGroup('No ar: '+body.url+'\nCompartilhar: '+body.url);return {ok:true};
    }),
    commandResult:body=>run(async()=>{
      const messages={draft_ready:'Rascunho salvo e prévia preparada.',weak_sources:'Não encontrei duas fontes independentes aprovadas. Envie links das fontes para esta pauta.',awaiting_configuration:'A redação manual ainda precisa de configuração: Gemini gratuito, fontes e tokens.',already_seen:'Essa pauta já foi registrada. Confira a fila antes de enviar novamente.',queue_full:'A fila de rascunhos está cheia.',quota_limit:'A cota local gratuita foi atingida. Aguarde.',failed:'Não consegui concluir esta pauta. Nenhuma aprovação foi inventada; confira o painel.',rejected:'Rascunho rejeitado; nenhuma publicação foi feita.',publication_pending:'Matéria aprovada e salva; a página ainda não foi confirmada no ar.',live:'No ar'};
      if(!commandUUID.test(body?.id || '') || !commandUUID.test(body?.lease || '') || !Object.hasOwn(messages,body.code))fail(400,'invalid_result','Resultado inválido.');
      if(body.draftId && !commandUUID.test(body.draftId))fail(400,'invalid_result','ID inválido.');
      if(body.url && !/^https:\/\/tomezap\.com\.br\/noticia\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(body.url))fail(400,'invalid_result','URL inválida.');
      if(body.code==='live' && !body.url)fail(400,'invalid_result','URL obrigatória.');
      const result=manual.finish(body);if(result.duplicate)return {ok:true,duplicate:true};
      await sendGroup(messages[body.code]+(body.draftId?'\n#'+body.draftId:'')+(body.url?'\n'+body.url:''));return {ok:true};
    }),
    cycleStatus:body=>run(()=>{
      if(!/^[a-f0-9-]{36}$/.test(body?.cycleId || '') || !['running','completed','skipped','failed','queue_full','awaiting_configuration'].includes(body.state)
        || !Number.isInteger(body.pending) || body.pending<0 || body.pending>10)fail(400,'invalid_cycle','Estado do ciclo inválido.');
      const stage=body.stage ?? null,code=body.code ?? null;
      if(stage!==null && !['coleta','redacao','rascunho','previa','fim'].includes(stage))fail(400,'invalid_cycle','Etapa do ciclo inválida.');
      if(code!==null && !['ok','no_candidates','weak_sources','already_seen','queue_full','quota_limit','collect_failed','write_failed','store_failed','preview_failed','internal_error'].includes(code))fail(400,'invalid_cycle','Código do ciclo inválido.');
      const event={state:body.state,stage,code,at:now()};
      vault.put('cycle',{...event,pending:body.pending});
      // Histórico curto de códigos fixos; sem mensagens, telefones ou payloads.
      vault.put('cycleEvents',[...vault.get('cycleEvents',[]),event].slice(-20));return {ok:true};
    }),
    preview:body=>run(async()=>{
      const validId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
      const locals={'sao-goncalo':'São Gonçalo do Amarante',pecem:'Pecém',taiba:'Taíba',croata:'Croatá',paracuru:'Paracuru',regiao:'Região'};
      if(!validId.test(body?.id || '') || body.revision!==1 || typeof body.titulo!=='string' || body.titulo.length<3 || body.titulo.length>300
        || typeof body.resumo!=='string' || body.resumo.length<10 || body.resumo.length>500 || !Object.hasOwn(locals,body.localidade)
        || !Array.isArray(body.sources) || body.sources.length<2 || body.sources.length>5)fail(400,'invalid_preview','Prévia inválida.');
      for(const source of body.sources){
        let u;try{u=new URL(source.url);}catch{fail(400,'invalid_preview','Fonte inválida.');}
        if(u.protocol!=='https:' || u.username || u.password || u.hash || source.url.length>1500 || typeof source.name!=='string' || source.name.length<2 || source.name.length>100)fail(400,'invalid_preview','Fonte inválida.');
      }
      const key='preview:'+body.id+':1', previous=vault.get(key,null);
      if(previous==='sent')return {sent:true,duplicate:true};
      if(previous)fail(409,'delivery_uncertain','Prévia já tentada sem confirmação. Confira o painel.');
      online();const group=selection();if(!group)fail(409,'no_group','Confirme o grupo.');await members(await metadata(group.id,true));
      vault.put(key,'claimed');
      const clean=value=>value.replace(/[\r\n\x00-\x1f\x7f]/g,' ').trim();
      await sendGroup('RASCUNHO — aguardando revisão\n#'+body.id+'\n\n'+clean(body.titulo)+'\n\n'+clean(body.resumo)
        +'\n\nLocalidade: '+locals[body.localidade]+'\nFontes: '+body.sources.length+'\n'+body.sources.map(s=>clean(s.name)+': '+s.url).join('\n')
        +'\n\nTexto completo (login necessário): https://tomezap.com.br/admin/#rascunho/'+body.id
        +(config.manualEnabled?'\n\nLeia o texto completo. Para publicar esta revisão, envie APROVAR #'+body.id+'. A capa será a marca do jornal.':'\n\nNada publicado. Comandos de aprovação e capa serão ativados nos próximos marcos.'));
      vault.put(key,'sent');return {sent:true};
    }),
    notice:body=>run(async()=>{
      const messages={weak_sources:'Fonte fraca: não encontrei duas fontes independentes aprovadas. A pauta parou antes da redação.',collect_failed:'Três falhas seguidas na coleta. Confira as fontes no servidor.',write_failed:'Três falhas seguidas na redação. Confira o modelo e a cota gratuita.',store_failed:'Três falhas seguidas ao salvar. Confira o armazenamento privado.',preview_failed:'Três falhas seguidas no envio de prévias. Os rascunhos salvos continuam no painel.'};
      if(!messages[body?.code] || !/^[a-f0-9-]{36}$/.test(body.cycleId || ''))fail(400,'invalid_notice','Aviso inválido.');
      const key='notice:'+body.cycleId+':'+body.code;
      if(vault.get(key))return {duplicate:true};
      vault.put(key,'claimed');await sendGroup(messages[body.code]+' Nenhuma publicação automática foi feita.');vault.put(key,'sent');return {sent:true};
    }),
    pairing:()=>({...status(),qr:pairingExpires>now()?qr:null,pairingCode:pairingExpires>now()?pairingCode:null,expiresAt:pairingExpires>now()?new Date(pairingExpires).toISOString():null}),
    start:body=>run(async()=>{
      if(!config.configured)fail(503,'awaiting_configuration','Configure o chip dedicado, os editores e o cofre na VPS.');
      // confirmDedicated mantém compatibilidade com a tela antiga durante deploy.
      if(body?.confirmRiskAccepted!==true && body?.confirmDedicated!==true)fail(400,'confirmation_required','Confirme que autoriza conectar este número e compreende o risco de bloqueio.');
      if(['needs_attention','wrong_number'].includes(state))fail(409,'manual_attention','A sessão requer conferência no servidor. Não apague o volume.');
      if(!socket && !retryTimer)await open();return status();
    }),
    resume:()=>run(async()=>{if(config.configured && !vault.get('blocked') && auth.state.creds.registered && !socket)await open();}),
    pairCode:()=>run(async()=>{
      if(!socket || auth.state.creds.registered || !connectingReady)fail(409,'pairing_not_ready','Inicie a conexão e aguarde o QR Code antes de pedir o código.');
      if(pairingCode && pairingExpires>now())return {pairingCode,expiresAt:new Date(pairingExpires).toISOString()};
      pairingCode=await socket.requestPairingCode(config.number);qr=null;pairingExpires=now()+60000;
      return {pairingCode,expiresAt:new Date(pairingExpires).toISOString()};
    }),
    groups:()=>run(async()=>{online();const all=await socket.groupFetchAllParticipating();return {groups:Object.values(all).filter(m=>m.subject===config.groupName && groupPattern.test(m.id)).map(m=>({id:m.id,name:m.subject,participants:m.participants?.length || m.size || 0})).slice(0,20)};}),
    selectGroup:body=>run(async()=>{
      if(!groupPattern.test(body?.id || '') || body.confirmGroup!==true)fail(400,'invalid_group','Confira e confirme o grupo escolhido.');
      const existing=selection();if(existing && existing.id!==body.id)fail(409,'group_locked','A troca do grupo exige uma revisão no servidor. O grupo atual foi preservado.');
      const meta=await metadata(body.id,true);await members(meta);vault.put('group',{id:meta.id});return status();
    }),
    test:()=>run(()=>sendGroup('TomeZap: conexão de teste confirmada. O robô reconhece este grupo. Busca e publicação ainda aguardam ativação; toda matéria exigirá aprovação humana.')),
    idle:()=>chain,
    close:()=>run(()=>{stopped=true;cancel(retryTimer);retryTimer=null;closeSocket();state='stopped';})
  };
}
