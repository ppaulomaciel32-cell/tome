// Prévia isolada: não gera QR, não envia mensagens e não chama APIs.
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=path=>fs.readFile(new URL(path,root),'utf8');
const [template,css,js]=await Promise.all(['index.html','connection.css','connection.mjs'].map(file=>read('panel-api/connect/'+file)));
const html=template.replace('<html lang="pt-BR">','<html lang="pt-BR" data-preview="true">')
  .replace('<link rel="stylesheet" href="/conectar/connection.css">',`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>${css}</style>`)
  .replace('<script type="module" src="/conectar/connection.mjs"></script>','')
  .replace('</body>',`<script type="module">${js.replaceAll('</script','<\\/script')}</script></body>`);
await fs.writeFile(new URL('docs/whatsapp-conexao-preview.html',root),html);
console.log('Prévia offline gerada: docs/whatsapp-conexao-preview.html');
