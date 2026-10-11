import {mountShell} from './shell.mjs';
// Prévia independente: nenhum fetch, token, usuário real ou publicação.
mountShell({root:document.getElementById('app'), preview:true, onLogout:()=>{location.href='./';}});
