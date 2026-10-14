const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountAnalytics(main,request,onAuthError){
 let active=true;main.innerHTML='<h1>Audiência do jornal</h1><p role="status">Consultando os últimos 30 dias…</p>';
 request('/analytics').then(d=>{if(!active)return;if(!d.configured){main.innerHTML='<h1>Audiência do jornal</h1><p>Aguardando conexão com o Google Analytics. O ID público ativa a medição; o acesso de leitura do servidor ativa este resumo.</p>';return;}
 const table=(title,rows)=>'<section class="empty-card"><h2>'+title+'</h2><table><thead><tr><th>Origem / matéria</th><th>Visualizações</th></tr></thead><tbody>'+rows.map(([name,value])=>'<tr><td>'+esc(name)+'</td><td>'+esc(value)+'</td></tr>').join('')+'</tbody></table></section>';
 main.innerHTML='<h1>Audiência do jornal</h1><p>Últimos 30 dias · '+esc(d.views)+' visualizações de páginas. Não são visitantes únicos.</p><p>Somente pessoas que aceitaram cookies; relatórios podem ter atraso. Links do WhatsApp devem usar utm_source=whatsapp para atribuição confiável.</p>'+(d.truncated?'<p>Relatório parcial: limite de linhas atingido.</p>':'')+table('Por matéria',d.articles.map(a=>[a.title,a.views]))+table('Por localidade',Object.entries(d.localities))+table('Por origem',Object.entries(d.sources));
 }).catch(e=>{if(active){if(e.status===401)onAuthError(e);else main.innerHTML='<h1>Audiência do jornal</h1><p>'+esc(e.message)+'</p>';}});
 return()=>{active=false;};
}
