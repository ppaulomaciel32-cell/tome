import {createHash} from 'node:crypto';

export class BridgeError extends Error {
  constructor(status, code, message) {super(message); Object.assign(this,{status,code});}
}
const fail = (status,code,message)=>{throw new BridgeError(status,code,message);};
const groupPattern = /^[0-9]{5,25}(?:-[0-9]{5,25})?@g\.us$/;
export const normalizeJid = jid => typeof jid === 'string' ? jid.replace(/:\d+(?=@)/,'') : '';
export function loadBridgeConfig(env = process.env) {
  const number = env.WA_DEDICATED_NUMBER || '';
  const allowedNumbers = [...new Set((env.WA_ALLOWED_SENDERS || '').split(',').map(x=>x.trim()).filter(Boolean))];
  if ((number && !/^[1-9]\d{9,14}$/.test(number)) || allowedNumbers.some(n=>!/^[1-9]\d{9,14}$/.test(n))) throw Error('Use DDI + DDD + número, somente dígitos.');
  if (allowedNumbers.length > 2 || allowedNumbers.includes(number)) throw Error('Autorize até dois editores, diferentes do chip dedicado.');
  const enabled = env.WA_ENABLED === 'true';
  if (env.AGENTE_REQUER_APROVACAO !== 'true') throw Error('Este robô exige AGENTE_REQUER_APROVACAO=true.');
  if (!/^[a-f0-9]{64}$/i.test(env.WA_BRIDGE_TOKEN || '')) throw Error('Configure um WA_BRIDGE_TOKEN aleatório de 64 caracteres hexadecimais.');
  return {enabled, number, allowedNumbers, groupName:'Comando Tome Nota', token:env.WA_BRIDGE_TOKEN,
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
    const participants = meta.participants.map(p=>({id:normalizeJid(p.id), pn:normalizeJid(p.phoneNumber), lid:normalizeJid(p.lid)}));
    const ownIds = [normalizeJid(socket.user?.id),normalizeJid(socket.user?.lid)].filter(Boolean);
    if (!participants.some(p=>[p.id,p.pn,p.lid].some(id=>id && ownIds.includes(id)))) fail(409,'bot_not_member','Adicione o chip do robô ao grupo pelo seu celular.');
    const allowed = new Set();
    for (const number of config.allowedNumbers) {
      const pn = number+'@s.whatsapp.net';
      const lid = normalizeJid(await socket.resolveLid?.(pn));
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
    const sent=await socket.sendMessage(group.id,{text});
    if(sent?.key?.id && sent.message) vault.put('outbound', [...vault.get('outbound',[]).filter(m=>m.at>now()-3600000),{id:sent.key.id,group:group.id,message:sent.message,at:now()}].slice(-20));
    return {sent:true};
  }
  async function receive(event) {
    if(event.type!=='notify' || event.requestId || state!=='connected') return;
    const group=selection();if(!group)return;
    for(const message of (event.messages || []).slice(0,20)) {
      const key=message.key || {}, timestamp=Number(message.messageTimestamp)*1000;
      if(key.fromMe || key.remoteJid!==group.id || !key.id || message.requestId || !Number.isFinite(timestamp) || Math.abs(now()-timestamp)>120000) continue;
      const sender=normalizeJid(key.participant);
      const allowed=await members(await metadata(group.id));
      if(!allowed.has(sender)) continue;
      const text=message.message?.conversation ?? message.message?.extendedTextMessage?.text;
      if(typeof text!=='string' || text.length>2000) continue;
      const command=text.trim().toUpperCase();
      if(!/^(STATUS|APROVAR|REJEITAR|EDITAR|STORIES|REELS|PAUSAR|RETOMAR)(?:\s|:|$)/.test(command))continue;
      const receipt=createHash('sha256').update(group.id+'|'+sender+'|'+key.id).digest('hex');
      if(!vault.claim(receipt,now()))continue;
      try {
        await sendGroup(command==='STATUS' ? 'WhatsApp conectado. Grupo autorizado. A busca e a redação ainda não estão ativadas. Publicação bloqueada até a implementação e aprovação humana.' : 'Este comando será ativado no módulo de produção. Nenhuma matéria foi publicada.');
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
          const own=normalizeJid(socket.user?.id);
          if(own!==config.number+'@s.whatsapp.net') {state='wrong_number';vault.put('blocked','wrong_number');closeSocket();record('wrong_number');return;}
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
      connectedAt,lastError,publicationEnabled:false,requiresApproval:true,cycle:'not_implemented',events:vault.get('events',[]).slice(-5)};
  }
  return {
    status,
    health:()=>({ok:state==='connected' && Boolean(selection()),service:'tomezap-whatsapp',whatsapp:state,groupConfigured:Boolean(selection()),publicationEnabled:false,cycle:'not_implemented'}),
    pairing:()=>({...status(),qr:pairingExpires>now()?qr:null,pairingCode:pairingExpires>now()?pairingCode:null,expiresAt:pairingExpires>now()?new Date(pairingExpires).toISOString():null}),
    start:body=>run(async()=>{
      if(!config.configured)fail(503,'awaiting_configuration','Configure o chip dedicado, os editores e o cofre na VPS.');
      if(body?.confirmDedicated!==true)fail(400,'confirmation_required','Confirme que está usando um chip exclusivo para o robô.');
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
