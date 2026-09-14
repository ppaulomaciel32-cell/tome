export const cities=['São Gonçalo do Amarante','Pecém','Taíba','Siupé','Paracuru','Paraipaba','Caucaia'];
export const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const safeSource=s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}};
export function editorialSignals(p,now=Date.now()){
 const reasons=[],pending=[],day=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza'}).format(new Date(now)),doc=p.data_documento;
 const age=doc?(Date.parse(day)-Date.parse(doc))/86400000:null;
 const old=age!==null&&age>7,future=age!==null&&age<0;
 const generic=/^(pagina inicial|prefeitura de [\w\s]+|documento sem titulo)$/.test(normalize(p.titulo).split(' - ')[0]);
 let points=20;
 if(safeSource(p.url_fonte)){points+=10;reasons.push('Link HTTP/HTTPS registrado: +10')}else pending.push('Link da fonte ausente ou inválido');
 if(p.tem_evidencia){points+=10;reasons.push('Evidência registrada: +10')}else pending.push('Falta registrar evidência');
 if(doc&&!old&&!future){points+=15;reasons.push('Documento dos últimos 7 dias: +15')}
 if(!doc)pending.push('Data do documento a conferir');
 if(!p.data_fato)pending.push('Data do fato a conferir');
 if(old){points-=25;pending.push('Documento antigo: não tratar como novidade')}
 if(future){points-=20;pending.push('Data do documento no futuro: conferir')}
 if(generic){points-=25;pending.push('Possível página institucional, sem notícia individual')}
 if(/vaga|emprego|abastecimento|transporte|edital|inscri[cç][aã]o|energia/i.test(p.titulo)){points+=15;reasons.push('Sinal de utilidade no título: +15')}
 if(p.evidencia_conferida){points+=20;reasons.push('Evidência conferida nesta versão: +20')}
 if(p.revisao_sensivel||/pol[ií]cia|sa[uú]de|pol[ií]tica|acidente|morte|den[uú]ncia/i.test(p.categoria+' '+p.titulo))pending.push('Revisão humana de assunto sensível');
 return {points:Math.max(0,Math.min(100,points)),reasons:['Base de triagem: 20',...reasons,...(old?['Documento antigo: −25']:[]),...(generic?['Título institucional: −25']:[]),...(future?['Data futura: −20']:[])],pending,old,future,generic,workable:!old&&!generic&&!future&&!['aprovada','descartada'].includes(p.status)};
}
export function sourceHealth(f,runs,now=Date.now()){
 const own=runs.filter(x=>x.fonte_id===f.id),last=own[0];
 if(!f.ativa)return {state:'off',label:'Desativada',detail:f.ultimo_erro_texto||'Coleta desativada.'};
 if(f.estado_circuito==='aberto'||f.ultimo_erro_texto)return {state:'error',label:'Falha na fonte',detail:f.ultimo_erro_texto||'Circuito aberto; nova tentativa agendada.'};
 if(f.proxima_varredura&&Date.parse(f.proxima_varredura)<now-20*60000)return {state:'warning',label:'Coleta atrasada',detail:'Prazo de varredura ultrapassado há mais de 20 minutos.'};
 if(!f.ultimo_sucesso)return {state:'warning',label:'Sem coleta confirmada',detail:'Ainda não há sucesso registrado.'};
 if(last&&last.documentos_lidos===0)return {state:'warning',label:'Sem documentos recentes',detail:'O site respondeu, mas a última rodada não encontrou documentos elegíveis. Verificar filtro e extração.'};
 return {state:'ok',label:'Coleta respondendo',detail:last?`${last.candidatos_criados} candidatos · ${last.duplicados} duplicados na última rodada.`:'Último acesso bem-sucedido registrado.'};
}
export function dashboardData(raw,now=Date.now()){
 const pautas=(raw.pautas||[]).map(p=>({...p,signals:editorialSignals(p,now)}));
 const sources=(raw.fontes||[]).map(f=>({...f,health:sourceHealth(f,raw.coletas_24h||[],now)}));
 const cityCounts=cities.map(city=>({city,total:pautas.filter(p=>normalize(p.localidade).includes(normalize(city))).length,work:pautas.filter(p=>normalize(p.localidade).includes(normalize(city))&&p.signals.workable).length}));
 const recent=pautas.filter(p=>Date.parse(p.criada_em)>=now-86400000).length;
 return {...raw,pautas,sources,cityCounts,recent,work:pautas.filter(p=>p.signals.workable),pending:pautas.filter(p=>p.signals.pending.length&&!['aprovada','descartada'].includes(p.status))};
}
