const TELEMETRY_HEADERS=['x-omniroute-provider','x-omniroute-model','x-omniroute-strategy','x-omniroute-route-class','x-omniroute-cost-usd'];
export function createOmniRouteClient({baseUrl,apiKey,model,request=fetch,clock=()=>Date.now(),onTelemetry=async()=>{}}){
 const base=new URL(baseUrl);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw new TypeError('OMNIROUTE_BASE_URL inválida.');
 const root=base.href.replace(/\/$/,'');
 async function invoke(path,body,{itemId=null,stage}){
  const started=clock();let response;
  try{response=await request(root+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json();const h=Object.fromEntries(TELEMETRY_HEADERS.map(k=>[k,response.headers?.get?.(k)]).filter(([,v])=>v));
   const telemetry={itemId,stage,statusHttp:response.status,success:response.ok,latencyMs:clock()-started,provider:h['x-omniroute-provider']||null,modelRequested:body.model||model,modelUsed:h['x-omniroute-model']||data.model||null,strategy:h['x-omniroute-strategy']||null,costUsd:Number.isFinite(Number(h['x-omniroute-cost-usd']))?Number(h['x-omniroute-cost-usd']):null,promptTokens:data.usage?.prompt_tokens??null,completionTokens:data.usage?.completion_tokens??null,totalTokens:data.usage?.total_tokens??null,errorCode:response.ok?null:(data.error?.code||`HTTP_${response.status}`)};
   await onTelemetry(telemetry);if(!response.ok)throw Object.assign(Error(response.status===429?'OmniRoute ocupado.':'Falha no OmniRoute.'),{status:response.status,retryable:response.status===429||response.status>=500});return {data,telemetry};
  }catch(error){if(!response)await onTelemetry({itemId,stage,statusHttp:null,success:false,latencyMs:clock()-started,errorCode:'NETWORK_ERROR'});throw error;}
 }
 return {
  chat:(messages,options={})=>invoke('/chat/completions',{model:options.model||model,messages,response_format:options.responseFormat,max_tokens:options.maxTokens||1000,stream:false},{itemId:options.itemId,stage:options.stage||'chat'}),
  async embeddings(texts,options={}){const {data,telemetry}=await invoke('/embeddings',{model:options.model||model,input:texts},{itemId:options.itemId,stage:options.stage||'embeddings'});if(!Array.isArray(data.data)||data.data.length!==texts.length)throw Error('Resposta de embeddings inválida.');return {vectors:data.data.map(x=>x.embedding),telemetry};}
 };
}

