import {createHash,randomUUID} from 'node:crypto';
export const commandUUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const messageDigest=text=>createHash('sha256').update(text.trim()).digest('hex');
export function parseManual(text){
  const match=text.trim().match(/^(APROVAR|REJEITAR)\s+#?([a-f0-9-]{36})$/i);
  if(match && commandUUID.test(match[2]))return {kind:match[1].toUpperCase()==='APROVAR'?'approve':'reject',draftId:match[2],revision:1};
  if(/^(STATUS|APROVAR|REJEITAR|EDITAR|CORRIGIR|STORIES|REELS|PAUSAR|RETOMAR)(?:\s|:|$)/i.test(text))return null;
  const body=text.replace(/^(?:MANCHETE|PAUTA)\s*:\s*/i,'').trim();
  return body.length>=20 && body.length<=4000?{kind:'pauta',text:body}:null;
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
