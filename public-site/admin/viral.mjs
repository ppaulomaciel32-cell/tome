const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=s=>{try{const u=new URL(s);return u.protocol==='https:' && !u.username && !u.password?u.href:null;}catch{return null;}};
export function viralHTML(data={}){
 const rows=(data.items || []).filter(p=>['pending','approved'].includes(p.status));
 return `<div class="page-heading"><div><p class="eyebrow">DESCOBERTA ANTES DA REDAÇÃO</p><h1>Pautas Radar.</h1><p>Sugestões privadas. Potencial é uma estimativa editorial, não audiência medida.</p></div></div>
 <section class="help-banner"><p>Aprovar a sugestão só encaminha para a redação. O texto final exige outra aprovação e foto real.</p><label>Município ou distrito (vazio = região)<input data-radar-city maxlength="80" placeholder="Ex.: Caucaia"></label><button class="button primary" data-radar-scan>Buscar pautas</button><p role="status" data-radar-status></p></section>
 ${rows.length?'<div class="draft-grid">'+rows.map(p=>{const url=safeURL(p.fonte_url);return `<article class="draft-card" data-viral-id="${esc(p.id)}" data-revision="${esc(p.revisao)}"><p class="eyebrow">R${esc(p.numero)} · ${esc(p.cidade)} · ${esc(p.turno)}</p><p>${esc(p.gatilho)} · Potencial ${esc(p.potencial)}/10</p><p>${esc(p.score_justificativa)}</p><h2>Títulos sugeridos</h2><ol>${p.titulos.map(t=>'<li>'+esc(t)+'</li>').join('')}</ol><p><strong>Gancho:</strong> ${esc(p.hook)}</p><p><strong>Ângulo:</strong> ${esc(p.angulo)}</p>${url?'<a class="text-link" target="_blank" rel="noopener noreferrer" href="'+esc(url)+'">Conferir fonte</a>':''}<p>Fonte: ${esc(p.fonte_titulo)}</p><p>Estado: ${p.status==='approved'?'Encaminhada à redação':'Aguardando decisão'} · revisão ${esc(p.revisao)}</p>${p.status==='pending'?`<label>Título escolhido<select data-title-index>${p.titulos.map((t,i)=>'<option value="'+i+'">'+esc((i+1)+'. '+t)+'</option>').join('')}</select></label><div class="draft-action-row"><button class="button primary" data-viral-action="approve">Aprovar sugestão</button><button class="button ghost" data-viral-action="reject">Rejeitar</button></div><label>Correção ou motivo<textarea data-viral-instruction maxlength="1000" rows="3"></textarea></label><button class="button ghost" data-viral-action="correct">Corrigir sugestão</button>`:''}<p role="status" data-viral-status></p></article>`;}).join('')+'</div>':'<section class="empty-card"><h2>Nenhuma sugestão pendente.</h2><p>Os turnos são 06:30, 12:00 e 18:30, no horário de Fortaleza, quando o serviço estiver habilitado.</p></section>'}`;
}
export function mountViral(main,{request,onAuthError=()=>{},preview=false}){
 let active=true;
 if(preview){main.innerHTML=viralHTML();main.querySelector('[data-radar-scan]').disabled=true;return()=>{active=false;};}
 const load=()=>request('/radar').then(data=>{
   if(!active)return;main.innerHTML=viralHTML(data);
   const status=main.querySelector('[data-radar-status]');
   main.querySelector('[data-radar-scan]').addEventListener('click',async event=>{event.target.disabled=true;try{const r=await request('/radar',{kind:'scan',city:main.querySelector('[data-radar-city]').value.trim(),nonce:crypto.randomUUID()});status.textContent=r.busy?'Já estou varrendo; os resultados vão chegar.':'Radar rodando. Atualize esta aba em alguns minutos para conferir as sugestões.';}catch(e){status.textContent=e.message;}finally{event.target.disabled=false;}});
   main.querySelectorAll('[data-viral-action]').forEach(button=>button.addEventListener('click',async()=>{
     const box=button.closest('[data-viral-id]'),action=button.dataset.viralAction,notice=box.querySelector('[data-viral-status]'),instruction=box.querySelector('[data-viral-instruction]').value.trim();
     if(action==='correct' && instruction.length<3){notice.textContent='Escreva o que precisa mudar.';return;}
     if(action==='approve' && !window.confirm('Encaminhar esta sugestão à redação? Você ainda vai revisar e aprovar o texto final, com foto real.'))return;
     box.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{await request('/radar',{kind:'decision',action,id:box.dataset.viralId,revision:Number(box.dataset.revision),titleIndex:Number(box.querySelector('[data-title-index]').value),instruction,nonce:crypto.randomUUID()});notice.textContent=action==='approve'?'Sugestão encaminhada. Aguarde o rascunho para revisão final.':'Decisão recebida. A atualização chega no grupo; atualize a lista depois.';}
     catch(e){notice.textContent=e.message;box.querySelectorAll('button').forEach(b=>b.disabled=false);}
   }));
 }).catch(e=>{if(!active)return;if(e.status===401)onAuthError(e);main.innerHTML='<h1>Pautas Radar.</h1><section class="empty-card"><h2>Radar desligado ou aguardando conexão.</h2><p>'+esc(e.message)+'</p><p>A redação e o WhatsApp continuam funcionando pelo fluxo habitual.</p></section>';});
 main.innerHTML='<h1>Pautas Radar.</h1><p role="status">Consultando…</p>';load();return()=>{active=false;};
}
