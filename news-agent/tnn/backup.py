"""Executar diariamente via cron do host; arquivos fora do diretório público."""
import gzip
import json
import os
from datetime import datetime,timezone
from pathlib import Path
from .providers import Ingest

def main():
    os.umask(0o077)
    root=Path(os.getenv('BACKUP_DIR','/backups'));root.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    temporary=root/f'agent-log-{stamp}.jsonl.gz.partial'
    ingest=Ingest();offset=0
    with gzip.open(temporary,'wt',encoding='utf-8') as file:
        while True:
            rows=ingest.call(query=f'?action=logs&offset={offset}')
            for row in rows:file.write(json.dumps(row,ensure_ascii=False)+'\n')
            if len(rows)<500:break
            offset+=500
    temporary.rename(root/f'agent-log-{stamp}.jsonl.gz')
    print('Exportação de agent_log concluída.')

if __name__=='__main__':main()
