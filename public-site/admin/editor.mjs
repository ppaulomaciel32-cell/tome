const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locals={'sao-goncalo':'São Gonçalo',pecem:'Pecém',taiba:'Taíba',croata:'Croatá',paracuru:'Paracuru',regiao:'Região'};
export function mountEditor(box,{id,draft,request}){
  const section=document.createElement('section');section.className='editor-tools';
  section.innerHTML=`<details class="draft-edit"><summary>Editar o texto diretamente</summary><p>O texto será mantido como você escreveu. Confira os fatos e as fontes: os trechos de referência ajudam na revisão, mas não certificam as alterações. Salvar cria outra prévia; será preciso aprovar novamente.</p>
    <label>Manchete<input data-field="titulo" maxlength="300" value="${esc(draft.titulo)}"></label>
    <label>Resumo<textarea data-field="resumo" maxlength="500" rows="3">${esc(draft.resumo)}</textarea></label>
    <label>Texto completo<textarea data-field="texto" maxlength="20000" rows="16">${esc(draft.texto)}</textarea></label>
    <p>4 a 12 parágrafos; 150–500 palavras com fonte única, 300–500 com múltiplas fontes.</p>
    <label>Localidade<select data-field="localidade">${Object.entries(locals).map(([key,name])=>`<option value="${key}"${key===draft.localidade?' selected':''}>${name}</option>`).join('')}</select></label>
    <button class="button ghost" data-editor="direct">Salvar e gerar nova prévia</button></details>
    <details class="draft-edit"><summary>Enviar foto de capa</summary><p>Use uma foto sua ou que você tem autorização para publicar. JPG, PNG ou WebP, até 20 MB. O sistema remove metadados e localização.</p><label>Foto<input type="file" accept="image/jpeg,image/png,image/webp" data-photo></label><label>Crédito da foto<input data-credit maxlength="120" placeholder="Nome do fotógrafo / instituição"></label><button class="button ghost" data-editor="photo">Preparar capa e nova prévia</button></details>
    <details class="draft-edit"><summary>Aprovar e agendar publicação</summary><p>Escolha o horário de Fortaleza (UTC−3). Esta ação aprova o texto atual. O servidor precisa permanecer ligado; se ficar indisponível, publica ao voltar.</p><label>Data e hora em Fortaleza<input type="datetime-local" data-schedule></label><button class="button primary" data-editor="schedule">Aprovar e agendar</button></details>
    <p role="status" data-editor-status aria-live="polite"></p>`;
  box.append(section);const status=section.querySelector('[data-editor-status]');
  section.querySelectorAll('[data-editor]').forEach(button=>button.addEventListener('click',async()=>{
    let body={kind:'edit',nonce:crypto.randomUUID()},action=button.dataset.editor;
    try{
      if(action==='direct')body={...body,mode:'direct',fields:Object.fromEntries([...section.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value.trim()]))};
      if(action==='photo'){
        const file=section.querySelector('[data-photo]').files[0],credit=section.querySelector('[data-credit]').value.trim();
        if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>20*1024*1024 || credit.length<2)throw Error('Escolha uma foto de até 20 MB e informe o crédito.');
        const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Não foi possível ler a foto.'));reader.readAsDataURL(file);});
        body={...body,mode:'photo',image,credit};
      }
      if(action==='schedule'){
        const raw=section.querySelector('[data-schedule]').value;
        if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))throw Error('Escolha a data e a hora.');
        const at=new Date(raw+':00-03:00');
        if(at.valueOf()<Date.now()+60000 || at.valueOf()>Date.now()+30*86400000)throw Error('Agende entre 1 minuto e 30 dias a partir de agora.');
        if(!window.confirm('Aprovar o texto final e publicar em '+raw.replace('T',' às ')+' (Fortaleza)?'))return;
        body={kind:'approve',nonce:body.nonce,scheduledAt:at.toISOString()};
      }
      box.querySelectorAll('button').forEach(el=>el.disabled=true);status.textContent='Enviando…';
      const result=await request('/drafts/'+id+'/decision',body);
      status.textContent=result.scheduledAt?'Aprovado e agendado. Confira o horário na lista de rascunhos.':'Alteração enviada. Aguarde a nova prévia no grupo e confira o texto antes de aprovar.';
    }catch(error){status.textContent=error.message || 'Falha ao enviar. Tente novamente.';box.querySelectorAll('button').forEach(el=>el.disabled=false);}
  }));
}
export function scheduledHTML(rows){return rows.length?'<section class="empty-card"><h2>Publicações agendadas</h2>'+rows.map(row=>`<p>${esc(new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(new Date(row.at)))} · Fortaleza <button class="button ghost" data-cancel-schedule="${esc(row.draftId)}">Cancelar agendamento</button></p>`).join('')+'</section>':'';}
export function mountSchedules(main,request){main.querySelectorAll('[data-cancel-schedule]').forEach(button=>button.addEventListener('click',async()=>{if(!window.confirm('Cancelar a publicação agendada? A matéria volta para revisão.'))return;button.disabled=true;try{await request('/drafts/'+button.dataset.cancelSchedule+'/decision',{kind:'cancel',nonce:crypto.randomUUID()});button.textContent='Cancelado — atualize a lista';}catch(e){button.textContent=e.message;button.disabled=false;}}));}
