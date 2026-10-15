import {createHash,randomUUID} from 'node:crypto';
export const commandUUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const messageDigest=text=>createHash('sha256').update(text.trim()).digest('hex');
// Frases curtas e inteiras; nunca um trecho no meio de uma conversa ou de uma pauta.
const approveWords=/^(?:aprovar|aprova|aprovo|aprovad[oa]|pode\s+(?:publicar|postar|subir)|(?:ok|sim|blz|beleza)[,.!]?\s+pode\s+(?:publicar|postar)|publica(?:r)?|posta(?:r)?|(?:publica|posta)(?:r)?\s+(?:essa|esta|isso|a\s+mat[ée]ria))[\s.!]*$/i;
const rejectWords=/^(?:rejeitar|rejeita|rejeito|rejeitad[oa]|descartar|descarta|n[ãa]o\s+public(?:a|ar|ue)|n[ãa]o\s+post(?:a|ar|e))[\s.!]*$/i;
export function parseManual(text){
  const plain=text.trim();
  const timed=plain.match(/^AGENDAR\s+#?(\d{1,6})\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/i);
  if(timed){const at=Date.parse(timed[2]+'T'+timed[3]+':00-03:00');return Number.isFinite(at)?{kind:'approve',number:Number(timed[1]),revision:1,notBefore:at}:null;}
  const cancel=plain.match(/^CANCELAR\s+#?(\d{1,6})$/i);
  if(cancel)return {kind:'cancel',number:Number(cancel[1])};
  const match=plain.match(/^(APROVAR|REJEITAR)\s+#?([a-f0-9-]{36})$/i);
  if(match && commandUUID.test(match[2].toLowerCase()))return {kind:match[1].toUpperCase()==='APROVAR'?'approve':'reject',draftId:match[2].toLowerCase(),revision:1};
  // Número curto da prévia: "APROVAR 12", "aprovar nº 12", "REJEITAR #12".
  const short=plain.match(/^(APROVAR|REJEITAR)\s+(?:n[ºo°.]?\s*)?#?(\d{1,6})[\s.!]*$/i);
  if(short)return {kind:short[1].toUpperCase()==='APROVAR'?'approve':'reject',number:Number(short[2]),revision:1};
  // Correção antes de aprovar: "CORRIGIR 12: tire o último parágrafo", "MANCHETE 12: nova manchete".
  const edit=plain.match(/^(CORRIGIR|CORRIGE|CORRIJA|EDITAR|EDITA|AJUSTAR|AJUSTA|MANCHETE|T[ÍI]TULO)\s+(?:n[ºo°.]?\s*)?#?(\d{1,6})\s*[:\-–—]?\s+([^]{5,1500})$/i)
    || plain.match(/^(CORRIGIR|CORRIGE|CORRIJA|EDITAR|EDITA|AJUSTAR|AJUSTA)()\s*[:\-–—]\s*([^]{5,1500})$/i);
  if(edit)return {kind:'edit',mode:/^(MANCHETE|T[ÍI]TULO)$/i.test(edit[1])?'title':'fix',text:edit[3].trim(),...(edit[2]?{number:Number(edit[2])}:{latest:true}),revision:1};
  const retitle=plain.match(/^(?:troca|trocar|troque|muda|mudar|mude|altera|alterar|altere)\s+(?:o\s+t[íi]tulo|a\s+manchete)\s+(?:para|por)\s*:?\s*([^]{5,300})$/i);
  if(retitle)return {kind:'edit',mode:'title',text:retitle[1].trim(),latest:true,revision:1};
  if(approveWords.test(plain))return {kind:'approve',latest:true,revision:1};
  if(rejectWords.test(plain))return {kind:'reject',latest:true,revision:1};
  if(/^(STATUS|APROVAR|REJEITAR|EDITAR|CORRIGIR|STORIES|REELS|PAUSAR|RETOMAR|AGENDAR|CANCELAR)(?:\s|:|$)/i.test(text))return null;
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
    decide(id){const rows=list(),row=rows.find(p=>p.id===id);if(row){row.decided=true;vault.put('previews',rows);}},
    reopen(id){const rows=list(),row=rows.find(p=>p.id===id);if(row){delete row.decided;vault.put('previews',rows);}}
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
      const rows=list(),job=rows.find(r=>(r.state==='queued' && (!r.notBefore || r.notBefore<=now())) || r.state==='processing' && r.until<now());
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
    scheduled(){return list().filter(r=>r.state==='queued' && r.notBefore>now()).map(r=>({id:r.id,draftId:r.draftId,at:new Date(r.notBefore).toISOString()}));},
    cancel(draftId){const rows=list(),job=rows.find(r=>r.draftId===draftId && r.state==='queued' && r.notBefore>now());if(!job)fail(409,'already_decided','Agendamento não encontrado ou já em execução.');job.state='done';job.code='cancelled';vault.put('manual:queue',rows);return {cancelled:true};},
    status(){const rows=list(),day=new Date(now()-3*3600000).toISOString().slice(0,10);return {queued:rows.filter(r=>r.state==='queued').length,processing:rows.filter(r=>r.state==='processing').length,lastCode:rows.at(-1)?.code || null,
      // Dia contado no horário de Fortaleza (UTC-3).
      publishedToday:rows.filter(r=>r.kind==='approve' && ['live','publication_pending'].includes(r.code) && new Date((r.finished || 0)-3*3600000).toISOString().slice(0,10)===day).length};}
    ,publication(body){
      const rows=list(),job=rows.find(r=>r.id===body.id && r.kind==='approve' && r.draftId===body.draftId);
      if(!job || job.state!=='done' || !['publication_pending','live'].includes(job.code))fail(409,'approval_required','Publicação sem aprovação registrada na ponte.');
      if(job.code==='live')return {duplicate:true};
      job.code='live';vault.put('manual:queue',rows);return {ok:true};
    }
  };
}
