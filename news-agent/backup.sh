#!/bin/sh
set -eu
umask 077
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
# SAVE serializa o estado corrente com sucesso antes da cópia.
docker compose exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli SAVE' >/dev/null
docker compose cp redis:/data/dump.rdb "backups/redis-$stamp.rdb"
chmod 600 "backups/redis-$stamp.rdb"
docker compose exec -T agente python -m tnn.backup
echo 'Backup do Redis e exportação de agent_log concluídos.'
