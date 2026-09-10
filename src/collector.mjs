import { canonicalKey, contentFingerprint, deterministicExtract, mapWithConcurrency, resilientAi, SourceCircuitBreaker } from './pipeline.mjs';

export async function collectSource({source,repository,fetchItems,normalizeWithAi,now=()=>Date.now(),gazetteer=[]}){
 const started=now(),breaker=new SourceCircuitBreaker(source.circuit);
 if(!breaker.canRun(started))return {skipped:true,reason:'circuito_aberto',retryAt:breaker.cooldownUntil};
 const log={sourceId:source.id,startedAt:new Date(started).toISOString(),rawItems:0,newItems:0,duplicates:0,errors:0,latencyMs:0};
 try{
  const raw=await fetchItems(source);log.rawItems=raw.length;
  // Resolve duplicatas dentro do lote antes do paralelismo. Sem isso, duas tarefas
  // simultâneas podem consultar o banco antes de a primeira gravar seu hash.
  const unique=[],repeated=[],byKey=new Map(),byContent=new Map();
  for(const candidate of raw){
   const prepared={...candidate,_canonicalKey:canonicalKey(candidate),_contentHash:contentFingerprint(candidate.content)};
   const primary=byKey.get(prepared._canonicalKey)||byContent.get(prepared._contentHash);
   if(primary)repeated.push({candidate:prepared,primary,reason:byKey.has(prepared._canonicalKey)?'duplicado_exato':'duplicado_conteudo'});
   else{unique.push(prepared);byKey.set(prepared._canonicalKey,prepared);byContent.set(prepared._contentHash,prepared);}
  }
  const outcomes=await mapWithConcurrency(unique,Math.min(source.concurrency||5,5),async candidate=>{
   const key=candidate._canonicalKey,exact=await repository.findByCanonicalKey(key);
   if(exact){await repository.recordDuplicate({originalId:exact.id,key,url:candidate.url,reason:'duplicado_exato'});log.duplicates++;return exact;}
   const same=await repository.findByContentHash(candidate._contentHash);
   if(same){await repository.recordDuplicate({originalId:same.id,key,url:candidate.url,reason:'duplicado_conteudo'});log.duplicates++;return same;}
   const item=await repository.createPending({...candidate,canonicalKey:key});candidate._item=item;log.newItems++;
   await repository.transition(item.id,'coletando','coleta_iniciada');
   const extraction=await resilientAi({call:()=>normalizeWithAi(candidate),fallback:()=>deterministicExtract(candidate.content,gazetteer)});
   await repository.update(item.id,{...extraction.value,hashContent:candidate._contentHash,aiDegraded:extraction.degraded,confidence:extraction.degraded?Math.min(49,extraction.value.confidence??30):extraction.value.confidence});
   await repository.transition(item.id,'normalizado','normalizacao_concluida');
   if(extraction.degraded&&!extraction.value.cities?.length){await repository.transition(item.id,'revisao','cidade_ausente');return item;}
   await repository.transition(item.id,'classificado','classificacao_concluida');
   await repository.transition(item.id,'deduplicado','deduplicacao_concluida');
   await repository.transition(item.id,'publicado','publicacao_no_painel');return item;
  });
  for(const o of outcomes)if(o.status==='rejected')log.errors++;
  for(const duplicate of repeated){
   const original=duplicate.primary._item||await repository.findByCanonicalKey(duplicate.primary._canonicalKey)||await repository.findByContentHash(duplicate.primary._contentHash);
   if(original){await repository.recordDuplicate({originalId:original.id,key:duplicate.candidate._canonicalKey,url:duplicate.candidate.url,reason:duplicate.reason});log.duplicates++;}
   else log.errors++;
  }
  breaker.success();await repository.updateSourceCircuit(source.id,breaker);return {...log,finishedAt:new Date(now()).toISOString(),latencyMs:now()-started,status:log.errors?'concluida_com_erros':'concluida'};
 }catch(error){const failure=breaker.failure(now());await repository.updateSourceCircuit(source.id,breaker);if(failure.alert)await repository.alert({sourceId:source.id,type:'circuito_aberto',message:'Fonte pausada após três falhas consecutivas.'});return {...log,finishedAt:new Date(now()).toISOString(),latencyMs:now()-started,status:'falhou',retryAt:failure.retryAt,circuitState:failure.state,errorCode:error.code||'COLLECT_FAILED'};}
}

export async function failItem({item,repository,stage,error}){
 const attempts=(item.attempts||0)+1;
 if(attempts>=3){await repository.update(item.id,{attempts});await repository.transition(item.id,'descartado','limite_tentativas');await repository.enqueueDlq({itemId:item.id,stage,attempts,errorCode:error.code||'FAILED',errorSummary:String(error.message||'Falha').slice(0,300)});return {dlq:true,attempts};}
 await repository.update(item.id,{attempts});await repository.transition(item.id,'pendente','falha_temporaria');return {dlq:false,attempts};
}
