import {createHash,randomUUID} from 'node:crypto';
export const commandUUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const messageDigest=text=>createHash('sha256').update(text.trim()).digest('hex');
// Frases curtas e inteiras; nunca um trecho no meio de uma conversa ou de uma pauta.
const approveWords=/^(?:aprovar|aprova|aprovo|aprovad[oa]|pode\s+(?:publicar|postar|subir)|(?:ok|sim|blz|beleza)[,.!]?\s+pode\s+(?:publicar|postar)|publica(?:r)?|posta(?:r)?|(?:publica|posta)(?:r)?\s+(?:essa|esta|isso|a\s+mat[ée]ria))[\s.!]*$/i;
const rejectWords=/^(?:rejeitar|rejeita|rejeito|rejeitad[oa]|descartar|descarta|n[ãa]o\s+public(?:a|ar|ue)|n[ãa]o\s+post(?:a|ar|e))[\s.!]*$/i;
export function parseManual(text){
  const plain=text.trim();
  const match=plain.match(/^(APROVAR|REJEITAR)\s+#?([a-f0-9-]{36})$/i);
  if(match && commandUUID.test(match[2].toLowerCase()))return {kind:match[1].toUpperCase()==='APROVAR'?'approve':'reject',draftId:match[2].toLowerCase(),revision:1};
  // Número curto da prévia: "APROVAR 12", "aprovar nº 12", "REJEITAR #12".
  const short=plain.match(/^(APROVAR|REJEITAR)\s+(?:n[ºo°.]?\s*)?#?(\d{1,6})[\s.!]*$/i);
  if(short)return {kind:short[1].toUpperCase()==='APROVAR'?'approve':'reject',number:Number(short[2]),revision:1};
  if(approveWords.test(plain))return {kind:'approve',latest:true,revision:1};
  if(rejectWords.test(plain))return {kind:'reject',latest:true,revision:1};
  if(/^(STATUS|APROVAR|REJEITAR|EDITAR|CORRIGIR|STORIES|REELS|PAUSAR|RETOMAR)(?:\s|:|$)/i.test(text))return null;
  const body=text.replace(/^(?:MANCHETE|PAUTA)\s*:\s*/i,'').trim();
  return body.length>=20 && body.length<=4000?{kind:'pauta',text:body}:null;
}
// Registro das prévias enviadas: dá a cada rascunho um número curto para o grupo.
export function previewRegistry(vault,now){
  const list=()=>vault.get('previews',[]).filter(p=>p.at>now()-7*86400000);
  return {
    add(id,titulo){
      const rows=list(),old=rows.find(p=>p.id===id);if(old)return old.n;
      const n=vault.get('previewSeq',0)+1;vault.put('previewSeq',n);
      vault.put('previews',[...rows,{n,id,titulo:String(titulo).slice(0,90),at:now()}].slice(-60));return n;
    },
    number:id=>list().find(p=>p.id===id)?.n ?? null,
    byNumber:n=>list().find(p=>p.n===n) || null,
    open:()=>list().filter(p=>!p.decided && p.at>now()-72*3600000),
    decide(id){const rows=list(),row=rows.find(p=>p.id===id);if(row){row.decided=true;vault.put('previews',rows);}}
  };
}
export function manualQueue(vault,now,fail){
  const list=()=>vault.get('manual:queue',[]);
  return {
    add(command,receipt,editorHash){
      const rows=list().filter(r=>r.state!=='done' || now()-r.created<72*3600000);
      if(rows.some(r=>r.receipt===receipt))return {duplicate:true};
      if(rows.filter(r=>r.state!=='done').length>=30)fail(429,'queue_full','A fila de pautas está cheia. Aguarde a redação.');
      const job={id:randomUUID(),...command,receipt,editorHash,state:'queued',created:now()};rows.push(job);
      const active=rows.filter(r=>r.state!=='done');
      const retained=[...rows.filter(r=>r.state==='done').slice(-(80-active.length)),...active].sort((a,b)=>a.created-b.created);
      const inserted=vault.claimAndPut(receipt,now(),'manual:queue',retained,72*3600000);
      return inserted?{job}:{duplicate:true};
    },
    claim(){
      const rows=list(),job=rows.find(r=>r.state==='queued' || r.state==='processing' && r.until<now());
      if(!job)return null;
      job.state='processing';job.lease=randomUUID();job.until=now()+15*60000;vault.put('manual:queue',rows);return {...job};
    },
    finish(body){
      const rows=list(),job=rows.find(r=>r.id===body.id);
      if(!job || job.lease!==body.lease)fail(409,'invalid_lease','Pedido não pertence a esta execução.');
      if(job.state==='done')return {duplicate:true,job};
      job.state='done';job.code=body.code;job.finished=now();job.draftId=body.draftId || job.draftId;
      vault.put('manual:queue',rows);return {job};
    },
    status(){const rows=list();return {queued:rows.filter(r=>r.state==='queued').length,processing:rows.filter(r=>r.state==='processing').length,lastCode:rows.at(-1)?.code || null};}
    ,publication(body){
      const rows=list(),job=rows.find(r=>r.id===body.id && r.kind==='approve' && r.draftId===body.draftId);
      if(!job || job.state!=='done' || !['publication_pending','live'].includes(job.code))fail(409,'approval_required','Publicação sem aprovação registrada na ponte.');
      if(job.code==='live')return {duplicate:true};
      job.code='live';vault.put('manual:queue',rows);return {ok:true};
    }
  };
}
