import makeWASocket, {BufferJSON, initAuthCreds, proto, makeCacheableSignalKeyStore, Browsers} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
export {BufferJSON, initAuthCreds};
export const reviveAppState = value=>proto.Message.AppStateSyncKeyData.fromObject(value);
export const qrEncoder = value=>QRCode.toDataURL(value,{width:320,margin:4,errorCorrectionLevel:'M'});

export function socketFactory({auth,onUpdate,onCreds,onMessages,onGroupsChanged,getMessage,cachedGroupMetadata}) {
  // O logger do provedor nunca recebe uma saída: QR, chaves e conteúdo não vão aos logs.
  const logger = pino({level:'silent'});
  const sock = makeWASocket({
    auth:{creds:auth.state.creds,keys:makeCacheableSignalKeyStore(auth.state.keys,logger)},
    logger,browser:Browsers.ubuntu('Chrome'),markOnlineOnConnect:false,
    syncFullHistory:false,shouldSyncHistoryMessage:()=>false,
    shouldIgnoreJid:jid=>jid.endsWith('@broadcast') || jid.endsWith('@newsletter'),
    connectTimeoutMs:20000,defaultQueryTimeoutMs:10000,keepAliveIntervalMs:25000,
    getMessage,cachedGroupMetadata
  });
  sock.ev.on('connection.update',onUpdate);sock.ev.on('creds.update',onCreds);sock.ev.on('messages.upsert',onMessages);
  sock.ev.on('group-participants.update',onGroupsChanged);sock.ev.on('groups.update',onGroupsChanged);
  return {
    get user(){return sock.user;},
    groupMetadata:id=>sock.groupMetadata(id),
    groupFetchAllParticipating:()=>sock.groupFetchAllParticipating(),
    resolveLid:pn=>sock.signalRepository.lidMapping.getLIDForPN(pn),
    sendMessage:(id,message)=>sock.sendMessage(id,message),
    requestPairingCode:number=>sock.requestPairingCode(number),
    end:()=>{sock.ev.removeAllListeners('connection.update');sock.ev.removeAllListeners('messages.upsert');sock.ev.removeAllListeners('creds.update');sock.ev.removeAllListeners('group-participants.update');sock.ev.removeAllListeners('groups.update');sock.end(undefined);}
  };
}
