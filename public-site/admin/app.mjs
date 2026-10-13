import {mountShell, mountLogin} from './shell.mjs';
const root = document.getElementById('app');
const config = window.TNN_PANEL;
let csrf = '', unmount = () => {};
async function request(path, body) {
  let response;
  try {
    if (!config || config.apiUrl !== 'https://bot.tomezap.com.br/painel-api') throw Error();
    response = await fetch(config.apiUrl + path, {method: body ? 'POST' : 'GET', credentials:'include', cache:'no-store',
      headers: {...(body ? {'Content-Type':'application/json'} : {}), ...(csrf ? {'X-CSRF-Token':csrf} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(15000)});
  } catch {throw Error('Aguardando conexão: o servidor de acesso ainda não respondeu. Você pode conhecer o visual do painel abaixo.');}
  if (response.status === 204) return null;
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {const error = Error(data.message || 'Não foi possível concluir o acesso.'); error.status = response.status; throw error;}
  return data;
}
function login(message = '') {
  unmount(); unmount = () => {}; csrf = '';
  document.title = 'Entrar na redação · TomeZap';
  mountLogin(root, {message, onSubmit:async (email,password) => {const result = await request('/login',{email,password}); await enter(result);}});
}
async function enter(session) {
  csrf = session.csrf;
  await request('/bootstrap');
  unmount();
  const cleanup = mountShell({root, user:session.user, whatsappRequest:request,onAuthError:error=>login(error.message), onLogout:async () => {
    try {await request('/logout',{}); login('Você saiu do painel.');}
    catch {login('Não foi possível confirmar o encerramento no servidor. Feche esta janela; a sessão expira por inatividade.');}
  }});
  // Revalida o acesso ao voltar para a aba e periodicamente; falha fecha a tela.
  let checking = false;
  const recheck = async () => {
    if (document.hidden || checking) return;
    checking = true;
    try {const fresh = await request('/session'); csrf = fresh.csrf;}
    catch (error) {login(error.message);}
    finally {checking = false;}
  };
  const interval = setInterval(recheck, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', recheck);
  unmount = () => {clearInterval(interval); document.removeEventListener('visibilitychange', recheck); cleanup();};
}
try {await enter(await request('/session'));}
catch (error) {login(error.status === 401 ? '' : error.message);}
