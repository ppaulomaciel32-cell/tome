// View-only defaults: collected candidates stay without a persisted draft.
export function draftForView(value) {
 const draft=value && typeof value==='object'?structuredClone(value):{};
 return {...draft,titulo_editorial:draft.titulo_editorial??'',texto_site:draft.texto_site??'',instagram:draft.instagram??'',stories:[0,1,2].map(i=>typeof draft.stories?.[i]==='string'?draft.stories[i]:'')};
}

export async function requestJSON(path,options={},fetcher=fetch,timeoutMs=30000) {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try {
  const response=await fetcher(path,{...options,signal:controller.signal});
  const content=await response.text();
  let data;try{data=JSON.parse(content)}catch{throw new Error('O servidor não retornou dados válidos. Tente atualizar em instantes.');}
  if(!response.ok)throw Object.assign(new Error(data.erro||'Não foi possível concluir a operação.'),{status:response.status});
  return data;
 }catch(error){
  if(controller.signal.aborted)throw new Error('O servidor demorou para responder. A ação pode ter sido registrada: atualize antes de tentar novamente.');
  throw error;
 }finally{clearTimeout(timer)}
}
