import {PanelError} from './auth.mjs';
export function createWhatsAppClient(config,{fetchImpl=fetch}={}) {
  return async function request(path,body) {
    if(!config.waConfigured)throw new PanelError(503,'awaiting_connection','A conexão WhatsApp ainda precisa ser instalada e configurada na VPS.');
    let response;
    try {
      response=await fetchImpl(config.waUrl+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(12000),
        headers:{'X-Bridge-Token':config.waToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    }catch{throw new PanelError(503,'bridge_unavailable','A conexão WhatsApp não respondeu. O restante do painel foi preservado.');}
    let data;try{data=await response.json();}catch{throw new PanelError(503,'bridge_unavailable','A conexão WhatsApp não respondeu corretamente.');}
    if(!response.ok){
      // Só encaminhar mensagens conhecidas do componente interno, nunca um erro bruto.
      const codes=new Set(['awaiting_configuration','confirmation_required','manual_attention','pairing_not_ready','not_connected','invalid_group','group_locked','wrong_group','bot_not_member','editor_not_member','unexpected_members','no_group','send_limit','busy','bridge_unavailable','manual_disabled','no_preview','already_decided','invalid_decision','queue_full']);
      if(codes.has(data.code) && typeof data.message==='string' && data.message.length<=300)throw new PanelError(response.status,data.code,data.message);
      throw new PanelError(503,'bridge_unavailable','Confira a configuração da conexão WhatsApp no servidor.');
    }
    return data;
  };
}
