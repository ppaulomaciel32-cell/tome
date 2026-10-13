// A animação representa um estado observado. Ela nunca executa o pipeline.
const opsEscape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const opsNames={whatsapp:'Recepção · WhatsApp',coleta:'Apuração · fontes',redacao:'Redator · Gemini',revisao:'Mesa de revisão',publicacao:'Publicador',site:'Jornal · leitores'};
const opsLabels={ready:'Conectado',working:'Trabalhando',waiting:'Aguardando',blocked:'Bloqueado',unknown:'Sem confirmação'};
const opsStages={coleta:'Apuração de fontes',redacao:'Redação Gemini',rascunho:'Salvar rascunho',previa:'Enviar prévia',fim:'Encerrar ciclo'};
const opsCycleLabels={running:'Em andamento',completed:'Concluído',skipped:'Sem nova matéria',failed:'Falhou',queue_full:'Fila cheia',awaiting_configuration:'Aguardando configuração',not_implemented:'Não ativado'};
const opsDescriptions={whatsapp:'Recebe a conexão e os comandos autorizados do grupo.',coleta:'Busca pautas nas fontes aprovadas e confere a informação.',redacao:'Transforma fontes em um rascunho, sem inventar fatos.',revisao:'Guarda o texto privado para você conferir.',publicacao:'Precisa da aprovação humana e da integração com o site.',site:'O jornal público onde a notícia deve aparecer depois do deploy.'};
const opsAvatar=kind=>`<span class="ops-avatar avatar-${kind}" aria-hidden="true"><i class="ops-hair"></i><i class="ops-face"></i><i class="ops-shirt"></i><i class="ops-arm"></i><i class="ops-leg"></i></span>`;
export function operationsHTML(data={}) {
  const demo=data.mode==='demo',failed=data.mode==='unavailable';
  const stations=Object.keys(opsNames).map(id=>{
    const raw=data.stations?.find(s=>s.id===id);
    return {id,state:Object.hasOwn(opsLabels,raw?.state)?raw.state:'unknown',detail:raw?.detail || 'Esta etapa ainda não foi consultada.'};
  });
  const time=value=>{try{return Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(value)):'—';}catch{return '—';}};
  const working=stations.find(s=>s.state==='working');
  return `<div class="page-heading ops-heading"><div><p class="eyebrow">SALA DE OPERAÇÕES · TOMEZAP</p><h1>Veja sua redação por dentro.</h1><p>Cada personagem representa uma etapa. Toque na mesa para entender o que ela está fazendo.</p></div><button class="button primary" data-ops-refresh>Atualizar agora ↻</button></div>
    <div class="ops-signal ${failed?'signal-error':''}" role="status"><span class="ops-signal-dot"></span><strong>${demo?'DEMONSTRAÇÃO · NÃO É ATIVIDADE REAL':failed?'CONEXÃO INDISPONÍVEL':'MONITOR SOMENTE-LEITURA'}</strong><span>${demo?'Exemplo do visual; nenhum serviço está sendo consultado.':failed?'Os estados anteriores foram descartados. Nenhuma atividade pode ser confirmada.':data.observedAt?'Consulta às '+time(data.observedAt)+' · atualização a cada 15 s':'Consultando os serviços com a sua sessão…'}</span></div>
    <div class="ops-layout"><section class="ops-office" aria-label="Mapa das etapas da redação"><div class="ops-office-top"><span class="ops-mini-brand">tn<span>REDAÇÃO</span></span><span class="ops-office-caption">${demo?'MODO DEMO':'ACOMPANHAMENTO'}</span></div><div class="ops-floor">${stations.map((s,i)=>`<button class="ops-station state-${s.state}" data-ops-station="${s.id}" aria-label="${opsNames[s.id]}: ${opsLabels[s.state]}"><span class="ops-room-number">0${i+1}</span><span class="ops-station-label">${opsNames[s.id]}</span><span class="ops-scene" aria-hidden="true"><span class="ops-desk"><span class="ops-monitor"><span>${s.id==='whatsapp'?'WA':s.id==='redacao'?'AI':s.id==='site'?'TN':'···'}</span></span><span class="ops-keyboard"></span><span class="ops-coffee"></span></span>${opsAvatar(s.id)}<span class="ops-paper"></span></span><span class="ops-station-state"><i></i>${opsLabels[s.state]}</span>${s.state==='working'?'<span class="ops-working-pixels" aria-hidden="true">▪ ▪ ▪</span>':''}</button>`).join('')}</div><div class="ops-office-bottom"><span>WHATSAPP → APURAÇÃO → TEXTO → REVISÃO → PUBLICAÇÃO → SITE</span><strong>${working?(demo?'Simulação: ':'Etapa informada: ')+opsNames[working.id]:'Sem trabalho ativo confirmado'}</strong></div></section>
    <aside class="ops-inspector"><p class="eyebrow">O QUE ESTÁ ACONTECENDO?</p><h2 data-ops-title>Escolha uma mesa.</h2><span class="ops-detail-state" data-ops-state>Toque em um personagem</span><p data-ops-detail>Os estados vêm dos serviços consultados. “Sem confirmação” não significa desligado: significa que faltam dados para saber.</p><div class="ops-purpose"><strong>Qual é a função?</strong><p data-ops-purpose>A VPS é a sala de máquinas: mantém a conexão WhatsApp e executa os processos do robô. O site público fica no Render e os dados, no Supabase.</p></div><a class="text-link" href="#whatsapp">Conferir a conexão WhatsApp ↗</a><a class="text-link" href="#rascunhos">Abrir os rascunhos ↗</a></aside></div>
    <div class="ops-lower"><section class="ops-blockers"><p class="eyebrow">POR QUE A MATÉRIA NÃO SAIU?</p><h2>O caminho ainda tem bloqueios.</h2><ol>${(data.blockers || [{text:'Aguardando a consulta do fluxo.'}]).map(b=>`<li>${opsEscape(b.text)}</li>`).join('')}</ol><p class="ops-safety">Conectar o WhatsApp não liga automaticamente a IA nem libera publicação. Este monitor não envia mensagens e não publica.</p></section><section class="ops-log"><p class="eyebrow">REGISTROS VERIFICÁVEIS</p><h2>Sem números inventados.</h2><div class="ops-log-row"><span>Último ciclo informado</span><strong>${data.cycle?opsEscape(data.cycle.state)+(data.cycle.stale?' · sem atualização recente':''):'Nenhum confirmado'}</strong><small>${data.cycle?'Às '+time(data.cycle.at)+(data.cycle.stage?' · '+opsEscape(data.cycle.stage):''):''}</small></div><div class="ops-log-row"><span>Rascunhos recentes</span><strong>${Array.isArray(data.drafts)?data.drafts.length:'—'}</strong><small>Lista de até 5, não é o total histórico.</small></div><div class="ops-log-row"><span>Publicações no banco</span><strong>${Array.isArray(data.publications)?data.publications.length:'—'}</strong><small>Até 5 recentes; registro no banco não prova deploy.</small></div><div class="ops-log-row"><span>Resposta do site</span><strong>${data.siteHttpStatus?'HTTP '+opsEscape(data.siteHttpStatus):'Não confirmada'}</strong></div>${(data.drafts || []).slice(0,5).filter(d=>/^[a-f0-9-]{36}$/.test(d.id || '')).map(d=>`<a class="ops-draft-link" href="#rascunho/${opsEscape(d.id)}">Ler rascunho: ${opsEscape(d.title)} ↗</a>`).join('')}</section></div>
    <section class="ops-events"><p class="eyebrow">PASSOS INFORMADOS PELO ROBÔ</p><h2>O rastro do trabalho.</h2>${data.events?.length?`<ol>${data.events.slice(-12).reverse().map(e=>`<li><time>${time(e.at)}</time><strong>${opsEscape(opsStages[e.stage] || 'Ciclo')}</strong><span>${opsEscape(opsCycleLabels[e.state] || 'Sem confirmação')}</span></li>`).join('')}</ol>`:'<p>Nenhum passo registrado nesta consulta. O histórico aparece quando o trabalhador informar suas etapas à ponte.</p>'}</section>
    <details class="ops-rules"><summary>Como interpretar esta sala</summary><p>Verde: conexão confirmada na última consulta. Personagem animado: etapa em andamento informada pelo trabalhador. Amarelo: esperando. Vermelho: bloqueio. Cinza: informação indisponível. Uma animação não comprova a qualidade do texto nem a presença da matéria no site.</p><p>Pautas em texto entram na fila quando o modo manual está ativo. O próprio número também pode comandar se WA_ACCEPT_OWN_COMMANDS estiver ativado. Respostas do robô não viram pautas. Não marque a declaração de chip exclusivo se estiver usando seu número pessoal.</p><p>A publicação exige a prévia e APROVAR #ID. As mesas mostram se essa integração está configurada. Aqui você apenas observa.</p></details>`;
}
export function operationsDemo() {
  return {mode:'demo',stations:[{id:'whatsapp',state:'ready',detail:'Exemplo: chip e grupo conectados.'},{id:'coleta',state:'working',detail:'Simulação visual da busca de fontes. Nenhuma busca real está acontecendo.'},{id:'redacao',state:'waiting',detail:'Exemplo: aguarda a apuração.'},{id:'revisao',state:'waiting',detail:'Exemplo: aguarda um rascunho.'},{id:'publicacao',state:'blocked',detail:'Publicação e aprovação aguardam ativação no servidor.'},{id:'site',state:'unknown',detail:'O site não é consultado nesta demonstração.'}],blockers:[{text:'Esta é uma demonstração do visual, não uma conexão com sua VPS.'},{text:'A aprovação editorial precisa ser ativada e testada no servidor.'}]};
}
export function mountOperations(root,{request,preview=false,onAuthError=()=>{},schedule=setTimeout,cancel=clearTimeout,doc=document}={}) {
  let closed=false,busy=false,timer=null,selected='whatsapp',last={};
  const draw=data=>{
    if(closed)return;
    const focused=doc.activeElement;
    const restore=root.contains(focused)?focused?.dataset?.opsStation || (focused?.hasAttribute('data-ops-refresh')?'refresh':null):null;
    last=data;root.innerHTML=operationsHTML(data);
    const select=id=>{
      selected=id;const raw=data.stations?.find(s=>s.id===id);
      root.querySelectorAll('[data-ops-station]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.opsStation===id)));
      root.querySelector('[data-ops-title]').textContent=opsNames[id];
      root.querySelector('[data-ops-state]').textContent=opsLabels[raw?.state] || 'Sem confirmação';
      root.querySelector('[data-ops-detail]').textContent=raw?.detail || 'Esta etapa ainda não foi consultada.';
      root.querySelector('[data-ops-purpose]').textContent=opsDescriptions[id];
    };
    root.querySelectorAll('[data-ops-station]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.opsStation)));
    root.querySelector('[data-ops-refresh]').addEventListener('click',()=>refresh());select(selected);
    if(restore)root.querySelector(restore==='refresh'?'[data-ops-refresh]':'[data-ops-station="'+restore+'"]').focus();
  };
  const arm=()=>{cancel(timer);if(!closed && !preview && !doc.hidden)timer=schedule(()=>refresh(),15000);};
  async function refresh(){
    if(closed || busy || doc.hidden)return;
    cancel(timer);
    if(preview){draw(operationsDemo());return;}
    busy=true;const button=root.querySelector('[data-ops-refresh]');if(button)button.disabled=true;
    try{const data=await request('/workflow');if(!data || data.schemaVersion!==1 || data.mode!=='live' || !Array.isArray(data.stations))throw Error();draw(data);}
    catch(error){
      draw({mode:'unavailable',blockers:[{text:'A consulta do fluxo falhou. Confira o servidor; a tela não mantém estados verdes antigos.'}]});
      if(error.status===401 || error.status===403)onAuthError(error);
    }finally{busy=false;arm();}
  }
  const visible=()=>{if(doc.hidden)cancel(timer);else refresh();};
  doc.addEventListener('visibilitychange',visible);
  draw(preview?operationsDemo():last);if(!preview)refresh();
  return ()=>{closed=true;cancel(timer);doc.removeEventListener('visibilitychange',visible);};
}
