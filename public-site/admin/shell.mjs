import {icon} from './icons.mjs';
import {draftList,draftDetail} from './drafts.mjs';
import {mountOperations} from './operations.mjs';
import {mountAnalytics} from './analytics.mjs';
import {mountViral} from './viral.mjs';
import {scheduledHTML,mountSchedules} from './editor.mjs';
import {statCards,mountOverviewStats,draftActionsHTML,mountDraftActions,mountInfra,infraPage,toolsPage} from './hub.mjs';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const modules = [
  {id:'radar',label:'Pautas Radar',icon:'eye',eyebrow:'DESCOBERTA ANTES DA REDAÇÃO',description:'Sugestões com fontes para você escolher antes de redigir.',action:'Ver sugestões',title:'Pautas Radar.',detail:''},
  {id:'biblioteca', label:'Pautas e fotos', icon:'folder', eyebrow:'DA PAUTA À MATÉRIA', description:'Como mandar pauta, texto, link e foto para o robô.', action:'Ver como enviar', title:'Toda matéria começa no grupo.', detail:'Mande a pauta no grupo Comando Tome Nota. O robô apura, escreve, faz a capa e devolve a prévia para você aprovar aqui ou no WhatsApp.'},
  {id:'whatsapp', label:'WhatsApp', icon:'chat', eyebrow:'CONVERSA QUE VIRA NOTÍCIA', description:'Conexão do robô, grupo e comandos.', action:'Ver conexão', title:'Sua redação, na conversa.', detail:'O robô conversa pelo grupo Comando Tome Nota. Lá chegam as prévias e lá você aprova, rejeita ou pede correção.'},
  {id:'ferramentas', label:'Ferramentas', icon:'eye', eyebrow:'APURAÇÃO ALÉM DO ROBÔ', description:'Monitor de páginas, RSS, leitor de notícias, automações e Facebook.', action:'Abrir ferramentas', title:'Suas ferramentas.', detail:''},
  {id:'infraestrutura', label:'Serviços', icon:'pulse', eyebrow:'TUDO SOB SEU OLHAR', description:'Site, banco, WhatsApp, robô e IA: o que está funcionando agora.', action:'Ver serviços', title:'Como estão os serviços.', detail:''},
  {id:'dashboard', label:'Audiência', icon:'grid', eyebrow:'NÚMEROS QUE AJUDAM A DECIDIR', description:'Visitas por matéria, por cidade e de onde vem o leitor.', action:'Ver audiência', title:'Audiência do jornal.', detail:''},
  {id:'instagram', label:'Instagram', icon:'instagram', eyebrow:'AINDA NÃO CONECTADO', description:'Postar as matérias no perfil do jornal. Ainda não conectado.', action:'Ver detalhes', title:'Instagram ainda não conectado.', detail:'A postagem automática no Instagram ainda não existe. Por enquanto, compartilhe o link que o robô manda no grupo.'},
  {id:'tracking', label:'Campanhas', icon:'link', eyebrow:'AINDA NÃO CONECTADO', description:'Links de campanha e origem dos leitores. Ainda não conectado.', action:'Ver detalhes', title:'Campanhas ainda não conectadas.', detail:'Enquanto isso, a origem das visitas (WhatsApp, Google, Instagram) aparece em Audiência, depois que o Google Analytics for ligado.'}
];
const waiting = (text = 'Aguardando conexão') => `<span class="status-pill"><span></span>${text}</span>`;
function moduleCard(item) {
  return `<a class="module-card" href="#${item.id}"><span class="module-card-top"><span class="module-icon">${icon(item.icon)}</span>${icon('arrow','card-arrow')}</span><h3>${item.label}</h3><p>${item.description}</p><span class="card-foot">${item.action}${icon('chevron')}</span></a>`;
}
function overview() {
  return `<div class="page-heading"><div><p class="eyebrow">SEU CENTRO DE OPERAÇÕES</p><h1>Sua redação começa aqui.</h1><p>O robô busca, escreve e manda a prévia. Você decide o que vai para o jornal.</p></div><a class="button primary" href="#rascunhos">${icon('book')}Ver rascunhos</a></div>
  <section class="welcome-strip" aria-label="Redação ao vivo"><div><span class="light-eyebrow">TOME NOTA NEWS · CEARÁ</span><h2>Da sua região.<br>Para quem precisa saber.</h2><p>A cada 20 minutos o robô procura uma pauta em 22 fontes<br class="desktop-break"> e manda a prévia no seu WhatsApp.</p><a href="#operacao">Ver a redação trabalhando ${icon('arrow')}</a></div><div class="editorial-art" aria-hidden="true"><span class="art-orbit orbit-one"></span><span class="art-orbit orbit-two"></span><div class="art-sheet back"></div><div class="art-sheet front"><span class="mini-brand">tn<span>NEWS</span></span><div class="art-rule"></div><div class="art-headline">O que acontece<br>aqui importa.</div><div class="art-photo"><span></span></div><div class="art-text"></div><div class="art-text short"></div></div><span class="art-stamp">JORNALISMO<br>DA NOSSA TERRA</span></div></section>
  <section class="quick-stats" aria-label="Resumo da operação">${statCards()}</section>
  <div class="overview-grid"><section><div class="section-heading"><h2>Tudo num lugar só</h2><span>${modules.length} áreas</span></div><div class="modules-grid">${modules.map(moduleCard).join('')}</div></section>
  <aside class="next-steps"><div class="section-heading"><h2>Como publicar</h2>${icon('check')}</div><p>Do grupo ao site, em quatro passos.</p><ol class="setup-list"><li><span>1</span><div><strong>Mande a pauta</strong><small>Texto, link ou foto com legenda no grupo Comando Tome Nota.</small></div></li><li><span>2</span><div><strong>Leia a prévia</strong><small>Chega no grupo e aparece em Rascunhos, com fontes e capa.</small></div></li><li><span>3</span><div><strong>Decida</strong><small>Aprovar, rejeitar ou pedir correção: no grupo ou aqui.</small></div></li><li><span>4</span><div><strong>Compartilhe</strong><small>O robô devolve o link da matéria publicada.</small></div></li></ol><div class="quiet-note">${icon('shield')}<p>Nada vai ao site sem a sua aprovação.</p></div><a class="text-link" href="#ajuda">Comandos e regras ${icon('arrow')}</a></aside></div>`;
}
function modulePage(item) {
  let content;
  if (item.id === 'biblioteca') content = `<div class="library-layout"><section class="info-card"><p class="eyebrow">NO GRUPO COMANDO TOME NOTA</p><h2>O que mandar</h2><ul class="howto-list"><li><strong>Uma frase com a pauta</strong> — o robô procura a fonte e escreve.</li><li><strong>O link da fonte oficial</strong> (prefeitura, governo, MP) — vira a base da matéria.</li><li><strong>O texto completo da nota</strong> — colado no grupo, vira o material da matéria.</li><li><strong>Foto com a pauta na legenda</strong> — a foto vira a capa. Escreva <code>Foto: nome</code> para dar o crédito. Para manter a qualidade, mande como documento ou em HD.</li></ul></section><aside class="info-card"><p class="eyebrow">ORGANIZAÇÃO LOCAL</p><h2>Cada pauta no seu lugar.</h2><p>O robô escolhe a cidade pelo conteúdo da matéria e ela aparece na página da cidade no site.</p><div class="tags">${['São Gonçalo','Pecém','Taíba','Croatá','Paracuru','Região'].map(x=>`<span>${x}</span>`).join('')}</div><div class="quiet-note">${icon('clock')}<p>Pautas com uma fonte só passam quando a fonte é oficial ou quando o texto foi enviado por você.</p></div></aside></div>`;
  else if (item.id === 'infraestrutura' || item.id === 'ferramentas') return item.id==='ferramentas'?toolsPage():infraPage();
  else if (item.id === 'dashboard') content = `<section class="empty-card">${icon('grid')}<h2>Audiência na demonstração.</h2><p>No painel real, aqui aparecem as visitas dos últimos 30 dias por matéria, por cidade e por origem, assim que o Google Analytics for ligado.</p>${waiting('Aguardando dados')}</section>`;
  else if (item.id === 'tracking') content = `<div class="feature-grid">${[['Links de campanha','Crie links com origem, canal e nome da campanha.'],['Origem das visitas','Veja como os leitores chegaram ao jornal.'],['Afiliadas e comissões','Acompanhe cliques e vendas confirmadas.']].map(([t,d])=>`<article class="info-card">${icon('link')}<h2>${t}</h2><p>${d}</p>${waiting()}</article>`).join('')}</div><p class="support-note">Cliques não serão contados como vendas. As comissões dependerão do registro de vendas confirmadas.</p>`;
  else content = `<section class="empty-card"><span class="large-icon">${icon(item.icon)}</span><h2>Ainda não conectado.</h2><p>${item.detail}</p>${waiting('Não conectado')}</section>`;
  return `<div class="page-heading"><div><p class="eyebrow">${item.eyebrow}</p><h1>${item.title}</h1><p>${item.detail}</p></div></div>${content}`;
}
function whatsappPage(preview, user) {
  return `<div class="page-heading"><div><p class="eyebrow">CONVERSA QUE VIRA NOTÍCIA</p><h1>Sua redação, na conversa.</h1><p>Um chip dedicado. Um grupo autorizado. Toda publicação passa pela aprovação de vocês.</p></div></div><div class="feature-grid"><section class="info-card"><span class="module-icon">${icon('chat')}</span><h2>Conexão do WhatsApp</h2><p data-wa-state>${preview ? 'Prévia visual: conexão ainda não verificada.' : 'Consultando a conexão…'}</p><p data-wa-group>O grupo será escolhido depois do pareamento.</p>${preview || user?.role!=='owner' ? '<button class="button primary" disabled>Abrir pareamento</button>' : '<a class="button primary" href="https://bot.tomezap.com.br/conectar">Abrir pareamento ↗</a>'}<p class="support-note">Somente o dono pode ver o QR Code e confirmar o grupo.</p></section><section class="info-card">${icon('shield')}<h2>Comandos no grupo</h2><ul class="howto-list"><li><code>APROVAR 12</code> ou <code>pode publicar</code> — publica o rascunho nº 12.</li><li><code>REJEITAR 12</code> — descarta.</li><li><code>CORRIGIR 12: deixe mais curto</code> — refaz o texto.</li><li><code>MANCHETE 12: nova manchete</code> — troca o título.</li><li><code>STATUS</code> — resumo do dia.</li></ul><p><a class="text-link" href="#rascunhos">Ou decida pelos Rascunhos ↗</a></p></section></div><div class="quiet-note">${icon('shield')}<p>Conexão não oficial: há risco de bloqueio do número. Use um chip exclusivo para o robô e mantenha poucos envios.</p></div>`;
}
function helpPage() {
  return `<div class="page-heading"><div><p class="eyebrow">SIMPLES, DO COMEÇO AO FIM</p><h1>Como a redação funciona.</h1><p>O robô trabalha sozinho, mas só publica o que você aprova.</p></div></div><div class="flow-grid">${[['01','Busca','A cada 20 minutos o robô lê 22 fontes (governo do Ceará, prefeituras, MP, Pecém, Cagece e outras) e escolhe a pauta mais local.','folder'],['02','Escreve','O Gemini escreve só com o que está na fonte. Número ou citação que não está na fonte é barrado.','book'],['03','Você decide','A prévia chega no grupo e em Rascunhos. Aprovar, rejeitar ou corrigir: no WhatsApp ou aqui.','check'],['04','Publica','Aprovada, a matéria entra no site com capa e o robô devolve o link para compartilhar.','pulse']].map(([n,t,d,i])=>`<article class="info-card"><span class="flow-number">${n}</span>${icon(i)}<h2>${t}</h2><p>${d}</p></article>`).join('')}</div><section class="help-banner"><div>${icon('shield')}<h2>Regras que protegem o jornal.</h2><p>Fonte única só quando é oficial ou material enviado por você. Texto sempre atribuído à fonte. Sem foto, a capa é a arte do jornal com a manchete; foto de outro portal nunca.</p></div></section>`;
}
export function mountShell({root, user = null, preview = false, onLogout = () => {}, whatsappRequest,onAuthError=()=>{}}) {
  root.innerHTML = `<div class="workspace"><aside class="sidebar" id="sidebar"><button class="icon-button menu-close" aria-label="Fechar menu"><span aria-hidden="true">×</span></button><a class="brand" href="#inicio" aria-label="TomeZap, início"><span class="brand-mark">tn</span><span>TomeZap<small>CONTROLE DA REDAÇÃO</small></span></a><p class="nav-label">ESPAÇO DE TRABALHO</p><nav aria-label="Módulos do painel"><a href="#inicio" data-nav="inicio">${icon('grid')}Visão geral</a><a href="#biblioteca" data-nav="biblioteca">${icon('folder')}Pautas e fotos</a><a href="#rascunhos" data-nav="rascunhos">${icon('book')}Rascunhos</a><p class="nav-label">CANAIS E RESULTADOS</p>${modules.filter(m=>!['biblioteca','instagram','tracking'].includes(m.id)).map(m=>`<a href="#${m.id}" data-nav="${m.id}">${icon(m.icon)}${m.label}</a>`).join('')}<p class="nav-label">AINDA NÃO CONECTADO</p>${modules.filter(m=>['instagram','tracking'].includes(m.id)).map(m=>`<a href="#${m.id}" data-nav="${m.id}">${icon(m.icon)}${m.label}</a>`).join('')}</nav><div class="sidebar-bottom"><a href="#ajuda" data-nav="ajuda">${icon('help')}Como funciona</a><a href="https://tomezap.com.br" target="_blank" rel="noopener noreferrer">${icon('external')}Abrir o jornal</a><div class="sidebar-edition"><span class="edition-dot"></span>TOME NOTA NEWS<span>CE</span></div></div></aside>
  <div class="workspace-body"><header class="topbar"><div class="breadcrumb"><button class="icon-button menu-toggle" aria-label="Abrir menu" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button><span>Seu espaço</span>${icon('chevron')}<strong id="breadcrumb-current">Visão geral</strong></div><div class="topbar-end"><span class="topbar-date">${new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',timeZone:'America/Fortaleza'}).format(new Date())}</span><span class="avatar" aria-label="${preview ? 'Prévia visual' : 'Usuário autenticado'}">${preview ? 'TN' : user?.role === 'owner' ? 'DN' : 'ED'}</span><div class="profile-label"><strong>${preview ? 'Sua redação' : user?.role === 'owner' ? 'Dono do painel' : 'Editor'}</strong><small>${preview ? 'Prévia visual' : 'Acesso autorizado'}</small></div><button class="icon-button logout-button" aria-label="${preview ? 'Ver tela de login' : 'Sair do painel'}" title="${preview ? 'Ver tela de login' : 'Sair do painel'}">${icon('logout')}</button></div></header>
  <div class="stage-notice">${icon(preview ? 'eye' : 'clock')}<span>${preview ? '<strong>Prévia visual.</strong> Navegue pelos módulos. Nenhum dado real é consultado ou publicado.' : '<strong>Redação com revisão humana.</strong> Nada é publicado sem a sua aprovação.'}</span>${preview ? '<a href="./">Ir para o login</a>' : ''}</div>
  <main id="main" tabindex="-1"></main><footer class="workspace-footer"><span>TomeZap <span class="footer-dot">·</span> Tome Nota News</span><span>Feito para a sua redação, no Ceará.</span></footer></div></div>`;
  const main = root.querySelector('#main'), sidebar = root.querySelector('.sidebar'), menu = root.querySelector('.menu-toggle');
  const opsLink=document.createElement('a');opsLink.href='#operacao';opsLink.dataset.nav='operacao';opsLink.innerHTML=icon('pulse')+'Redação ao vivo';
  root.querySelector('[data-nav=inicio]').after(opsLink);
  let cleanupPage=()=>{};
  function closeMenu() {sidebar.classList.remove('open'); menu.setAttribute('aria-expanded','false');}
  menu.addEventListener('click', () => {const open = sidebar.classList.toggle('open'); menu.setAttribute('aria-expanded',String(open)); if (open) (sidebar.querySelector('[aria-current=page]') || sidebar.querySelector('a')).focus();});
  root.querySelector('.menu-close').addEventListener('click', () => {closeMenu(); menu.focus();});
  const onKey = event => {if (event.key === 'Escape') {closeMenu(); menu.focus();}};
  root.addEventListener('keydown', onKey);
  const draw = (focus = false) => {
    cleanupPage();cleanupPage=()=>{};
    const id = location.hash.slice(1)==='audiencia'?'dashboard':location.hash.slice(1) || 'inicio';
    if(id==='radar'){
      cleanupPage=mountViral(main,{request:whatsappRequest,onAuthError,preview});
      root.querySelector('#breadcrumb-current').textContent='Pautas Radar';
      root.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav==='radar')a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
      document.title='Pautas Radar · TomeZap';closeMenu();return;
    }
    if(id==='dashboard' && !preview){
      cleanupPage=mountAnalytics(main,whatsappRequest,onAuthError);
      root.querySelector('#breadcrumb-current').textContent='Audiência';
      root.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav==='dashboard')a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
      document.title='Audiência · TomeZap';closeMenu();return;
    }
    const item = modules.find(m=>m.id===id);
    const detail=id.match(/^rascunho\/([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/);
    const isDraft=id==='rascunhos' || Boolean(detail);
    const resolved = id==='operacao'?'operacao':isDraft ? 'rascunhos' : item ? id : id === 'ajuda' ? 'ajuda' : 'inicio';
    if(resolved==='operacao'){
      cleanupPage=mountOperations(main,{request:whatsappRequest,preview,onAuthError});
      root.querySelector('#breadcrumb-current').textContent='Redação ao vivo';
      root.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===resolved)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
      document.title='Redação ao vivo · TomeZap';closeMenu();
      if(focus){main.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}return;
    }
    main.innerHTML = isDraft ? (preview ? (detail ? draftDetail(null,true) : draftList({},true)) : '<section class="empty-card"><h1>Conferindo seus rascunhos…</h1><p role="status">Carregando o conteúdo privado.</p></section>') : resolved === 'inicio' ? overview() : resolved === 'ajuda' ? helpPage() : resolved === 'whatsapp' ? whatsappPage(preview,user) : modulePage(item);
    if(isDraft && !preview && whatsappRequest){
      const target=main.firstElementChild;
      // A numeração das prévias vem da ponte; sem ela, o rascunho ainda pode ser lido.
      Promise.all([whatsappRequest('/drafts'+(detail?'/'+detail[1]:'' )),whatsappRequest('/newsroom').catch(()=>null)]).then(([data,room])=>{
        if(!target.isConnected)return;
        const numbers=Object.fromEntries((room?.previews || []).map(p=>[p.id,p.n]));
        // Regra do jornal: sem foto real a ponte recusa a aprovação; o painel avisa antes do clique.
        const photos=Object.fromEntries((room?.previews || []).map(p=>[p.id,p.photo!==false]));
        main.innerHTML=detail?draftDetail(data,false,{number:numbers[detail[1]],actions:Boolean(numbers[detail[1]]),photo:photos[detail[1]]!==false}):draftList(data,false,numbers,photos)+scheduledHTML(room?.scheduled || []);
        if(detail && numbers[detail[1]])mountDraftActions(main,{id:detail[1],request:whatsappRequest,draft:data,photo:photos[detail[1]]!==false});
        if(!detail)mountSchedules(main,whatsappRequest);
      }).catch(error=>{
        if(!target.isConnected)return;
        main.innerHTML='<section class="empty-card"><h1>Rascunhos aguardando conexão.</h1><p role="status"></p><a class="text-link" href="#whatsapp">Conferir o WhatsApp</a></section>';
        main.querySelector('[role=status]').textContent=error.message;
      });
    }
    if(preview){
      main.querySelectorAll('[data-stat] small').forEach(n=>{n.textContent='demonstração';});
      const infra=main.querySelector('[data-infra]');if(infra)infra.innerHTML='<p class="support-note">Demonstração: no painel real, cada serviço aparece aqui com o resultado da consulta.</p>';
    }
    if(!preview && whatsappRequest){
      if(resolved==='inicio')cleanupPage=mountOverviewStats(main,whatsappRequest);
      if(resolved==='infraestrutura')cleanupPage=mountInfra(main,whatsappRequest);
    }
    if(resolved==='whatsapp' && !preview && whatsappRequest){
      const target=main.querySelector('[data-wa-state]'), group=main.querySelector('[data-wa-group]');
      whatsappRequest('/whatsapp/status').then(data=>{if(!target.isConnected)return;target.textContent=data.connected?'Chip conectado.':'Conexão pendente. Abra o pareamento para conferir.';group.textContent=data.group?'Grupo confirmado: '+data.group.name:'O grupo ainda precisa ser confirmado.';}).catch(error=>{if(target.isConnected)target.textContent=error.message;});
    }
    root.querySelector('#breadcrumb-current').textContent = item?.label || (isDraft ? 'Rascunhos' : resolved === 'ajuda' ? 'Como funciona' : 'Visão geral');
    root.querySelectorAll('[data-nav]').forEach(a=>{if (a.dataset.nav === resolved) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');});
    document.title = `${item?.label || (isDraft ? 'Rascunhos' : resolved === 'ajuda' ? 'Como funciona' : 'Visão geral')} · TomeZap`;
    closeMenu();
    if (focus) {main.focus({preventScroll:true}); window.scrollTo({top:0,behavior:'instant'});}
  };
  const hashChange = () => draw(true);
  window.addEventListener('hashchange', hashChange);
  root.querySelector('.logout-button').addEventListener('click', onLogout);
  draw();
  return () => {cleanupPage();window.removeEventListener('hashchange', hashChange); root.removeEventListener('keydown', onKey);};
}

export function mountLogin(root, {message = '', onSubmit}) {
  root.innerHTML = `<div class="login-layout"><aside class="login-story"><a class="brand" href="https://tomezap.com.br"><span class="brand-mark">tn</span><span>TomeZap<small>CONTROLE DA REDAÇÃO</small></span></a><div class="login-story-content"><p class="light-eyebrow">JORNALISMO DA NOSSA TERRA</p><h2>Boas histórias.<br>Uma redação<br>mais conectada.</h2><p>Organize suas pautas, acompanhe os canais<br>e cuide do seu jornal em um só lugar.</p><div class="login-localities"><span>São Gonçalo</span><span>Pecém</span><span>Taíba</span><span>Croatá</span><span>Paracuru</span><span>Região</span></div></div><div class="login-story-footer"><span>TOME NOTA NEWS</span><span>CEARÁ, BRASIL</span></div></aside>
  <main id="main" class="login-main"><a class="back-to-site" href="https://tomezap.com.br">Voltar para o jornal ${icon('external')}</a><div class="login-form-wrap"><div class="login-lock">${icon('lock')}</div><p class="eyebrow">SEU ESPAÇO DE TRABALHO</p><h1>Entre na redação.</h1><p class="login-intro">Use a conta autorizada para acessar seu painel.</p><form id="login-form"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254" placeholder="seu@email.com" inputmode="email"><label for="password">Senha</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024" placeholder="Sua senha de acesso"><button class="password-toggle" type="button" aria-label="Mostrar senha" aria-pressed="false">${icon('eye')}</button></div><p id="login-message" class="login-message" role="status" aria-live="polite">${escapeHTML(message)}</p><button class="button primary login-submit" type="submit">Entrar no painel ${icon('arrow')}</button></form><p class="access-note">${icon('shield')}Acesso exclusivo para o dono e os editores autorizados.</p><details class="login-help"><summary>É seu primeiro acesso?</summary><p>O e-mail precisa estar cadastrado e confirmado no acesso do projeto. A senha deste painel é a dessa conta, não a senha do Gmail. A ativação será orientada antes da publicação.</p></details><a class="preview-link" href="./preview.html">Conhecer o visual do painel ${icon('arrow')}</a></div><p class="login-bottom">Uma rotina mais simples. Um jornal mais próximo.</p></main></div>`;
  const form = root.querySelector('#login-form'), password = form.querySelector('#password'), toggle = form.querySelector('.password-toggle');
  toggle.addEventListener('click', () => {const visible = password.type === 'password'; password.type = visible ? 'text' : 'password'; toggle.setAttribute('aria-pressed', String(visible)); toggle.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');});
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('.login-submit'), status = form.querySelector('#login-message');
    button.disabled = true; button.textContent = 'Verificando acesso…'; status.textContent = ''; form.setAttribute('aria-busy','true');
    try {await onSubmit(form.email.value, password.value);}
    catch (error) {status.textContent = error.message || 'Não foi possível entrar. Tente novamente.';}
    finally {password.value = ''; button.disabled = false; button.innerHTML = 'Entrar no painel ' + icon('arrow'); form.removeAttribute('aria-busy');}
  });
}
