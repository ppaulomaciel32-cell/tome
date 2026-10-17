import {createHash,createHmac} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const digest=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>String(s).replace(/[\r\n\x00-\x1f<>]/g,' ').trim();
const secureURL=value=>{try{const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.hash && !u.port && /[a-z]/i.test(u.hostname) && !u.hostname.includes(':') && u.hostname.includes('.') && value.length<=1500;}catch{return false;}};
const triggers=new Set(['curiosidade-concreta','espanto','identidade-local','utilidade','prova-social','nostalgia','historia-humana','contraste']);
export function parseViral(text){
  const scan=text.trim().match(/^RADAR(?:\s+([^\n]{2,80}))?$/i);
  if(scan && !/^(APROVAR|REJEITAR|CORRIGIR)\b/i.test(scan[1] || ''))return {kind:'scan',city:scan[1]?.trim() || null};
  const m=text.trim().match(/^(?:RADAR\s+)?(APROVAR|REJEITAR|CORRIGIR)\s+#?R(\d{1,9})(?:\s*[:\-]\s*([^]{1,1000}))?$/i);
  if(!m)return null;
  const action={APROVAR:'approve',REJEITAR:'reject',CORRIGIR:'correct'}[m[1].toUpperCase()];
  if(action==='correct' && !m[3])return null;
  return {kind:'decision',action,number:Number(m[2]),instruction:m[3]?.trim() || ''};
}
export const proof=p=>JSON.stringify({namespace:'tnn-viral',action:p.action,proposal_id:p.id,revision:p.revision,receipt:p.receipt,editor_hash:p.editorHash,title_index:p.titleIndex??0,instruction:p.instruction??''});
export function createViral({config,vault,manual,sendGroup,fail,now,fetchImpl=fetch}){
  const enabled=()=>config.radarEnabled===true;
  async function request(path,body){
    if(!enabled())fail(503,'radar_disabled','Radar Viral desligado.');
    try{
      const r=await fetchImpl('http://radar-viral:3092'+path,{method:body?'POST':'GET',headers:{'x-pipeline-token':config.pipelineToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(2500)});
      const data=await r.json();if(!r.ok)fail(503,'radar_unavailable','Radar indisponível. O restante da redação foi preservado.');return data;
    }catch(error){if(error.code==='radar_disabled')throw error;fail(503,'radar_unavailable','Radar indisponível. O restante da redação foi preservado.');}
  }
  const registry=()=>vault.get('viral:proposals',[]).filter(x=>x.at>now()-4*86400000);
  async function decide(p,receipt,editorHash){
    const row=registry().find(r=>p.id?r.id===p.id:r.numero===p.number);
    if(!row || !row.ready)fail(409,'radar_no_preview','Aguarde a prévia dessa pauta no grupo.');
    if(row.decided && row.receipt!==receipt)fail(409,'radar_already_decided','Essa versão já foi decidida. Aguarde a nova prévia.');
    if(p.revision!==undefined && p.revision!==row.revisao)fail(409,'radar_stale','A pauta mudou. Atualize a lista antes de decidir.');
    if(!config.editorialSigningKey)fail(503,'awaiting_configuration','A assinatura editorial ainda precisa ser configurada.');
    const body={action:p.action,id:row.id,revision:row.revisao,receipt,editorHash,titleIndex:p.titleIndex??0,instruction:p.instruction || ''};
    body.signature=createHmac('sha256',config.editorialSigningKey).update(proof(body)).digest('hex');
    const result=await request('/decision',body);
    if(result.queued || result.duplicate){
      const rows=registry(),entry=rows.find(r=>r.id===row.id);entry.decided=true;entry.receipt=receipt;vault.put('viral:proposals',rows);
      if(p.action==='approve')vault.put('viral:approved:'+row.id+':'+row.revisao+':'+receipt,{editorHash,title:row.titulos[body.titleIndex],url:row.fonte_url,angle:row.angulo,trigger:row.gatilho});
    }
    return result;
  }
  return {
    async receive({text,receipt,editorHash}){
      const p=parseViral(text);if(!p)return false;
      if(!enabled())return true; // Sem rede/log/produção quando desligado.
      if(vault.get('viral:received:'+receipt))return true;
      vault.put('viral:received:'+receipt,true);
      try{
        if(p.kind==='scan'){
          const r=await request('/start',{city:p.city,receipt});
          await sendGroup(r.busy?'Já estou varrendo, os resultados vão chegar.':r.duplicate?'Essa varredura já foi recebida.':'Radar rodando para '+clean(p.city || 'a região')+'... volto com as pautas.');
        }else{
          await decide(p,receipt,editorHash);
          await sendGroup(p.action==='approve'?'Sugestão R'+p.number+' encaminhada para a redação. O texto final ainda precisa de aprovação e foto real.':'Decisão recebida para R'+p.number+'.');
        }
      }catch(error){await sendGroup(['radar_no_preview','radar_already_decided','radar_stale'].includes(error.code)?error.message:'Radar indisponível ou aguardando configuração. A redação normal continua funcionando.');}
      return true;
    },
    state:()=>request('/state'),
    async panel(body){
      if(!enabled())fail(503,'radar_disabled','Radar Viral desligado.');
      if(!hash.test(body?.actor || '') || !uuid.test(body?.nonce || ''))fail(400,'invalid_decision','Pedido inválido.');
      const receipt=digest('viral-painel|'+body.actor+'|'+body.nonce),editorHash=digest('painel:'+body.actor);
      if(body.kind==='scan')return request('/start',{city:body.city || null,receipt});
      if(!['approve','reject','correct'].includes(body.action) || !uuid.test(body.id || '') || !Number.isInteger(body.revision) || !Number.isInteger(body.titleIndex??0) || (body.titleIndex??0)<0 || (body.titleIndex??0)>2 || typeof (body.instruction??'')!=='string' || (body.instruction || '').length>1000)fail(400,'invalid_decision','Decisão inválida.');
      return decide(body,receipt,editorHash);
    },
    async preview(body){
      if(!enabled())fail(503,'radar_disabled','Radar Viral desligado.');
      if(!uuid.test(body?.runId || '') || !['manha','tarde','noite','demanda'].includes(body.turno) || !Array.isArray(body.items) || body.items.length<1 || body.items.length>3)fail(400,'invalid_radar_preview','Prévia inválida.');
      for(const p of body.items){
        if(!uuid.test(p.id || '') || !Number.isSafeInteger(p.numero) || p.numero<1 || !Number.isInteger(p.revisao) || p.revisao<1 || !triggers.has(p.gatilho) || !Array.isArray(p.titulos) || p.titulos.length!==3 || p.titulos.some(t=>typeof t!=='string' || t.length>180 || t.trim().split(/\s+/).length>12) || !secureURL(p.fonte_url) || !Number.isInteger(p.potencial) || p.potencial<7 || p.potencial>10 || ['hook','angulo','cidade','score_justificativa'].some(k=>typeof p[k]!=='string' || p[k].length>500))fail(400,'invalid_radar_preview','Pauta inválida.');
      }
      const key='viral:delivery:'+body.runId;if(vault.get(key)==='sent')return {sent:true,duplicate:true};
      if(vault.get(key))fail(409,'delivery_uncertain','O envio desta prévia ficou incerto. Confira o grupo antes de reenviar.');
      vault.put(key,'claimed');
      const rows=registry();for(const p of body.items){const old=rows.findIndex(r=>r.id===p.id);if(old>=0)rows.splice(old,1);rows.push({...p,at:now(),ready:false});}vault.put('viral:proposals',rows.slice(-80));
      const parts=body.items.map(p=>'PAUTA R'+p.numero+' · revisão '+p.revisao+'\n🎯 GATILHO: '+p.gatilho+'\n📰 TÍTULOS:\n'+p.titulos.map((t,i)=>(i+1)+'. '+clean(t)).join('\n')+'\n🪝 HOOK: '+clean(p.hook)+'\n🧭 ÂNGULO: '+clean(p.angulo)+'\n🏙 CIDADE: '+clean(p.cidade)+'\n🔗 FONTE: '+p.fonte_url+'\n💰 POTENCIAL: '+p.potencial+'/10 (estimativa editorial) — '+clean(p.score_justificativa)+'\nAPROVAR R'+p.numero+' / REJEITAR R'+p.numero+' / CORRIGIR R'+p.numero+': instrução');
      await sendGroup(parts.join('\n---\n')+'\n— Radar Viral · turno '+body.turno.toUpperCase()+' · '+body.items.length+' pautas · '+new Date(now()).toLocaleTimeString('pt-BR',{timeZone:'America/Fortaleza',hour:'2-digit',minute:'2-digit'})+'\nAprovar sugestão não publica. Revise e aprove o texto final depois, com foto real.');
      const ready=registry();for(const p of body.items){const row=ready.find(r=>r.id===p.id);if(row)row.ready=true;}vault.put('viral:proposals',ready);vault.put(key,'sent');return {sent:true};
    },
    async handoff(body){
      if(!enabled())fail(503,'radar_disabled','Radar Viral desligado.');
      if(!config.manualEnabled)fail(503,'manual_disabled','Ative a redação manual antes de encaminhar pautas.');
      if(!uuid.test(body?.id || '') || !hash.test(body.receipt || '') || !Number.isInteger(body.revision))fail(400,'invalid_handoff','Pedido inválido.');
      const approval=vault.get('viral:approved:'+body.id+':'+body.revision+':'+body.receipt,null);
      if(!approval)fail(403,'human_decision_required','A sugestão ainda não foi aprovada por um editor.');
      const key='viral:handoff:'+body.id+':'+body.revision,old=vault.get(key,null);if(old)return old;
      const receipt=digest('viral-handoff|'+body.id+'|'+body.revision+'|'+body.receipt);
      const text='PAUTA: '+approval.title+'\nRecorte sugerido (conferir na fonte): '+approval.angle+'\nGatilho editorial sugerido, sem distorcer fatos: '+approval.trigger+'\nFonte: '+approval.url;
      const added=manual.add({kind:'pauta',text,viralProposalId:body.id,viralTrigger:approval.trigger},receipt,approval.editorHash);
      const job=added.job || manual.find(receipt);
      if(!job)fail(409,'handoff_uncertain','Encaminhamento já tentado. Confira a fila.');
      const link={namespace:'tnn-viral-handoff',id:body.id,revision:body.revision,receipt:body.receipt,job_id:job.id};
      const result={jobId:job.id,revision:body.revision,receipt:body.receipt,signature:createHmac('sha256',config.editorialSigningKey).update(JSON.stringify(link)).digest('hex')};vault.put(key,result);
      await sendGroup('Sugestão encaminhada para a redação. Aguarde o rascunho. Nada foi publicado; a foto real e a aprovação final continuam obrigatórias.');return result;
    },
    async notice(body){
      if(!enabled())fail(503,'radar_disabled','Radar Viral desligado.');
      const labels={expired:'A fonte desta sugestão passou de 24 horas. Pauta expirada; peça uma nova varredura.',rejected:'Sugestão rejeitada. Nada publicado.',conflict:'A sugestão já mudou ou foi decidida. Atualize a lista.',correction_failed:'Não consegui corrigir esta sugestão. Confira a fonte e tente novamente.'};
      if(!uuid.test(body?.id || '') || !hash.test(body.receipt || '') || !labels[body.code])fail(400,'invalid_notice','Aviso inválido.');
      const key='viral:notice:'+body.receipt+':'+body.code;if(vault.get(key))return {duplicate:true};vault.put(key,'claimed');
      if(body.code==='correction_failed'){const rows=registry(),row=rows.find(r=>r.id===body.id);if(row)row.decided=false;vault.put('viral:proposals',rows);}
      await sendGroup(labels[body.code]);vault.put(key,'sent');return {sent:true};
    }
  };
}
