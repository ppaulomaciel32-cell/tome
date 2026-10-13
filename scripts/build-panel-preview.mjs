// Gera uma prévia offline sem chaves, dados privados ou chamadas de rede.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'public-site/admin');
const css = (await Promise.all(['panel.css','operations.css'].map(name=>fs.readFile(path.join(source,name),'utf8')))).join('\n');
const scripts = await Promise.all(['icons.mjs','drafts.mjs','operations.mjs','shell.mjs'].map(async name => (await fs.readFile(path.join(source, name), 'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')));
scripts.push(`
const root = document.getElementById('app');
let cleanup = () => {};
function showLogin() {
  cleanup(); cleanup = () => {};
  mountLogin(root, {message:'Prévia visual: este formulário não envia dados.', onSubmit:async () => {throw Error('Prévia visual. O login real depende da ativação do servidor.');}});
  window.scrollTo(0,0);
}
function showShell() {
  cleanup(); cleanup = mountShell({root, preview:true, onLogout:showLogin});
}
root.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  if (link.classList.contains('preview-link')) {event.preventDefault(); showShell();}
  if (link.getAttribute('href') === './') {event.preventDefault(); showLogin();}
});
showShell();
`);
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Prévia do painel · TomeZap</title><style>${css}</style></head><body><a class="skip-link" href="#main">Pular para o conteúdo</a><div id="app"></div><script>${scripts.join('\n').replaceAll('</script','<\\/script')}</script></body></html>`;
await fs.writeFile(path.join(root, 'docs/painel-preview.html'), html);
// A mesma prévia abre direto na sala, sem consultar VPS ou dados privados.
await fs.writeFile(path.join(root,'docs/redacao-visual-preview.html'),html.replace('<script>','<script>if(!location.hash)location.hash="operacao";\n'));
console.log('Prévia offline gerada: docs/painel-preview.html');
console.log('Sala visual gerada: docs/redacao-visual-preview.html');
