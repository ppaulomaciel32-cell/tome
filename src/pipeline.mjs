import { createHash } from 'node:crypto';

export const ITEM_STATES = Object.freeze(['pendente','coletando','normalizado','classificado','deduplicado','revisao','publicado','descartado']);
export const VALID_TRANSITIONS = Object.freeze({
  pendente: ['coletando','descartado'],
  coletando: ['normalizado','pendente','descartado'],
  normalizado: ['classificado','revisao','descartado'],
  classificado: ['deduplicado','revisao','descartado'],
  deduplicado: ['publicado','revisao','descartado'],
  revisao: ['pendente','normalizado','classificado','deduplicado','publicado','descartado'],
  publicado: [],
  descartado: ['pendente'],
});

const TRACKING = new Set(['fbclid','gclid','dclid','msclkid','mc_cid','mc_eid','igshid']);
export function normalizeUrl(input) {
  const url = new URL(input);
  if (!['http:','https:'].includes(url.protocol)) throw new TypeError('URL deve usar HTTP ou HTTPS.');
  url.hash = '';
  url.username = ''; url.password = '';
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_') || TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase().replace(/^www\./,'');
  url.pathname = url.pathname.replace(/\/amp\/?$/i,'').replace(/\/+$/,'') || '/';
  url.searchParams.sort();
  return url.toString();
}
export function normalizeTitle(title) {
  return String(title ?? '').normalize('NFKC').trim().toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').replace(/[\s.!?;:,–—-]+$/u,'');
}
export function sha256(value) { return createHash('sha256').update(String(value),'utf8').digest('hex'); }
export function canonicalKey({url,title,date}) {
  return sha256(JSON.stringify([normalizeUrl(url),normalizeTitle(title),date || null]));
}
export function contentFingerprint(text) {
  return sha256(String(text ?? '').normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim());
}

export class ItemStateMachine {
  constructor(item, transitions=[]) { if (!ITEM_STATES.includes(item.state)) throw new TypeError('Estado desconhecido.'); this.item={...item};this.transitions=transitions; }
  transition(next,{reason,origin='sistema',timestamp=new Date().toISOString(),details={}}) {
    if (!ITEM_STATES.includes(next) || !VALID_TRANSITIONS[this.item.state].includes(next)) throw new Error(`Transição inválida: ${this.item.state} → ${next}`);
    if (this.item.state==='revisao' && origin!=='manual') throw new Error('Saída de revisão exige ação manual.');
    if (this.item.state==='descartado' && !(origin==='manual' && reason==='reprocessamento_manual')) throw new Error('Item descartado só retorna por reprocessamento manual.');
    if (!reason) throw new Error('Motivo da transição é obrigatório.');
    const event=Object.freeze({item_id:this.item.id,estado_anterior:this.item.state,estado_novo:next,timestamp,motivo:reason,origem:origin,detalhes:structuredClone(details)});
    this.item={...this.item,state:next,discard_reason:next==='descartado'?reason:null,updated_at:timestamp};this.transitions.push(event);return event;
  }
}

const BACKOFF_MINUTES=[5,15,45,120,240];
export function backoffMs(failureNumber) { return BACKOFF_MINUTES[Math.min(Math.max(1,failureNumber)-1,BACKOFF_MINUTES.length-1)]*60_000; }
export class SourceCircuitBreaker {
  constructor({failures=0,state='fechado',cooldownUntil=null}={}) {this.failures=failures;this.state=state;this.cooldownUntil=cooldownUntil;}
  canRun(now=Date.now()) {
    if(this.state==='fechado'||this.state==='meio_aberto')return true;
    if(this.cooldownUntil!==null&&now>=this.cooldownUntil){this.state='meio_aberto';return true;}
    return false;
  }
  failure(now=Date.now()) {this.failures++;const delay=backoffMs(this.failures);if(this.failures>=3)this.state='aberto';this.cooldownUntil=now+delay;return {state:this.state,failures:this.failures,retryAt:this.cooldownUntil,alert:this.failures===3};}
  success(){this.failures=0;this.state='fechado';this.cooldownUntil=null;return {state:this.state,failures:0};}
}

export async function mapWithConcurrency(values,limit,worker){
  if(!Number.isInteger(limit)||limit<1||limit>5)throw new RangeError('Concorrência deve ficar entre 1 e 5.');
  const result=new Array(values.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(cursor<values.length){const index=cursor++;try{result[index]={status:'fulfilled',value:await worker(values[index],index)};}catch(reason){result[index]={status:'rejected',reason};}}}));
  return result;
}

export function deterministicExtract(text,gazetteer){
  const clean=String(text??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  const normalized=clean.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const cities=gazetteer.filter(city=>normalized.includes(city.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()));
  return {summary:clean.slice(0,500),cities:[...new Set(cities)],method:'deterministic_gazetteer',confidence:cities.length?45:20};
}

export async function resilientAi({call,fallback,attempts=1}){
  try{return {value:await call(),degraded:false};}catch(error){return {value:await fallback(error),degraded:true,attempts};}
}

