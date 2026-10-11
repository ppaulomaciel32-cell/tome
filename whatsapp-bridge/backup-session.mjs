// Backup consistente da sessão criptografada, sem interromper o WhatsApp.
// Não acessa Supabase, Radar, Redis ou volumes de outros serviços.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,chmod,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export async function backupSession(directory) {
  const dir=join(directory,'backups');await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
  const stamp=new Date().toISOString().replaceAll(':','-');
  const temp=join(dir,'.partial-'+randomUUID()+'.sqlite'), destination=join(dir,'sessao-'+stamp+'.sqlite');
  const source=new DatabaseSync(join(directory,'session.sqlite'),{readOnly:true});
  try {
    await backup(source,temp);await chmod(temp,0o600);
    const check=new DatabaseSync(temp,{readOnly:true});
    try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('backup_invalid');}finally{check.close();}
    // Link falha se o destino existir: nunca substitui uma cópia anterior.
    await link(temp,destination);await unlink(temp);return destination;
  }finally{source.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  process.umask(0o077);
  try{await backupSession(process.env.WA_SESSION_DIR || '/data/session');console.log('Backup criptografado da sessão concluído.');}
  catch{console.error('Backup da sessão falhou. Confira o volume e o espaço livre.');process.exitCode=1;}
}
