import importlib.util
import os
from .core import https,phone

def main():
    names=['META_TOKEN','META_PHONE_ID','META_GRAPH_VERSION','META_APP_SECRET','WEBHOOK_VERIFY_TOKEN',
      'DRAEL_API_KEY','TAVILY_API_KEY','CLOUDINARY_URL','CLOUDINARY_UPLOAD_PRESET','INGEST_URL',
      'INGEST_SERVICE_TOKEN','WHITELIST_NUMBERS','AGENT_PUBLIC_URL','TRUSTED_SOURCE_DOMAINS','REDIS_URL']
    missing=[name for name in names if not os.getenv(name,'').strip()]
    errors=[]
    for name in ['INGEST_URL','AGENT_PUBLIC_URL','SITE_URL']:
        if not https(os.getenv(name,'')):errors.append(name+' precisa ser HTTPS')
    for name in ['INGEST_SERVICE_TOKEN','WEBHOOK_VERIFY_TOKEN','META_APP_SECRET']:
        if len(os.getenv(name,''))<32:errors.append(name+' precisa ter pelo menos 32 caracteres')
    if not all(phone(n) for n in os.getenv('WHITELIST_NUMBERS','').split(',')):errors.append('whitelist inválida')
    if importlib.util.find_spec('faster_whisper') is None:errors.append('transcrição local não instalada')
    if missing or errors:
        print('Pendente: '+', '.join(missing+errors));raise SystemExit(1)
    print('Configurações presentes. Credenciais, HTTPS, modelo e serviços externos ainda precisam de teste real.')

if __name__=='__main__':main()
