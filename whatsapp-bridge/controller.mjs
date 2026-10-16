import {createHash,createHmac} from 'node:crypto';
import {manualQueue,previewRegistry,parseManual,messageDigest,commandUUID} from './manual.mjs';
import {normalizeJid,identityJid,canonicalNumber,numberVariants} from './identity.mjs';
import {MAX_MEDIA,mediaTypes,sniff} from './media.mjs';
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
    pipelineToken,mediaDirectory:env.WA_MEDIA_DIR || '',
    configured:enabled && Boolean(number && allowedNumbers.length), directory:env.WA_SESSION_DIR || '/data/session', key:env.WA_SESSION_KEY};
}

export function createController({config, vault, auth, socketFactory, qrEncoder, mediaStore = null, now = Date.now, schedule = setTimeout, cancel = clearTimeout}) {
  let socket = null, generation = 0, state = config.configured ? 'idle' : 'awaiting_configuration';
  if(vault.get('blocked'))state='needs_attention';
  let qr = null, pairingCode = null, pairingExpires = 0, retryTimer, attempt = 0, stopped = false, chain = Promise.resolve();
  let connectingReady = false, connectedAt = null, lastError = null, pending = 0, groupCache = null, softFailures = 0;
  const run = task => {if (pending >= 100) return Promise.reject(new BridgeError(429,'busy','A conexão está ocupada. Aguarde.')); pending++; const p=chain.then(task); chain=p.catch(()=>{}).finally(()=>pending--); return p;};
  const clearPairing = ()=>{qr=null;pairingCode=null;pairingExpires=0;};
  const record = code => {const events=vault.get('events',[]); events.push({at:new Date(now()).toISOString(),code});vault.put('events',events.slice(-50));lastError=code;};
  const selection = ()=>vault.get('group',null);
  const manual=manualQueue(vault,now,fail);
  const previews=previewRegistry(vault,now);
  const label=id=>{const n=previews.number(id);return n?'Rascunho nº '+n:'#'+id;};
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
  async function sendGroup(text,image=null,mimetype='image/png') {
    const group=selection(); if(!group) fail(409,'no_group','Escolha o grupo autorizado.');
    await members(await metadata(group.id));
    const sends=vault.get('sends',[]).filter(t=>t>now()-3600000);
    if(sends.length>=30) fail(429,'send_limit','Limite de 30 mensagens por hora atingido. Aguarde.');
    // Reserva antes do envio: falha ou reinício nunca libera mais mensagens que o limite.
    sends.push(now());vault.put('sends',sends);
    // Reserva antes do envio; a resposta incerta também não pode virar nova pauta.
    vault.put('outboundHashes',[...vault.get('outboundHashes',[]).filter(x=>x.at>now()-72*3600000),{hash:messageDigest(text),at:now()}].slice(-100));
    const sent=await socket.sendMessage(group.id,image?{image,caption:text,mimetype}:{text});
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
      // Foto pode chegar comprimida (imageMessage) ou como documento, que preserva a resolução.
      const content=message.message?.documentWithCaptionMessage?.message || message.message || {};
      const image=content.imageMessage || (mediaTypes.includes(content.documentMessage?.mimetype)?content.documentMessage:null);
      const text=content.conversation ?? content.extendedTextMessage?.text ?? image?.caption;
      // Foto ou texto que o próprio robô mandou (prévia com capa, Stories) nunca vira pauta nem pede legenda.
      if(key.fromMe && (vault.get('outbound',[]).some(x=>x.id===key.id) || (typeof text==='string' && vault.get('outboundHashes',[]).some(x=>x.hash===messageDigest(text) && x.at>now()-72*3600000))))continue;
      if(image && config.manualEnabled && (typeof text!=='string' || text.trim().length<20)){
        const hint=createHash('sha256').update(group.id+'|foto|'+key.id).digest('hex');
        if(vault.claim(hint,now()))try{await sendGroup('Recebi a foto, mas sem a pauta. Mande a foto de novo com a pauta escrita na legenda (pelo menos uma frase), que eu preparo a matéria com ela na capa.');}catch{}
        continue;
      }
      if(typeof text!=='string' || text.length>4000) continue;
      if(key.fromMe && (vault.get('outbound',[]).some(x=>x.id===key.id) || vault.get('outboundHashes',[]).some(x=>x.hash===messageDigest(text) && x.at>now()-72*3600000)))continue;
      const command=text.trim().toUpperCase();
      const identity=key.fromMe?identityJid(config.number+'@s.whatsapp.net'):sender;
      const receipt=createHash('sha256').update(group.id+'|'+identity+'|'+key.id).digest('hex');
      const parsed=parseManual(text);
      if(config.manualEnabled && parsed){
        try{
          if(parsed.kind!=='pauta' && !parsed.draftId){
            // "APROVAR 12" ou "pode publicar": o ID real vem do registro da ponte, nunca do texto.
            const open=previews.open();
            const target=parsed.number?previews.byNumber(parsed.number):(open.length===1?open[0]:null);
            const verb={approve:'APROVAR ',reject:'REJEITAR ',edit:'CORRIGIR '}[parsed.kind];
            if(!target){
              if(vault.claim(receipt,now()))await sendGroup(parsed.number?'Não encontrei o rascunho nº '+parsed.number+'. Confira o número na prévia.'
                :open.length?'Há '+open.length+' rascunhos aguardando. Diga qual, por exemplo: '+verb+open.at(-1).n+(parsed.kind==='edit'?': o que mudar':'')+'\n'+open.slice(-8).map(p=>'Nº '+p.n+' — '+p.titulo).join('\n')
                :'Não há rascunho aguardando decisão.');
              continue;
            }
            if(parsed.kind==='edit' && target.decided){
              if(vault.claim(receipt,now()))await sendGroup('O rascunho nº '+target.n+' já foi decidido ou corrigido. A correção vale para rascunho que ainda aguarda aprovação.');
              continue;
            }
            parsed.draftId=target.id;
          }
          delete parsed.number;delete parsed.latest;
          if(parsed.kind==='cancel'){
            if(vault.claim(receipt,now())){manual.cancel(parsed.draftId);previews.reopen(parsed.draftId);await sendGroup('Agendamento cancelado. Confira o rascunho antes de aprovar novamente.');}
            continue;
          }
          if(parsed.notBefore && (parsed.notBefore<now()+60000 || parsed.notBefore>now()+30*86400000)){
            if(vault.claim(receipt,now()))await sendGroup('Use AGENDAR número AAAA-MM-DD HH:MM, entre 1 minuto e 30 dias. Horário de Fortaleza.');continue;
          }
          if(parsed.kind==='edit' && vault.get('preview:'+parsed.draftId+':1')!=='sent')continue;
          if(parsed.kind==='approve' && vault.get('preview:'+parsed.draftId+':1')!=='sent'){
            if(vault.claim(receipt,now()))await sendGroup('Não há prévia confirmada para esse ID. Confira o rascunho e aguarde a prévia antes de aprovar.');continue;
          }
          const editorHash=messageDigest(identity);
          if(parsed.kind!=='pauta'){
            if(!config.editorialSigningKey){if(vault.claim(receipt,now()))await sendGroup('A aprovação ainda precisa da assinatura editorial configurada na ponte e no Supabase. Nada foi publicado.');continue;}
            // A correção assina só a retirada do rascunho antigo; o novo passa por nova aprovação.
            parsed.signature=createHmac('sha256',config.editorialSigningKey).update(JSON.stringify({action:parsed.kind==='edit'?'reject':parsed.kind,draft_id:parsed.draftId,revision:1,receipt,editor_hash:editorHash,
              ...(parsed.notBefore?{not_before:new Date(parsed.notBefore).toISOString()}: {})})).digest('hex');
          }
          let photo='none';
          if(parsed.kind==='pauta' && image){
            // "Foto: Fulano" ou "Crédito: Fulano" na legenda vira o crédito e sai do texto da pauta.
            const credit=parsed.text.match(/^[ \t]*(?:foto|cr[ée]dito(?:[ \t]+da[ \t]+foto)?)[ \t]*:[ \t]*(.{2,80}?)[ \t]*$/im);
            const rest=credit?parsed.text.replace(credit[0],'').trim():parsed.text;
            if(credit && rest.length>=20){parsed.text=rest;parsed.credit=credit[1].replace(/[\x00-\x1f\x7f<>]/g,' ').trim();}
            photo='failed';
            if(mediaStore && socket.downloadMedia && mediaTypes.includes(image.mimetype) && Number(image.fileLength || 0)<=MAX_MEDIA){
              try{
                const data=await socket.downloadMedia(message);
                if(Buffer.isBuffer(data) && data.length>=1000 && data.length<=MAX_MEDIA && sniff(data)){mediaStore.put(receipt,data);parsed.photo=true;photo='saved';}
              }catch{}
            }
          }
          const result=manual.add(parsed,receipt,editorHash);
          if(result.job && parsed.kind!=='pauta')previews.decide(parsed.draftId);
          if(result.job && parsed.kind==='approve' && parsed.notBefore)await sendGroup('Texto aprovado e agendado para '+new Date(parsed.notBefore).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})+' (Fortaleza). Para cancelar: CANCELAR '+previews.number(parsed.draftId)+'.');
          // Só a pauta recebe confirmação imediata; a decisão responde quando terminar.
          if(result.job && parsed.kind==='edit')await sendGroup('Correção recebida para o '+label(parsed.draftId).toLowerCase()+'. Vou refazer e mando a nova prévia.');
          if(result.job && parsed.kind==='pauta')await sendGroup((photo==='saved'?'Pauta e foto recebidas. A foto será a capa.'
            :photo==='failed'?'Pauta recebida, mas não consegui usar a foto (envie JPG ou PNG de até 25 MB). A capa será a arte do jornal.'
            :'Pauta recebida.')+' Vou preparar o rascunho e mando a prévia aqui. Nada é publicado sem você aprovar.');
        }catch(error){if(error.code==='queue_full')try{await sendGroup(error.message);}catch{}}
        continue;
      }
      if(!/^(STATUS|APROVAR|REJEITAR|EDITAR|STORIES|REELS|PAUSAR|RETOMAR)(?:\s|:|$)/.test(command) && !parsed)continue;
      if(!vault.claim(receipt,now()))continue;
      try {
        if(parsed && parsed.kind==='pauta'){await sendGroup('Recebi seu texto, mas a produção manual ainda não foi ativada na VPS. A conexão WhatsApp está funcionando; confira o trabalhador e os tokens.');continue;}
        if(command==='STATUS' && config.manualEnabled){
          const q=manual.status(),open=previews.open(),quota=vault.get('manual:quota',null);
          await sendGroup('WhatsApp conectado.\nPublicadas hoje: '+q.publishedToday+'\nAguardando sua decisão: '+open.length+(open.length?'\n'+open.slice(-8).map(p=>'Nº '+p.n+' — '+p.titulo).join('\n'):'')
            +'\nPautas na fila: '+q.queued+' · em preparo: '+q.processing
            +(quota?'\nRedações de hoje: '+quota.used+' de '+quota.limit:'')
            +'\nPara publicar: APROVAR e o número. Para ajustar: CORRIGIR número: o que mudar.');continue;}
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
          state='connected';clearPairing();attempt=0;softFailures=0;connectedAt=new Date(now()).toISOString();lastError=null;record('connected');lastError=null;
        }
        if(update.connection==='close') {
          const code=update.lastDisconnect?.error?.output?.statusCode;
          closeSocket();
          // 440 (sessão substituída) e 500 (sessão ruim) às vezes passam sozinhos: duas novas tentativas espaçadas antes de bloquear.
          if([440,500].includes(code) && softFailures<2){
            softFailures++;record('session_retry_'+code);state='reconnecting';
            retryTimer=schedule(()=>{retryTimer=null;safeEvent(open);},softFailures===1?60000:300000);retryTimer?.unref?.();return;
          }
          record([401,403,411,440,500].includes(code)?'session_attention_'+code:'disconnected');
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
      const q=body?.quota;if(q && Number.isInteger(q.used) && Number.isInteger(q.limit) && q.used>=0 && q.limit>0 && q.limit<=1000)vault.put('manual:quota',{used:Math.min(q.used,1000),limit:q.limit,at:now()});
      return {enabled:true,command:manual.claim()};
    }),
    // Resumo da redação para o painel: só números, IDs e títulos já enviados ao grupo.
    newsroom:()=>{
      const q=manual.status(),quota=vault.get('manual:quota',null);
      return {previews:previews.open().slice(-30).map(p=>({n:p.n,id:p.id,titulo:p.titulo,at:new Date(p.at).toISOString()})),
        scheduled:manual.scheduled(),
        publishedToday:q.publishedToday,queued:q.queued,processing:q.processing,quota:quota?{used:quota.used,limit:quota.limit}:null,
        workerSeenAt:vault.get('manual:workerAt',null),manualEnabled:Boolean(config.manualEnabled)};
    },
    // Decisão tomada no painel: mesmo caminho da mensagem no grupo, com assinatura própria.
    panelDecision:body=>run(async()=>{
      if(!config.manualEnabled)fail(409,'manual_disabled','A redação manual está desligada na ponte.');
      if(!config.editorialSigningKey)fail(409,'awaiting_configuration','A assinatura editorial ainda não está configurada.');
      if(!['approve','reject','edit','cancel'].includes(body?.kind) || !commandUUID.test(body?.draftId || '') || !/^[a-f0-9]{64}$/.test(body?.actor || '') || !/^[a-f0-9-]{36}$/.test(body?.nonce || ''))fail(400,'invalid_decision','Decisão inválida.');
      if(body.kind==='cancel'){const result=manual.cancel(body.draftId);previews.reopen(body.draftId);return result;}
      if(vault.get('preview:'+body.draftId+':1')!=='sent')fail(409,'no_preview','Esse rascunho ainda não teve prévia confirmada no grupo.');
      const number=previews.number(body.draftId),open=previews.open().some(p=>p.id===body.draftId);
      if(!open)fail(409,'already_decided','Esse rascunho já foi decidido ou corrigido.');
      const command={kind:body.kind,draftId:body.draftId,revision:1};
      if(body.scheduledAt!==undefined){
        const at=Date.parse(body.scheduledAt);
        if(body.kind!=='approve' || !Number.isFinite(at) || at<now()+60000 || at>now()+30*86400000)fail(400,'invalid_decision','Agende entre 1 minuto e 30 dias a partir de agora.');
        command.notBefore=at;
      }
      if(body.kind==='edit'){
        const text=typeof body.text==='string'?body.text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,' ').trim():'';
        if(!['fix','title','direct','photo'].includes(body.mode) || (['fix','title'].includes(body.mode) && (text.length<5 || text.length>(body.mode==='title'?300:1500))))fail(400,'invalid_decision','Escreva o pedido de correção (ou a nova manchete).');
        Object.assign(command,{mode:body.mode,text});
        if(body.mode==='direct'){
          const d=body.fields,valid=(x,min,max)=>typeof x==='string' && x.length>=min && x.length<=max && !/[<>\x00-\x08\x0b-\x1f]/.test(x);
          if(!d || !valid(d.titulo,3,300) || !valid(d.resumo,10,500) || !valid(d.texto,100,20000) || !['sao-goncalo','pecem','taiba','croata','paracuru','regiao'].includes(d.localidade))fail(400,'invalid_decision','Confira título, resumo, texto e localidade.');
          command.fields={titulo:d.titulo,resumo:d.resumo,texto:d.texto,localidade:d.localidade};
        }
      }
      // Recibo único por pedido do painel; repetição do mesmo pedido não duplica a fila.
      const receipt=createHash('sha256').update('painel|'+body.actor+'|'+body.draftId+'|'+body.kind+'|'+body.nonce).digest('hex');
      const editorHash=messageDigest('painel:'+body.actor);
      if(body.mode==='photo'){
        if(!mediaStore || typeof body.image!=='string' || body.image.length>28000000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.image) || typeof body.credit!=='string' || body.credit.trim().length<2 || body.credit.length>120 || /[<>\x00-\x1f]/.test(body.credit))fail(400,'invalid_decision','Envie uma foto JPG, PNG ou WebP e o crédito (2 a 120 caracteres).');
        const raw=Buffer.from(body.image,'base64');if(raw.length<1000 || raw.length>20*1024*1024 || !sniff(raw))fail(400,'invalid_decision','Formato de foto inválido ou maior que 20 MB.');
        mediaStore.put(receipt,raw);command.photo=true;command.credit=body.credit.trim();
      }
      command.signature=createHmac('sha256',config.editorialSigningKey).update(JSON.stringify({action:body.kind==='edit'?'reject':body.kind,draft_id:body.draftId,revision:1,receipt,editor_hash:editorHash,
        ...(command.notBefore?{not_before:new Date(command.notBefore).toISOString()}: {})})).digest('hex');
      const result=manual.add(command,receipt,editorHash);
      if(result.duplicate)return {queued:true,duplicate:true,number};
      previews.decide(body.draftId);
      const verb={approve:'Aprovado pelo painel',reject:'Rejeitado pelo painel',edit:'Correção pedida pelo painel'}[body.kind];
      try{await sendGroup(verb+': rascunho nº '+number+'.'+(command.notBefore?' Publicação agendada para '+new Date(command.notBefore).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'})+' (Fortaleza).':body.kind==='approve'?' Vou publicar e aviso aqui com o link.':''));}catch{}
      return {queued:true,number,...(command.notBefore?{scheduledAt:new Date(command.notBefore).toISOString()}: {})};
    }),
    monitorAlert:body=>run(async()=>{
      let url;try{url=new URL(body?.url);}catch{fail(400,'invalid_alert','URL inválida.');}
      if(!/^[a-f0-9]{64}$/.test(body?.hash || '') || typeof body.title!=='string' || body.title.length>300 || url.protocol!=='https:' || url.username || url.password || url.port || !['.gov.br','.leg.br','.mp.br','.jus.br','.def.br'].some(s=>url.hostname.endsWith(s)))fail(400,'invalid_alert','Monitor exige documento oficial.');
      const key='monitor:'+body.hash;if(vault.get(key))return {duplicate:true};vault.put(key,'claimed');
      await sendGroup('Alerta de apuração\n'+body.title.replace(/[\r\n\x00-\x1f]/g,' ')+'\n'+url.href+'\nMudança de página não comprova irregularidade. O robô tentará preparar uma prévia; confira documento, data e partes envolvidas. Nada publicado.');
      vault.put(key,'sent');return {sent:true};
    }),
    dailySummary:body=>run(async()=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(body?.day || ''))fail(400,'invalid_summary','Data inválida.');
      const day=new Date(now()-3*3600000).toISOString().slice(0,10);
      if(body.day!==day)fail(400,'invalid_summary','Resumo deve ser do dia atual.');
      const key='summary:'+day;if(vault.get(key))return {duplicate:true};
      const top=Array.isArray(body.top)?body.top.slice(0,3).filter(a=>typeof a.title==='string' && a.title.length<=140 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug || '') && Number.isSafeInteger(a.views) && a.views>0):[];
      const q=manual.status();vault.put(key,'claimed');
      await sendGroup('Resumo da redação · '+day+'\nPublicações aprovadas hoje: '+q.publishedToday+'\nAguardando aprovação: '+previews.open().length+'\nAgendadas: '+manual.scheduled().length+'\nNa fila: '+q.queued
        +(top.length?'\nMais lidas (30 dias, GA4):\n'+top.map(a=>a.title.replace(/[\r\n\x00-\x1f]/g,' ')+' · '+a.views+' visualizações\nhttps://tomezap.com.br/noticia/'+a.slug+'/').join('\n'):'\nMais lidas: aguardando dados reais do GA4.'));
      vault.put(key,'sent');return {sent:true};
    }),
    story:body=>run(async()=>{
      if(!commandUUID.test(body?.draftId || '') || typeof body.png!=='string' || body.png.length>2000000 || !/^https:\/\/tomezap\.com\.br\/noticia\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(body.url || ''))fail(400,'invalid_story','Arte inválida.');
      const raw=Buffer.from(body.png,'base64');
      if(raw.length<24 || raw.length>=1500000 || !raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || raw.readUInt32BE(16)!==1080 || raw.readUInt32BE(20)!==1920)fail(400,'invalid_story','A arte deve ser PNG de 1080 × 1920.');
      // Só envia Stories de uma matéria cuja aprovação foi concluída na ponte.
      if(!vault.get('publication:'+body.draftId))fail(409,'approval_required','Publicação ainda não confirmada.');
      const key='story:'+body.draftId;if(vault.get(key))return {duplicate:true};vault.put(key,'claimed');
      await sendGroup('Stories da matéria\n'+body.url,raw);vault.put(key,'sent');return {sent:true};
    }),
    // Entrega a foto à redação pela rede interna; apaga quando a redação confirma.
    media:receipt=>{const data=/^[a-f0-9]{64}$/.test(receipt || '') && mediaStore?mediaStore.get(receipt):null;if(!data)fail(404,'media_not_found','Foto não encontrada.');return data;},
    releaseMedia:body=>{if(!/^[a-f0-9]{64}$/.test(body?.receipt || ''))fail(400,'invalid_media','Identificador inválido.');mediaStore?.remove(body.receipt);return {ok:true};},
    publicationStatus:body=>run(async()=>{
      if(!commandUUID.test(body?.id || '') || !commandUUID.test(body?.draftId || '') || !/^https:\/\/tomezap\.com\.br\/noticia\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(body?.url || ''))fail(400,'invalid_result','Resultado inválido.');
      const result=manual.publication(body);if(result.duplicate)return result;
      vault.put('publication:'+body.draftId,true);
      await sendGroup('No ar: '+body.url+'\nCompartilhar: '+body.url);return {ok:true};
    }),
    commandResult:body=>run(async()=>{
      const messages={draft_ready:'Rascunho salvo e prévia preparada.',weak_sources:'Não consegui fonte suficiente para esta pauta. Mande o link da fonte oficial (prefeitura, governo, MP, empresa pública) ou cole aqui o texto completo da nota, que eu preparo o rascunho.',awaiting_configuration:'A redação manual ainda precisa de configuração: Gemini gratuito, fontes e tokens.',already_seen:'Essa pauta já foi registrada. Confira a fila antes de enviar novamente.',queue_full:'A fila de rascunhos está cheia.',quota_limit:'A cota local gratuita foi atingida. Aguarde.',failed:'Não consegui concluir esta pauta. Nenhuma aprovação foi inventada; confira o painel.',rejected:'Rascunho rejeitado; nenhuma publicação foi feita.',edit_failed:'Não consegui aplicar a correção. Pode ser um pedido com fato ou número que não está na fonte. O rascunho anterior continua valendo.',publication_pending:'Matéria aprovada e salva; a página ainda não foi confirmada no ar.',live:'No ar'};
      if(!commandUUID.test(body?.id || '') || !commandUUID.test(body?.lease || '') || !Object.hasOwn(messages,body.code))fail(400,'invalid_result','Resultado inválido.');
      if(body.draftId && !commandUUID.test(body.draftId))fail(400,'invalid_result','ID inválido.');
      if(body.url && !/^https:\/\/tomezap\.com\.br\/noticia\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(body.url))fail(400,'invalid_result','URL inválida.');
      if(body.code==='live' && !body.url)fail(400,'invalid_result','URL obrigatória.');
      const result=manual.finish(body);if(result.duplicate)return {ok:true,duplicate:true};
      if(body.code==='live')vault.put('publication:'+body.draftId,true);
      // Correção que falhou devolve o rascunho antigo à lista de aprovação.
      if(['edit_failed','queue_full','quota_limit'].includes(body.code) && result.job?.kind==='edit')previews.reopen(result.job.draftId);
      // A prévia já avisa que o rascunho está pronto; não gastar outra mensagem.
      if(body.code==='draft_ready')return {ok:true};
      await sendGroup(messages[body.code]+(body.draftId?'\n'+label(body.draftId):'')+(body.url?'\n'+body.url:''));return {ok:true};
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
        || !Array.isArray(body.sources) || body.sources.length<1 || body.sources.length>5
        || (body.sources.length===1 ? !['official','owner'].includes(body.single) : body.single!==undefined)
        || ![undefined,'photo','art','source'].includes(body.cover) || (body.replaces!==undefined && !validId.test(body.replaces))
        || (body.coverCredit!==undefined && (body.cover!=='source' || typeof body.coverCredit!=='string' || body.coverCredit.length<2 || body.coverCredit.length>120))
        || (body.coverUrl!==undefined && !/^https:\/\/bot\.tomezap\.com\.br\/imagens\/[a-f0-9]{32}-1600\.jpg$/.test(body.coverUrl)))fail(400,'invalid_preview','Prévia inválida.');
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
      const n=previews.add(body.id,clean(body.titulo));
      const origin=body.single==='owner'?'Fonte: material enviado por você à redação'
        :body.single==='official'?'Fonte única (oficial): '+clean(body.sources[0].name)+'\n'+body.sources[0].url
        :'Fontes: '+body.sources.length+'\n'+body.sources.map(s=>clean(s.name)+': '+s.url).join('\n');
      const replaced=body.replaces?previews.number(body.replaces):null;
      const coverLabel={photo:'foto enviada por você',source:'foto oficial da fonte'+(body.coverCredit?' ('+clean(body.coverCredit)+')':''),art:'arte do jornal com a manchete'}[body.cover];
      const previewText='RASCUNHO Nº '+n+(replaced?' (corrige o nº '+replaced+')':'')+' — aguardando revisão\n#'+body.id+'\n\n'+clean(body.titulo)+'\n\n'+clean(body.resumo)
        +(body.investigative===true?'\n\nA APURAR: mudança em documento não comprova irregularidade. Confira no texto o que está documentado e o que falta confirmar.':'')
        +'\n\nLocalidade: '+locals[body.localidade]+'\n'+origin
        +(body.cover?'\nCapa: '+coverLabel:'')
        +'\n\nTexto completo (login necessário): https://tomezap.com.br/admin/#rascunho/'+body.id
        +(config.manualEnabled?'\n\nLeia o texto completo. Para publicar, responda APROVAR '+n+' (ou "pode publicar"). Para descartar, REJEITAR '+n+'.':'\n\nNada publicado. Comandos de aprovação serão ativados nos próximos marcos.');
      // Com capa, a prévia chega como foto com a legenda; texto longo vai logo abaixo.
      if(body.coverUrl && previewText.length<=1000)await sendGroup(previewText,{url:body.coverUrl},'image/jpeg');
      else{
        if(body.coverUrl)try{await sendGroup('Capa do rascunho nº '+n+' · '+clean(body.titulo).slice(0,120),{url:body.coverUrl},'image/jpeg');}catch{}
        await sendGroup(previewText);
      }
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
