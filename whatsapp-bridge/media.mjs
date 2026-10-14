// Fotos recebidas no grupo ficam aqui só até a redação buscar; nunca são servidas ao público.
import {mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,statSync,renameSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
const receiptPattern=/^[a-f0-9]{64}$/;
export const MAX_MEDIA=25*1024*1024;
export const mediaTypes=['image/jpeg','image/png','image/webp'];
// Assinatura do arquivo: o tipo declarado pelo remetente não é prova.
export function sniff(buffer){
  if(!Buffer.isBuffer(buffer) || buffer.length<12)return null;
  if(buffer[0]===0xff && buffer[1]===0xd8 && buffer[2]===0xff)return 'image/jpeg';
  if(buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
  if(buffer.subarray(0,4).toString('latin1')==='RIFF' && buffer.subarray(8,12).toString('latin1')==='WEBP')return 'image/webp';
  return null;
}
export function openMediaStore(directory,now=Date.now){
  if(!directory)return null;
  try{mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);}catch{return null;}
  const file=id=>{if(!receiptPattern.test(id || ''))throw Error('Identificador de mídia inválido.');return join(directory,id+'.img');};
  const sweep=()=>{
    try{for(const name of readdirSync(directory)){const path=join(directory,name);if(now()-statSync(path).mtimeMs>72*3600000)rmSync(path,{force:true});}}catch{}
  };
  return {
    put(id,buffer){
      if(!sniff(buffer) || buffer.length>MAX_MEDIA)throw Error('Mídia inválida.');
      sweep();const target=file(id),partial=target+'.tmp';
      writeFileSync(partial,buffer,{mode:0o600});renameSync(partial,target);
    },
    get(id){try{return readFileSync(file(id));}catch{return null;}},
    remove(id){try{rmSync(file(id),{force:true});}catch{}},
    sweep
  };
}
