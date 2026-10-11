// Algumas dependências de criptografia escrevem sessões completas com console.info.
// Este processo é exclusivo do WhatsApp: silenciar seu console antes de importar
// provedores impede esses vazamentos. Os demais serviços não são afetados.
export function protectProviderLogs(target = console) {
  for(const method of ['log','info','debug','warn','error','trace','dir','dirxml','table','assert']) target[method]=()=>{};
}
export function safeLog(event, output = process.stdout) {
  if(!['bridge_started','startup_failed','fatal_error'].includes(event))return;
  output.write(JSON.stringify({event,at:new Date().toISOString()})+'\n');
}
