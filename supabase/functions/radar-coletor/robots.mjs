export function robotsPolicy(text,agent='RadarTomeNota'){
 const groups=[];let group=null,hasRules=false;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.replace(/#.*/,'').trim(),at=line.indexOf(':');if(at<0)continue;
  const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
  if(key==='user-agent'){
   if(!group||hasRules){group={agents:[],rules:[],delay:0};groups.push(group);hasRules=false}
   group.agents.push(value.toLowerCase());
  }else if(group){
   hasRules=true;
   if(['allow','disallow'].includes(key)&&value)group.rules.push({allow:key==='allow',path:value});
   if(key==='crawl-delay'&&Number.isFinite(Number(value))&&Number(value)>0)group.delay=Number(value);
  }
 }
 const name=agent.toLowerCase(),specificity=g=>Math.max(-1,...g.agents.map(a=>a==='*'?0:name.includes(a)?a.length:-1));
 const max=Math.max(-1,...groups.map(specificity));
 const selected=groups.filter(g=>max>=0&&specificity(g)===max);
 const rules=selected.flatMap(g=>g.rules);
 return {delay:Math.max(1,...selected.map(g=>g.delay)),allowed(url){
  const u=new URL(url),target=u.pathname+u.search;
  const matching=rules.filter(r=>{
   const end=r.path.endsWith('$'),p=end?r.path.slice(0,-1):r.path;
   const pattern=p.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
   return new RegExp('^'+pattern+(end?'$':'')).test(target);
  }).sort((a,b)=>b.path.replace(/\*/g,'').length-a.path.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow));
  return !matching.length||matching[0].allow;
 }};
}
