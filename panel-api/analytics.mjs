import {createSign} from 'node:crypto';
import {PanelError} from './auth.mjs';
export function createAnalytics(config,{fetchImpl=fetch,now=Date.now,env=process.env}={}){
  let cached=null,until=0,pending;
  return async()=>{
    if(!/^\d+$/.test(env.GA4_PROPERTY_ID || '') || !env.GA4_SERVICE_ACCOUNT_EMAIL || !env.GA4_PRIVATE_KEY)return {configured:false};
    if(now()<until)return cached;if(pending)return pending;
    pending=(async()=>{
      try{
        const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url'),t=Math.floor(now()/1000);
        const claim=b64({alg:'RS256',typ:'JWT'})+'.'+b64({iss:env.GA4_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',iat:t,exp:t+300});
        const signer=createSign('RSA-SHA256');signer.update(claim);
        const assertion=claim+'.'+signer.sign(env.GA4_PRIVATE_KEY.replaceAll('\\n','\n'),'base64url');
        const token=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
        if(!token.ok)throw Error();const auth=await token.json();if(!auth.access_token)throw Error();
        const rows=[];let truncated=false;
        for(let offset=0;offset<10000;offset+=1000){
          const r=await fetchImpl('https://analyticsdata.googleapis.com/v1beta/properties/'+env.GA4_PROPERTY_ID+':runReport',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+auth.access_token,'Content-Type':'application/json'},body:JSON.stringify({dateRanges:[{startDate:'29daysAgo',endDate:'today'}],dimensions:[{name:'pagePath'},{name:'sessionSourceMedium'}],metrics:[{name:'screenPageViews'}],limit:'1000',offset:String(offset)})});
          if(!r.ok)throw Error();const data=await r.json();rows.push(...(data.rows || []));if(rows.length>=Number(data.rowCount || 0))break;if(offset===9000)truncated=true;
        }
        const metadata=[];
        for(let offset=0;offset<50000;offset+=500){
          const r=await fetchImpl(config.supabaseUrl+'/rest/v1/tomenota_publications?select=slug,title,localidade&status=eq.published&order=slug.asc&limit=500&offset='+offset,{headers:{apikey:config.publicKey,Authorization:'Bearer '+config.publicKey},redirect:'error',signal:AbortSignal.timeout(8000)});
          if(!r.ok)throw Error();const page=await r.json();metadata.push(...page);if(page.length<500)break;
        }
        const articles=new Map(),locals={},sources={whatsapp:0,google:0,instagram:0,direto:0,outros:0};let views=0;
        for(const row of rows){
          const path=row.dimensionValues?.[0]?.value || '',source=row.dimensionValues?.[1]?.value || '',value=Number(row.metricValues?.[0]?.value || 0);
          if(!Number.isFinite(value)||value<0)continue;views+=value;
          const channel=/whatsapp|wa\.me/i.test(source)?'whatsapp':/instagram|^ig\b/i.test(source)?'instagram':/google/i.test(source)?'google':/\(direct\)/i.test(source)?'direto':'outros';sources[channel]+=value;
          const slug=/^\/noticia\/([a-z0-9-]+)\/$/.exec(path)?.[1],item=metadata.find(x=>x.slug===slug);
          if(item){const a=articles.get(slug)||{slug,title:item.title,localidade:item.localidade,views:0};a.views+=value;articles.set(slug,a);locals[item.localidade]=(locals[item.localidade]||0)+value;}
        }
        cached={configured:true,days:30,views,articles:[...articles.values()].sort((a,b)=>b.views-a.views),localities:locals,sources,truncated,updatedAt:new Date(now()).toISOString()};until=now()+5*60000;return cached;
      }catch{throw new PanelError(503,'analytics_unavailable','As estatísticas aguardam configuração ou estão temporariamente indisponíveis.');}
      finally{pending=null;}
    })();return pending;
  };
}
