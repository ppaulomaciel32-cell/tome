const preview = document.documentElement.dataset.preview === 'true';
const $ = id=>document.getElementById(id);
const labels={idle:'Pronto para conectar',awaiting_configuration:'Aguardando configuração',connecting:'Conectando…',awaiting_scan:'Escaneie com o número configurado',connected:'WhatsApp conectado',reconnecting:'Reconectando…',needs_attention:'Conexão precisa de atenção',wrong_number:'Chip diferente do configurado',error:'Conexão indisponível'};
let csrf='', busy=false, last=null, expiry=0, stopped=false;
function clearPairing(){ $('qr-image').hidden=true;$('qr-image').removeAttribute('src');$('pair-code').hidden=true;$('code-value').textContent='';$('qr-placeholder').hidden=false;expiry=0; }
function draw(data){
  last=data;clearPairing();
  $('state-label').textContent=labels[data.state] || 'Aguardando conexão';$('state-label').classList.toggle('connected',data.connected===true);
  $('dedicated-number').textContent=data.dedicatedNumber || 'aguardando configuração';
  $('start').disabled=preview || busy || !data.configured || !$('dedicated-confirm').checked || !['idle','error'].includes(data.state);
  $('phone').disabled=preview || busy || data.state!=='awaiting_scan' || Boolean(data.pairingCode);
  $('load-groups').disabled=preview || busy || !data.connected;
  $('test-send').disabled=preview || busy || !data.connected || !data.group;
  $('group-form').querySelector('button').disabled=preview || busy || !data.connected;
  $('group-status').textContent=data.group?'Grupo confirmado':data.connected?'Chip conectado. Escolha o grupo.':'Aguardando conexão do chip';
  $('group-detail').textContent=data.group?data.group.id:'Somente os editores autorizados poderão enviar comandos.';
  $('pair-expiry').textContent=data.connected?'Chip conectado. O QR Code foi removido desta tela.':'Nenhum QR Code válido neste momento.';
  const expires=Date.parse(data.expiresAt);
  if(expires>Date.now() && !document.hidden){
    if(typeof data.qr==='string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.qr)){$('qr-image').src=data.qr;$('qr-image').hidden=false;$('qr-placeholder').hidden=true;expiry=expires;}
    if(typeof data.pairingCode==='string' && /^[A-Z0-9-]{6,16}$/i.test(data.pairingCode)){$('pair-code').hidden=false;$('code-value').textContent=data.pairingCode;$('qr-placeholder').hidden=true;expiry=expires;}
  }
  tick();
}
function tick(){if(!expiry)return;const seconds=Math.max(0,Math.ceil((expiry-Date.now())/1000));$('pair-expiry').textContent='Código privado · expira em '+seconds+' s';if(!seconds){clearPairing();$('pair-expiry').textContent='Código expirado. Aguarde a atualização automática.';}}
async function request(path,body){
  const response=await fetch('/painel-api'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers:{...(body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(response.status===401 || response.status===403){stopped=true;clearPairing();document.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);}
  if(!response.ok)throw Error(data.message || 'Não foi possível concluir.');return data;
}
async function refresh(){if(preview||busy||document.hidden||stopped)return;try{draw(await request('/whatsapp/pairing'));}catch(e){clearPairing();$('state-label').textContent='Conexão não confirmada';$('message').textContent=e.message;}}
async function action(fn){if(busy||stopped||preview)return;busy=true;$('message').textContent='';document.querySelectorAll('button').forEach(x=>x.disabled=true);try{await fn();}catch(e){$('message').textContent=e.message;}finally{busy=false;await refresh();}}
$('dedicated-confirm').addEventListener('change',()=>{if(last)draw(last);});
$('start').addEventListener('click',()=>action(async()=>{await request('/whatsapp/start',{confirmRiskAccepted:$('dedicated-confirm').checked});}));
$('phone').addEventListener('click',()=>action(async()=>{await request('/whatsapp/pair-code',{});}));
$('load-groups').addEventListener('click',()=>action(async()=>{
  const data=await request('/whatsapp/groups');$('group-select').replaceChildren();$('group-confirm').checked=false;
  for(const group of data.groups){const option=document.createElement('option');option.value=group.id;option.textContent=group.name+' · '+group.participants+' participantes · '+group.id;$('group-select').append(option);}
  $('group-form').hidden=!data.groups.length;
  if(!data.groups.length)$('message').textContent='Nenhum grupo Comando Tome Nota encontrado. Adicione o chip do robô e tente novamente.';
}));
$('group-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{await request('/whatsapp/group',{id:$('group-select').value,confirmGroup:$('group-confirm').checked});$('group-form').hidden=true;$('message').textContent='Grupo confirmado. Você já pode enviar a mensagem de teste.';});});
$('test-send').addEventListener('click',()=>action(async()=>{await request('/whatsapp/test',{});$('message').textContent='Mensagem de teste enviada. Confira no grupo do WhatsApp.';}));
if(preview){$('preview-notice').hidden=false;draw({state:'awaiting_configuration',configured:false,connected:false});}
else{
  try{const session=await request('/session');if(session.user.role!=='owner')throw Error('Somente o dono pode conectar o chip.');csrf=session.csrf;await refresh();}
  catch(e){stopped=true;clearPairing();$('message').textContent=e.message;}
  const poll=setInterval(refresh,5000),clock=setInterval(tick,1000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clearPairing();else refresh();});
  window.addEventListener('pagehide',()=>{clearInterval(poll);clearInterval(clock);clearPairing();stopped=true;});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
}
