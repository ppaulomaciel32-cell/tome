import {PanelError} from './auth.mjs';
export function createDraftReader(config,{fetchImpl=fetch}={}) {
  return async id=>{
    if(!config.draftsUrl || !config.draftsToken)throw new PanelError(503,'awaiting_connection','A busca e os rascunhos aguardam conexão no servidor.');
    const query=id?'draft&id='+id:'context';
    try {
      const response=await fetchImpl(config.draftsUrl+'?action='+query,{headers:{'x-draft-token':config.draftsToken},redirect:'error',signal:AbortSignal.timeout(12000)});
      if(response.status===404)throw new PanelError(404,'not_found','Rascunho não encontrado.');
      if(!response.ok)throw Error();
      const raw=await response.text();if(raw.length>180000)throw Error();
      const data=JSON.parse(raw);
      return data;
    }catch(error){if(error instanceof PanelError)throw error;throw new PanelError(503,'drafts_unavailable','Os rascunhos estão temporariamente indisponíveis. Nenhum texto foi publicado.');}
  };
}
