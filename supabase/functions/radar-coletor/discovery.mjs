export function nextUnseenLinks(links,known,limit=1){
 const canonical=x=>{const u=new URL(x);u.hash='';u.pathname=u.pathname.replace(/\/+$/,'');return u.toString()};
 const seen=new Set(known.map(canonical));
 const unique=[...new Set(links)];
 const unseen=unique.filter(x=>!seen.has(canonical(x)));
 // Depois de esgotar as novas URLs, revisita a primeira para checar mudanças.
 return (unseen.length?unseen:unique).slice(0,limit);
}
export function explicitArticleDate(html){
 const tags=[...html.matchAll(/<meta\b[^>]*>/gi)].map(x=>x[0]);
 for(const tag of tags){
  if(!/(?:property|name)=["'](?:article:published_time|datePublished|datepublished)["']/i.test(tag))continue;
  const date=tag.match(/content=["'](\d{4}-\d{2}-\d{2})/i)?.[1];if(date)return date;
 }
 return html.match(/["']datePublished["']\s*:\s*["'](\d{4}-\d{2}-\d{2})/i)?.[1]||null;
}
