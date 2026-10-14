// Verificações de saúde com destinos fixos; nunca recebe URL do navegador.
export function createInfraReader(config,{whatsapp,drafts,fetchImpl=fetch,now=Date.now}={}){
  let cached=null,until=0,pending=null;
  const probe=async(fn)=>{try{return {ok:true,value:await fn()};}catch(error){return {ok:false,error};}};
  const check=async()=>{
    const at=new Date(now()).toISOString();
    const [site,bank,wa,room,draftApi]=await Promise.all([
      probe(async()=>(await fetchImpl(config.siteUrl+'/',{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(6000)})).status),
      probe(async()=>{
        if(!config.supabaseUrl || !config.publicKey)throw Error();
        const r=await fetchImpl(config.supabaseUrl+'/rest/v1/tomenota_publications?select=id&status=eq.published&limit=1',{method:'HEAD',redirect:'error',
          headers:{apikey:config.publicKey,Authorization:'Bearer '+config.publicKey,Prefer:'count=exact'},signal:AbortSignal.timeout(6000)});
        if(!r.ok)throw Error();const total=Number((r.headers.get('content-range') || '').split('/')[1]);
        return Number.isInteger(total) && total>=0?total:null;
      }),
      probe(()=>whatsapp('/status')),probe(()=>whatsapp('/newsroom')),probe(()=>drafts())
    ]);
    const item=(id,label,state,detail)=>({id,label,state,detail});
    const status=wa.ok?wa.value:null,news=room.ok?room.value:null;
    const workerAt=typeof news?.workerSeenAt==='number'?news.workerSeenAt:null;
    const workerFresh=workerAt!==null && workerAt<=now()+60000 && now()-workerAt<180000;
    const quota=news?.quota && Number.isInteger(news.quota.used) && Number.isInteger(news.quota.limit)?news.quota:null;
    const services=[
      item('site','Site público · tomezap.com.br',site.ok && site.value>=200 && site.value<400?'ok':'attention',site.ok?'Respondeu HTTP '+site.value+'.':'Não respondeu.'),
      item('banco','Banco de dados · Supabase',bank.ok?'ok':'attention',bank.ok?(bank.value===null?'Respondeu.':bank.value+' matéria(s) publicada(s) no banco.'):'Não respondeu à consulta pública.'),
      item('whatsapp','WhatsApp · grupo Comando Tome Nota',status?.connected && status?.group?'ok':'attention',status?status.connected?(status.group?'Conectado e com o grupo confirmado.':'Conectado, mas sem grupo confirmado.'):'Desconectado. Abra o pareamento.':'A ponte do WhatsApp não respondeu.'),
      item('robo','Robô de redação · servidor Hostinger',workerFresh?'ok':'attention',workerFresh?'Trabalhando: deu sinal há menos de 3 minutos.':'Sem sinal recente do trabalhador de redação.'),
      item('rascunhos','Rascunhos e aprovação · função Supabase',draftApi.ok?'ok':'attention',draftApi.ok?'Respondendo normalmente.':'A função de rascunhos não respondeu.'),
      item('gemini','Inteligência artificial · Gemini',quota?(quota.used>=quota.limit?'attention':'ok'):'unknown',quota?'Redações de hoje: '+quota.used+' de '+quota.limit+'.':'Uso do dia ainda não informado.')
    ];
    return {checkedAt:at,services,publishedTotal:bank.ok?bank.value:null};
  };
  return async()=>{
    if(cached && now()<until)return cached;
    pending ||= check().then(value=>{cached=value;until=now()+30000;return value;}).finally(()=>{pending=null;});
    return pending;
  };
}
