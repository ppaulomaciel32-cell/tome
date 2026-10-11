# WhatsApp por QR Code — marco 1

Código implementado e testado localmente. **Ainda não instalado nem pareado na VPS.**

A tela protegida usa o login do painel já existente. Depois de entrar como dono,
`https://bot.tomezap.com.br/conectar` permite iniciar o pareamento do **chip dedicado**,
escolher o grupo **Comando Tome Nota** e enviar uma mensagem de teste explícita.
Somente `STATUS` funciona como comando de consulta. Os comandos de produção respondem
que o módulo ainda não foi ativado. Este componente não tem acesso de escrita ao
Supabase, não chama Gemini e não consegue publicar uma matéria.

A instalação, os testes e os próximos passos estão em
[`docs/ROBO_WHATSAPP_MARCO_1.md`](../docs/ROBO_WHATSAPP_MARCO_1.md).

## Por que um serviço separado

Baileys usa Node e uma conexão WebSocket persistente. O agente existente é Python.
Isolar o transporte em `whatsapp` preserva o agente, o painel e os demais serviços.
O componente usa o **mesmo projeto Docker do painel**, uma porta apenas interna e
um token exclusivo entre os dois serviços. A troca de transporte foi pedida pelo
proprietário. Redis, redação, ingestão e tabelas do painel serão integrados nos
próximos marcos, depois da revisão deste.

Não é a API oficial da Meta. O número pode ser bloqueado, mesmo com baixo volume.
Baileys está fixado em `7.0.0-rc14` no arquivo de dependências e no lockfile: é uma
versão de pré-lançamento. O teste em um chip real ainda é obrigatório. A versão
inclui a correção do aviso de segurança GHSA-qvv5-jq5g-4cgg; o código também descarta
histórico, eventos com requestId e identidades não autorizadas.

## Arquivos principais

- `controller.mjs`: estados, QR temporário, reconexão, grupo, remetentes, deduplicação e limite de envio.
- `baileys-adapter.mjs`: integração real com Baileys e geração de PNG do QR, sem usar serviço externo.
- `vault.mjs`: credenciais e chaves Signal em SQLite, com registros criptografados e escrita atômica.
- `safe-log.mjs`: impede logs de sessões emitidos por dependências; registra só eventos próprios permitidos.
- `server.mjs`: API interna protegida, estado e encerramento controlado.
- `backup-session.mjs`: cópia consistente da sessão criptografada, sem parar o serviço.
- `.env.example`: configuração de exemplo, sem chaves ou números pessoais.
- `Dockerfile`, `package.json`, `package-lock.json`: instalação reproduzível do componente.

## Limites e persistência

Apenas uma instância deve usar o volume `/opt/tome-news/sessao-wa`.
Não escalar réplicas. O cofre usa SQLite local para a sessão; isto **não substitui**
o Redis do pipeline de redação. O processo precisa de Node 24; o painel permanece
sem novas dependências NPM. A imagem usa Debian slim para compatibilidade com as
dependências do Baileys. O build do site público permanece igual.

O volume guarda credenciais, chaves Signal, grupo escolhido, últimos estados,
recibos de deduplicação e a reserva de até **20 tentativas de envio por hora**.
Tentativas que falham também consomem o limite. Reiniciar não zera a reserva.
Até 20 mensagens recentes do próprio robô ficam criptografadas para atender
retransmissões do protocolo; não há armazenamento do histórico das conversas.

Os nomes dos registros são hashes e os valores usam AES-256-GCM. O arquivo é 0600,
o diretório é 0700 e a chave fica no ambiente da VPS. Protege o arquivo e suas
cópias; um administrador com acesso ao servidor e à chave consegue descriptografar.
Guardar a chave em local seguro é essencial para recuperar uma cópia.

QR e código de pareamento ficam só na memória, expiram e são retirados da tela ao
conectar, ocultar a aba ou perder a sessão. O serviço nunca imprime QR ou chaves.

Em caso de logout, número diferente, sessão substituída ou falhas repetidas,
o serviço para de tentar e mantém o volume para conferência. O bloqueio persiste
após reinício. Não há botão que apague sessão ou troque automaticamente o grupo.
Qualquer recuperação deve ser avaliada com o dono e precedida por backup.

## API interna

Sem porta publicada na VPS. Todas as rotas abaixo, salvo as de saúde, exigem
`X-Bridge-Token`; o navegador nunca recebe esse token.

| Rota | Função |
| --- | --- |
| GET `/status` | Estado sem QR nem código |
| GET `/pairing` | Estado e pareamento temporário, expostos ao dono pela API do painel |
| POST `/start` | Inicia com `confirmDedicated: true` |
| POST `/pair-code` | Usa somente o número dedicado definido no servidor |
| GET `/groups` | Lista somente grupos com o nome esperado |
| POST `/group` | Valida ID e membros; exige `confirmGroup: true` |
| POST `/test` | Envia uma mensagem fixa para o grupo já confirmado |
| GET `/livez` | Processo respondendo, mesmo se o chip ainda não estiver conectado |
| GET `/healthz` | HTTP 200 somente quando conectado e com grupo escolhido; informa `cycle: not_implemented` e `publicationEnabled: false` |

O endpoint público `/healthz` do bot antigo **não foi redirecionado** nesta etapa.
A tela do painel consulta o estado desta nova conexão por
`/painel-api/whatsapp/status`. A integração de saúde do pipeline virá no marco
correspondente; não confundir processo vivo com robô de notícias operando.

## Fontes técnicas consultadas

- https://baileys.wiki/authentication/qr-code
- https://baileys.wiki/authentication/pairing-code
- https://baileys.wiki/authentication/session-management
- https://baileys.wiki/migration/v7
- https://github.com/WhiskeySockets/Baileys/security/advisories/GHSA-qvv5-jq5g-4cgg
- https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
