const SOCIAL = new Set(['instagram']);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const distinct=(items,key)=>new Set(items.map(key).filter(Boolean)).size;
const ageHours=(date,now)=>Math.max(0,(now-new Date(date).getTime())/3_600_000);

export function lexicalSimilarity(a,b){
 const tokens=s=>new Set(String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{4,}/g)||[]);
 const x=tokens(a),y=tokens(b),intersection=[...x].filter(v=>y.has(v)).length,union=new Set([...x,...y]).size;
 return union?intersection/union:0;
}
export function canJoinTopic(a,b,{threshold=.85,similarity=lexicalSimilarity}={}){
 const sameCity=(a.city??'')===(b.city??'');
 const entities=new Set(a.entities||[]),shared=(b.entities||[]).some(e=>entities.has(e));
 const hours=Math.abs(new Date(a.occurredAt)-new Date(b.occurredAt))/3_600_000;
 return {join:sameCity&&shared&&hours<=48&&similarity(a.text,b.text)>=threshold,score:similarity(a.text,b.text),method:similarity===lexicalSimilarity?'lexical':'embedding'};
}
export function clusterItems(items,options={}){
 const clusters=[];
 for(const item of [...items].sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt))){let best=null;
  for(const cluster of clusters){const match=canJoinTopic(cluster.items.at(-1),item,options);if(match.join&&(!best||match.score>best.match.score))best={cluster,match};}
  if(best)best.cluster.items.push({...item,clusterMethod:best.match.method,similarity:best.match.score});else clusters.push({city:item.city??null,items:[{...item,clusterMethod:'seed',similarity:1}]});
 }return clusters;
}

const cosine=(a,b)=>{let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;};
export async function clusterWithFallback(items,{embeddingProvider,embeddingThreshold=.85,lexicalThreshold=.35}={}){
 try{
  const vectors=await embeddingProvider(items.map(i=>i.text));
  if(!Array.isArray(vectors)||vectors.length!==items.length)throw Error('Embeddings incompletos.');
  const tagged=items.map((x,i)=>({...x,_vector:vectors[i]}));
  return {clusters:clusterItems(tagged,{threshold:embeddingThreshold,similarity:(a,b)=>cosine(a._vector,b._vector)}),degraded:false,confidence:'normal'};
 }catch{
  return {clusters:clusterItems(items,{threshold:lexicalThreshold,similarity:lexicalSimilarity}),degraded:true,confidence:'baixa'};
 }
}

export function baseline24h(history,now=Date.now()){
 const start=now-8*86_400_000,end=now-86_400_000;const counts=Array(7).fill(0);
 for(const i of history){const t=new Date(i.occurredAt).getTime();if(t>=start&&t<end){const bucket=Math.min(6,Math.floor((t-start)/86_400_000));counts[bucket]++;}}
 return counts.reduce((a,b)=>a+b,0)/7;
}
export function evaluateTopic(items,{now=Date.now(),history=[],platform=null,editorialCorroboration=false}={}){
 const current=items.filter(i=>ageHours(i.occurredAt,now)<=24),count=current.length,sources=distinct(current,i=>i.sourceId),authors=distinct(current,i=>i.authorId),base=baseline24h(history,now),growth=(count-base)/Math.max(base,1);
 const recent=current.some(i=>ageHours(i.occurredAt,now)<=6),instagram=platform==='instagram'||(current.length>0&&current.every(i=>SOCIAL.has(i.platform)));
 const trend=instagram ? count>=10&&authors>=5&&growth>=1&&recent&&editorialCorroboration : count>=5&&sources>=3&&growth>=1&&recent;
 const emerging=!trend&&count>=2&&sources>=2;
 const label=trend?'tendencia':emerging?'emergindo':'sinal_fraco';
 const confidence=clamp(Math.round((current.reduce((n,i)=>n+(i.confidence||0),0)/Math.max(count,1))*.7+Math.min(30,sources*7.5)),0,100);
 const explanation=`${count} ${count===1?'item':'itens'}, ${sources} ${sources===1?'fonte':'fontes'}, nas últimas 24h, ${Math.round(growth*100)}% em relação à média de ${base.toFixed(1)}; última ocorrência ${current.length?Math.round(Math.min(...current.map(i=>ageHours(i.occurredAt,now))))+'h atrás':'ausente'}.`;
 return {label,count24h:count,sources24h:sources,authors24h:authors,baseline24h:base,growth,recent,instagram,editorialCorroboration,confidence,explanation,minimums:{volume:instagram?count>=10:count>=5,diversity:instagram?authors>=5:sources>=3,growth:growth>=1,recent,corroboration:instagram?editorialCorroboration:true}};
}

export function nextLifecycle(current,{growth,previousGrowth,fallingWindows=0,lastOccurrence,now=Date.now(),peakGrowth=0}){
 if(!lastOccurrence||ageHours(lastOccurrence,now)>=24*7)return {state:'encerrado',fallingWindows,peakGrowth:Math.max(peakGrowth,growth)};
 const peak=Math.max(peakGrowth,growth);const falling=growth<previousGrowth?fallingWindows+1:0;
 if(falling>=2)return {state:'esfriando',fallingWindows:falling,peakGrowth:peak};
 if(growth>=peak&&growth>0)return {state:'pico',fallingWindows:falling,peakGrowth:peak};
 if(growth>previousGrowth)return {state:'crescendo',fallingWindows:falling,peakGrowth:peak};
 return {state:current==='encerrado'?'emergindo':current,fallingWindows:falling,peakGrowth:peak};
}

export async function advanceLifecycle(topic,metrics,repository){
 const next=nextLifecycle(topic.cycle,{...metrics,fallingWindows:topic.fallingWindows,peakGrowth:topic.peakGrowth});
 await repository.updateTopic(topic.id,{cycle:next.state,fallingWindows:next.fallingWindows,peakGrowth:next.peakGrowth});
 if(next.state!==topic.cycle)await repository.recordLifecycleTransition({topicId:topic.id,previous:topic.cycle,next:next.state,reason:next.state==='encerrado'?'sem_ocorrencia_7_dias':next.state==='esfriando'?'queda_em_duas_janelas':'metricas_atualizadas',metrics});
 return next;
}

