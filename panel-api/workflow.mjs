// Observador somente-leitura. Não gera texto, envia mensagens ou publica.
const stages = new Set(['coleta','redacao','rascunho','previa','fim']);
const codes = new Set(['ok','no_candidates','weak_sources','already_seen','queue_full','quota_limit','collect_failed','write_failed','store_failed','preview_failed','internal_error']);
const states = new Set(['running','completed','skipped','failed','queue_full','awaiting_configuration','not_implemented']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const errors = {weak_sources:'Faltou fonte: nenhuma oficial nem duas independentes para a pauta.',collect_failed:'A coleta falhou.',write_failed:'A redação falhou.',store_failed:'O armazenamento falhou.',preview_failed:'O envio da prévia falhou.',quota_limit:'A cota local foi atingida.',queue_full:'A fila de rascunhos está cheia.',no_candidates:'A busca não encontrou uma nova pauta elegível.',already_seen:'O assunto já foi registrado.',internal_error:'O ciclo precisa de conferência.'};
export function safeCycle(value, now) {
  if (!value || !states.has(value.state ?? value.status)) return null;
  const stamp = value.at ?? value.atualizado_em ?? value.criado_em;
  const at = typeof stamp === 'number' ? stamp : Date.parse(stamp);
  if (!Number.isFinite(at) || at > now + 60000) return null;
  const state=value.state ?? value.status;
  return {state, stage:stages.has(value.stage ?? value.etapa)?value.stage ?? value.etapa:null,
    code:codes.has(value.code ?? value.codigo)?value.code ?? value.codigo:null,
    at:new Date(at).toISOString(), stale:value.stale===true || now-at>(state==='running'?15:45)*60000};
}
async function limitedJSON(response, max=30000) {
  const reader=response.body?.getReader(); if(!reader)throw Error();
  const chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error();chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function createWorkflowReader(config,{whatsapp,drafts,fetchImpl=fetch,now=Date.now}={}) {
  let cached=null, until=0, pending=null;
  const observation=async()=>{
    const started=now();
    const [waResult,draftResult,siteResult,newsResult]=await Promise.allSettled([
      whatsapp('/status'), drafts(),
      // Destinos fixos de configuração, nunca URL recebida do navegador.
      fetchImpl(config.siteUrl+'/',{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(6000)}),
      config.supabaseUrl && config.publicKey ? (async()=>{
        const response=await fetchImpl(config.supabaseUrl+'/rest/v1/tomenota_publications?select=id,title,slug,published_at&status=eq.published&order=published_at.desc&limit=5',{
          headers:{apikey:config.publicKey,Authorization:'Bearer '+config.publicKey},redirect:'error',signal:AbortSignal.timeout(6000)});
        if(!response.ok)throw Error();
        const data=await limitedJSON(response);
        if(!Array.isArray(data))throw Error();
        return data.filter(d=>uuid.test(d.id || '') && typeof d.title==='string' && d.title.length<=300 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug || '') && d.slug.length<=240 && Number.isFinite(Date.parse(d.published_at)) && Date.parse(d.published_at)<=now()).slice(0,5)
          .map(d=>({id:d.id,title:d.title,slug:d.slug,publishedAt:new Date(d.published_at).toISOString()}));
      })() : Promise.reject(Error())
    ]);
    const wa=waResult.status==='fulfilled'?waResult.value:null;
    const data=draftResult.status==='fulfilled'?draftResult.value:null;
    const cycle=safeCycle(wa?.cycle,now()) || safeCycle(data?.cycle,now());
    const events=(Array.isArray(wa?.cycleEvents)?wa.cycleEvents:[]).slice(-12).map(v=>safeCycle(v,now())).filter(Boolean);
    const draftRows=Array.isArray(data?.drafts)?data.drafts:[];
    const recentDrafts=draftRows.filter(d=>uuid.test(d.id || '') && typeof d.titulo==='string' && d.titulo.length<=300).slice(0,5)
      .map(d=>({id:d.id,title:d.titulo}));
    const site=siteResult.status==='fulfilled'?siteResult.value.status:null;
    const publications=newsResult.status==='fulfilled'?newsResult.value:null;
    const workerFresh=typeof wa?.manual?.workerSeenAt==='number' && wa.manual.workerSeenAt<=now()+60000 && now()-wa.manual.workerSeenAt<120000;
    const manualReady=wa?.manual?.enabled===true && workerFresh && data?.capabilities?.manual===true;
    const publisherReady=manualReady && wa?.manual?.publisherReady===true;
    const station=(id,state,detail)=>({id,state,detail});
    const list=[
      station('whatsapp',wa?wa.connected===true?(wa.group?'ready':'blocked'):'blocked':'unknown',wa?wa.connected===true?(wa.group?'Chip conectado e grupo selecionado. Isso não comprova que a IA está ativa.':'Chip conectado; confirme o grupo na tela de pareamento.'):'A ponte respondeu, mas o chip não está conectado.':'Não foi possível consultar a ponte WhatsApp.'),
      station('coleta','unknown','Sem informação recente do trabalhador de redação.'),
      station('redacao','unknown','Sem informação recente de uma chamada ao Gemini.'),
      station('revisao',data?'waiting':'unknown',data?recentDrafts.length?recentDrafts.length+' rascunho(s) recente(s) para ler.':'Nenhum rascunho salvo.':'A leitura privada dos rascunhos ainda não respondeu.'),
      station('publicacao',publisherReady?'waiting':'blocked',publisherReady?'Publicador pronto. Cada texto precisa da sua aprovação: APROVAR e o número no grupo, ou o botão Aprovar no painel.':'A aprovação/publicação manual aguarda configuração e confirmação do trabalhador.'),
      station('site',site>=200 && site<300?'ready':site?'blocked':'unknown',site>=200 && site<300?'O site respondeu HTTP '+site+'. Isso não confirma uma matéria no ar.':site?'O site respondeu HTTP '+site+'.':'Não foi possível verificar o site público.')
    ];
    if(cycle && !cycle.stale){
      for(const id of ['coleta','redacao']){
        const s=list.find(x=>x.id===id);
        if(cycle.state==='running'){
          if(cycle.stage===id){s.state='working';s.detail=id==='coleta'?'O trabalhador informou que está apurando as fontes.':'O trabalhador informou que está na etapa Gemini.';}
          else {s.state='waiting';s.detail='Há um ciclo em andamento; esta etapa não está marcada como ativa.';}
        }else if(cycle.state==='failed'){s.state='blocked';s.detail=errors[cycle.code] || 'O último ciclo falhou. Confira os registros.';}
        else if(cycle.state==='completed'){s.state='waiting';s.detail='Último ciclo concluído; não há trabalho ativo informado agora.';}
        else {s.state='waiting';s.detail=errors[cycle.code] || 'Aguardando o próximo ciclo/configuração.';}
      }
      if(cycle.state==='running' && cycle.stage==='rascunho'){
        const s=list.find(x=>x.id==='revisao');s.state='working';s.detail='O trabalhador está salvando o rascunho privado, antes de enviar a prévia.';
      }
      if(cycle.state==='running' && cycle.stage==='previa' && wa?.connected && wa?.group){
        list[0].state='working';list[0].detail='O trabalhador informou que está enviando a prévia ao grupo. Ainda não há confirmação de entrega.';
      }
    }
    const blockers=[];
    if(!publisherReady)blockers.push({id:'publication_not_implemented',text:'A aprovação aguarda configuração da assinatura, da função editorial e do trabalhador.'});
    if(!manualReady)blockers.push({id:'manual_pauta_not_implemented',text:'A fila manual está sem confirmação de configuração/trabalhador. O texto ainda não pode virar matéria neste estado.'});
    if(manualReady)blockers.push({id:'human_approval',text:'Nada vai ao site sozinho: leia a prévia e aprove pelo grupo (APROVAR e o número) ou pelo botão em Rascunhos.'});
    if(!wa || !wa.connected || !wa.group)blockers.unshift({id:'whatsapp',text:list[0].detail});
    if(!data)blockers.push({id:'drafts_unavailable',text:'A API de rascunhos/tokens precisa ser conferida na VPS e no Supabase.'});
    if(!cycle)blockers.push({id:'no_cycle',text:'Nenhum ciclo com horário válido foi informado. Não é possível afirmar que o robô está produzindo.'});
    else if(cycle.stale)blockers.push({id:'stale_cycle',text:'O ciclo está sem atualização recente. A tela não o mostra como trabalhando.'});
    return {schemaVersion:1,observedAt:new Date(started).toISOString(),mode:'live',stations:list,cycle,events,
      drafts:recentDrafts,publications,siteHttpStatus:site,blockers,
      capabilities:{manualPauta:manualReady,approval:publisherReady,publication:publisherReady},
      limits:{pollSeconds:15,cycleMinutes:20,draftsListed:recentDrafts.length,publicationCheck:'database_only'},
      rules:[wa?.manual?.acceptOwnCommands===true?'O próprio número pode enviar pautas/comandos no grupo confirmado; respostas do robô são descartadas para evitar loop.':'Mensagens do próprio número aguardam WA_ACCEPT_OWN_COMMANDS=true na ponte.','A conexão do WhatsApp por QR não é oficial e tem risco de bloqueio do número.']};
  };
  return async()=>{
    if(cached && now()<until)return cached;
    pending ||= observation().then(value=>{cached=value;until=now()+10000;return value;}).finally(()=>{pending=null;});
    return pending;
  };
}
