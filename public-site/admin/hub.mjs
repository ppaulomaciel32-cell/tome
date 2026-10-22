// Peças do painel que juntam robô, rascunhos, serviços e ferramentas num lugar só.
import {icon} from './icons.mjs';
import {mountEditor} from './editor.mjs';
const escHub=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COVER=/^https:\/\/bot\.tomezap\.com\.br\/imagens\/[a-f0-9]{32}-1600\.jpg$/;
export const coverURL=value=>COVER.test(value || '')?value:null;

// Visão geral: números reais quando a consulta responde; traço quando não.
export function mountOverviewStats(main,request){
  let active=true;
  const set=(key,value,note)=>{const card=main.querySelector('[data-stat="'+key+'"]');if(!card || !active)return;card.querySelector('strong').textContent=value;card.querySelector('small').textContent=note;};
  request('/newsroom').then(n=>{
    set('hoje',String(n.publishedToday ?? '—'),'aprovadas hoje');
    set('fila',String(n.previews?.length ?? '—'),n.previews?.length?'esperando a sua decisão':'nenhum rascunho esperando');
    set('ia',n.quota?n.quota.used+'/'+n.quota.limit:'—',n.quota?'redações de hoje (Gemini)':'uso ainda não informado');
  }).catch(()=>{for(const k of ['hoje','fila','ia'])set(k,'—','sem resposta do robô');});
  request('/infra').then(i=>set('total',i.publishedTotal===null?'—':String(i.publishedTotal),'matérias no site')).catch(()=>set('total','—','sem resposta do banco'));
  return ()=>{active=false;};
}
export const statCards=()=>[['total','globe','No site'],['hoje','book','Publicadas hoje'],['fila','clock','Aguardando você'],['ia','pulse','Inteligência artificial']]
  .map(([key,i,title])=>`<article class="stat-card" data-stat="${key}"><span>${title}${icon(i)}</span><strong>—</strong><small>consultando…</small></article>`).join('');

// Ações do rascunho: o mesmo caminho assinado do grupo do WhatsApp.
export function draftActionsHTML(number,photo=true){
  return `<section class="draft-actions" data-draft-actions aria-label="Decidir sobre este rascunho"><p class="eyebrow">SUA DECISÃO${number?' · RASCUNHO Nº '+escHub(number):''}</p>
    ${photo?'':'<div class="draft-photo-needed" role="alert"><strong>Falta a foto para publicar.</strong><p>Toda matéria do Tome Nota sai com foto real. Envie a foto de capa aqui embaixo (ou responda no grupo com a foto e FOTO '+escHub(number || '')+'). O robô gera uma nova prévia com a foto e aí você aprova.</p><div data-photo-slot></div></div>'}
    <div class="draft-action-row"><button class="button primary" data-act="approve"${photo?'':' disabled title="Envie a foto de capa primeiro"'}>${icon('check')}${photo?'Aprovar e publicar':'Aprovar (falta a foto)'}</button><button class="button ghost" data-act="reject">Rejeitar</button></div>
    <details class="draft-edit"><summary>Pedir correção ou trocar a manchete</summary>
      <label for="edit-text">O que mudar</label><textarea id="edit-text" maxlength="1500" rows="3" placeholder="Ex.: deixe o texto mais curto e tire o último parágrafo"></textarea>
      <button class="button ghost" data-act="fix">Pedir correção</button>
      <label for="edit-title">Nova manchete</label><input id="edit-title" maxlength="300" placeholder="Escreva a manchete exatamente como deve sair">
      <button class="button ghost" data-act="title">Trocar manchete</button>
    </details><p class="draft-action-status" role="status" aria-live="polite"></p>
    <p class="draft-action-note">O robô confirma no grupo do WhatsApp. Aprovar publica no site em poucos minutos; correção gera um novo rascunho para aprovar.</p></section>`;
}
export function mountDraftActions(main,{id,request,draft,photo=true}){
  const box=main.querySelector('[data-draft-actions]');if(!box)return;
  if(draft)mountEditor(box,{id,draft,request});
  if(!photo){
    // Sem foto, o envio da capa vem primeiro e já aberto.
    const upload=[...box.querySelectorAll('details.draft-edit')].find(d=>/foto de capa/i.test(d.querySelector('summary')?.textContent || ''));
    if(upload){upload.open=true;box.querySelector('[data-photo-slot]')?.append(upload);}
  }
  const status=box.querySelector('.draft-action-status');
  const ask={approve:'Publicar esta matéria no site agora?',reject:'Descartar este rascunho? Ele não será publicado.'};
  box.querySelectorAll('[data-act]').forEach(button=>button.addEventListener('click',async()=>{
    const act=button.dataset.act;let body={kind:act==='fix' || act==='title'?'edit':act,nonce:crypto.randomUUID()};
    if(act==='fix' || act==='title'){
      const text=box.querySelector(act==='fix'?'#edit-text':'#edit-title').value.trim();
      if(text.length<5){status.textContent=act==='fix'?'Escreva o que precisa mudar (pelo menos 5 letras).':'Escreva a nova manchete.';return;}
      body={...body,mode:act,text};
    }else if(!window.confirm(ask[act]))return;
    box.querySelectorAll('button').forEach(b=>{b.disabled=true;});status.textContent='Enviando…';
    try{
      const r=await request('/drafts/'+id+'/decision',body);
      status.textContent={approve:'Aprovado. O robô está publicando e avisa no grupo com o link.',reject:'Rejeitado. Nada foi publicado.',edit:'Correção pedida. A nova prévia chega no grupo e aparece em Rascunhos.'}[body.kind]+(r?.number?' (rascunho nº '+r.number+')':'');
    }catch(error){status.textContent=error.message || 'Não foi possível enviar. Tente de novo.';box.querySelectorAll('button').forEach(b=>{b.disabled=false;});}
  }));
}

// Serviços: o que respondeu na última consulta, sem números inventados.
export function mountInfra(main,request){
  let active=true;
  const label={ok:'Funcionando',attention:'Precisa de atenção',unknown:'Sem informação'};
  const paint=data=>{if(!active)return;main.querySelector('[data-infra]').innerHTML=data.services.map(s=>`<article class="service-${escHub(s.state)}"><span class="module-icon">${icon(s.state==='ok'?'check':'pulse')}</span><div><h2>${escHub(s.label)}</h2><p>${escHub(s.detail)}</p></div><span class="status-pill"><span></span>${label[s.state] || label.unknown}</span></article>`).join('')
    +`<p class="support-note">Consultado às ${escHub(new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Fortaleza'}).format(new Date(data.checkedAt)))}. O servidor da Hostinger vence em 13/11/2026: renove antes para o robô não parar.</p>`;};
  request('/infra').then(paint).catch(error=>{if(active)main.querySelector('[data-infra]').innerHTML='<p class="support-note">'+escHub(error.message)+'</p>';});
  return ()=>{active=false;};
}
export function infraPage(){
  return `<div class="page-heading"><div><p class="eyebrow">TUDO SOB SEU OLHAR</p><h1>Como estão os serviços.</h1><p>Site, banco, WhatsApp, robô e inteligência artificial, consultados agora.</p></div></div><section class="service-list" data-infra aria-live="polite"><p class="support-note">Consultando…</p></section>`;
}

// Ferramentas de apuração instaladas no servidor, acessadas pelo túnel do Mac.
const TOOLS=[
  ['18100','Monitor de páginas','changedetection.io','Avisa quando licitações, publicações oficiais e notícias das prefeituras mudam. Já vigia 6 páginas de São Gonçalo, Paracuru e Pecém.','eye'],
  ['18101','Gerador de RSS','RSS-Bridge','Transforma site sem RSS em RSS, como as notícias das prefeituras.','link'],
  ['18102','Leitor de notícias','FreshRSS','Todas as fontes num lugar só. Importe o arquivo fontes-tome-nota.opml.','book'],
  ['18103','Automações','n8n','Monte automações sem programar: alertas por palavra-chave, resumos, planilhas.','grid'],
  ['18104','Facebook','Facebook Scraper','Lê posts e comentários de páginas públicas. O Facebook bloqueia quase tudo sem login.','chat']];
export function toolsPage(){
  return `<div class="page-heading"><div><p class="eyebrow">APURAÇÃO ALÉM DO ROBÔ</p><h1>Suas ferramentas.</h1><p>Rodam no servidor, protegidas: só abrem no seu Mac com o túnel ligado.</p></div></div>
    <section class="help-banner tools-howto"><h2>Antes de abrir</h2><p>No Terminal do Mac, rode e deixe aberto:</p><code>sh ~/tomezap-servidor/ferramentas-doc/abrir-ferramentas.sh</code><p>Sem o túnel os botões abaixo não carregam. Isso é proposital: ninguém de fora acessa.</p></section>
    <div class="feature-grid tools-grid">${TOOLS.map(([port,title,name,text,i])=>`<article class="info-card">${icon(i)}<p class="eyebrow">${escHub(name)}</p><h2>${escHub(title)}</h2><p>${escHub(text)}</p><a class="button primary" href="http://localhost:${port}" target="_blank" rel="noopener noreferrer">Abrir ${icon('external')}</a></article>`).join('')}</div>`;
}
