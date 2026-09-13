// Parser restrito às fichas públicas do SAPL de SGA/CE; sem inferir prazos ou aprovação.
const clean=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
function field(html,id){
 const start=html.indexOf(`id="div_id_${id}"`);if(start<0)return '';
 const next=html.indexOf('id="div_id_',start+10);
 const block=html.slice(start,next<0?start+5000:next);
 const value=block.match(/class="form-control-static"[^>]*>([\s\S]*?)<\/div>/i);
 return value?clean(value[1]):'';
}
export function extractSaplMateria(html,url){
 const u=new URL(url);
 if(u.origin!=='https://sapl.saogoncalodoamarante.ce.leg.br'||!/^\/materia\/\d+\/?$/.test(u.pathname))throw Error('sapl_url_invalida');
 const heading=clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
 const ementa=field(html,'ementa'),presented=field(html,'data_apresentacao');
 if(!heading||ementa.length<30)throw Error('sapl_estrutura_invalida');
 const match=presented.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 const sourceDate=match?`${match[3]}-${match[2]}-${match[1]}`:null;
 if(sourceDate&&(Number.isNaN(Date.parse(sourceDate))||new Date(sourceDate).toISOString().slice(0,10)!==sourceDate))throw Error('sapl_data_invalida');
 return {title:(heading+' — '+ementa).slice(0,500),url,date:null,sourceDate,
  evidence:`${heading}. Ementa registrada no SAPL: ${ementa}. Data de apresentação registrada: ${presented||'não identificada'}. A data de apresentação não foi atribuída à data de publicação do documento. O registro de uma proposta não comprova sua aprovação ou execução.`};
}
