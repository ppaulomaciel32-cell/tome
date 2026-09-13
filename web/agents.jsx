import React,{useState,useEffect,useRef} from 'react';
const date=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}):'Ainda sem registro';
const url=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}};
export default function Agents({request,open}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[opening,setOpening]=useState(null);
 const req=useRef(request);req.current=request;
 useEffect(()=>{let alive=true,timer;async function load(){try{const next=await req.current('/agentes');if(alive){setData(next);setError('')}}catch(e){if(alive)setError(e.message)}finally{if(alive)timer=setTimeout(load,30000)}}load();return()=>{alive=false;clearTimeout(timer)}},[]);
 async function openItem(id){setOpening(id);try{open(await req.current('/pautas/'+id))}catch(e){setError(e.message)}finally{setOpening(null)}}
 return <section className="panel"><p className="eyebrow">MONITORAMENTO AUTOMÁTICO / PRIMEIRA ETAPA</p><h2>Agentes da redação</h2>
 <p>A coleta roda no servidor. Atribuição por regras de título e fonte; Gemini não é usado nesta etapa. Instagram ainda não conectado.</p>
 {error&&<p role="alert">Não foi possível atualizar: {error}. {data?'Os dados abaixo são da última consulta bem-sucedida.':'Nova tentativa em até 30 segundos.'}</p>}
 {!data&&!error&&<p role="status">Consultando agentes e fontes…</p>}
 {data&&<><p className="footnote">Consulta: {date(data.servidor_em)} · Atualização do painel a cada 30 segundos · Horários de Fortaleza.</p>
 <div className="dashboard-stats">{data.agentes.map(a=><article className="evidence" key={a.id}><p className="eyebrow">AGENTE {String(a.numero).padStart(2,'0')}</p><h3>{a.nome}</h3><strong>{a.atribuicoes} candidatos atribuídos</strong><p className="footnote">{a.ativo?(a.fontes_disponiveis?'Triagem habilitada · fontes compartilhadas':'Sem fonte disponível'):'Pausado'}<br/>Última atribuição: {date(a.ultima_atribuicao)}</p><details><summary>Regra editorial</summary><p>{a.instrucao}</p>{a.revisao_sensivel&&<p>Assunto sensível: revisão humana explícita.</p>}</details></article>)}</div>
 <h3>Entradas atribuídas automaticamente</h3>{!data.execucoes.length&&<p>Nenhum candidato novo atribuído desde a implantação. A próxima coleta pode encontrar apenas duplicados; isso não é falha.</p>}
 {data.execucoes.map(e=><article className="record" key={e.id}><p className="eyebrow">{e.agente} · {e.codigo}</p><h3>{e.titulo}</h3><p>{e.motivo}</p><p className="footnote">Fonte: {e.fonte} · Entrada: {date(e.fim)}<br/>Documento: {e.data_documento||'a conferir'} · Fato: {e.data_fato||'a conferir'}<br/>IA: {e.chamadas_ia} chamadas · {e.tokens} tokens · US$ {e.custo_ia_usd} · Infraestrutura: {e.custo_infra_usd===null?'custo não informado':e.custo_infra_usd}<br/>Tempo de atribuição: {Number(e.latencia_ms).toFixed(1)} ms</p><div className="actions"><button disabled={opening!==null} onClick={()=>openItem(e.pauta_id)}>{opening===e.pauta_id?'Abrindo…':'Abrir pauta e evidência'}</button>{url(e.url_fonte)&&<a href={url(e.url_fonte)} target="_blank" rel="noopener noreferrer">Fonte original ↗</a>}</div></article>)}
 <details><summary>Saúde das {data.fontes.length} fontes</summary>{data.fontes.map(f=><article className="record" key={f.id}><strong>{f.nome}</strong><p>{!f.ativa?'Desativada':f.estado_circuito==='aberto'?'Pausada por falhas':'Monitoramento habilitado'}</p><p className="footnote">Última tentativa: {date(f.ultima_varredura)}<br/>Último sucesso: {date(f.ultimo_sucesso)}<br/>Próxima varredura elegível: {date(f.proxima_varredura)} · O agendador verifica a fila a cada 15 minutos.</p>{f.ultimo_erro_texto&&<p>{f.ultimo_erro_texto}</p>}</article>)}</details></>}
 </section>;
}
