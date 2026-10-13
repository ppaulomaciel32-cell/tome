// Cofre local de uma única instância do painel. O volume e a chave sobrevivem
// à recriação do container. Nenhum token é enviado ao navegador ou ao Redis.
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,chmodSync,existsSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';

const aad=Buffer.from('tomezap-panel-sessions:v1');
const error=()=>Object.assign(new Error('O armazenamento protegido do login está indisponível.'),{status:503,code:'session_storage_unavailable'});
export function openSessionStore(directory) {
  if(!directory)return {sessions:new Map(),save(){}}; // Testes/desenvolvimento sem volume.
  let key, sessions, poisoned=false;
  const file=join(directory,'sessions.enc'), keyFile=join(directory,'key');
  const syncDirectory=()=>{const fd=openSync(directory,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
  try {
    if(!isAbsolute(directory))throw error();
    mkdirSync(directory,{recursive:true,mode:0o700});
    if(!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())throw error();
    chmodSync(directory,0o700);
    if(!existsSync(keyFile)) {
      if(existsSync(file))throw error(); // Nunca substituir uma chave perdida.
      const fd=openSync(keyFile,'wx',0o600);
      try{writeFileSync(fd,randomBytes(32));fsyncSync(fd);}finally{closeSync(fd);}
      syncDirectory();
    }
    if(!lstatSync(keyFile).isFile() || lstatSync(keyFile).isSymbolicLink())throw error();
    chmodSync(keyFile,0o600);key=readFileSync(keyFile);if(key.length!==32)throw error();
    sessions=new Map();
    if(existsSync(file)) {
      if(!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink() || lstatSync(file).size>8*1024*1024)throw error();
      chmodSync(file,0o600);
      const data=readFileSync(file);
      if(data.length<29 || data[0]!==1)throw error();
      const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(1,13));
      decipher.setAAD(aad);decipher.setAuthTag(data.subarray(13,29));
      const rows=JSON.parse(Buffer.concat([decipher.update(data.subarray(29)),decipher.final()]).toString('utf8'));
      if(!Array.isArray(rows) || rows.length>500)throw error();
      for(const [id,s] of rows){
        if(!/^[a-f0-9]{64}$/.test(id) || !s || typeof s.access!=='string' || typeof s.refresh!=='string' || !s.user ||
          !/^[A-Za-z0-9_-]{43}$/.test(s.csrf) || ![s.expires,s.deadline,s.lastSeen].every(Number.isFinite))throw error();
        sessions.set(id,{...s,refreshing:null});
      }
    }
  } catch {throw error();}
  return {sessions,save(){
    if(poisoned)throw error();
    const temporary=join(directory,'.sessions-'+randomBytes(12).toString('hex'));
    try {
      // Promises de renovação existem só em memória, nunca no arquivo.
      const plain=Buffer.from(JSON.stringify([...sessions].map(([id,s])=>{const {refreshing,...data}=s;return [id,data];})));
      if(plain.length>8*1024*1024 || sessions.size>500)throw error();
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
      const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
      const fd=openSync(temporary,'wx',0o600);
      try{writeFileSync(fd,Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),encrypted]));fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temporary,file);syncDirectory();
    } catch {
      poisoned=true; // Falha de gravação nunca é tratada como login persistido.
      try{unlinkSync(temporary);}catch{}
      throw error();
    }
  },assertReady(){if(poisoned)throw error();}};
}
