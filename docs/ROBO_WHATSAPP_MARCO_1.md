# TomeZap — conexão privada com WhatsApp

Atualização: 11/10/2026, horário de Fortaleza.

**Situação: código salvo para revisão; ativação real pendente.** Esta entrega é o
marco (a), conexão QR + escolha segura do grupo. Segue a ordem de marcos combinada
com o dono. Nenhuma publicação real, mensagem real, alteração de DNS, migração no
Supabase ou reinício de produção foi realizado nesta etapa.

## O que mudou, em linguagem simples

O módulo WhatsApp do painel agora aponta para uma tela de conexão protegida.
Só a conta do dono pode abrir o pareamento. Ela mostra o QR ou um código para
usar no celular, o estado do chip e o grupo escolhido. O grupo é validado pelo
seu identificador real e pelos números autorizados, não apenas pelo nome.

O chip do robô deve ser diferente dos números do dono e da namorada. Os números
ficam vazios na configuração até serem confirmados. O número antigo mencionado
na conversa não foi reaproveitado automaticamente como chip dedicado.

A tela avisa que a conexão não é oficial e que pode haver bloqueio do número.
A sessão é salva e protegida na VPS para permitir reconexão sem novo QR quando
continua válida. A confirmação do grupo não envia mensagens sozinha: há um botão
separado para enviar o teste. No grupo, `STATUS` informa que a conexão existe,
mas a produção ainda está pendente. `APROVAR` não publica nada neste marco.

O serviço tem um limite persistente de 20 envios por hora. Ele recusa comandos
vindos de outra conversa, de outra pessoa, de mensagens antigas e de repetições.
O grupo precisa conter somente o robô e os editores configurados. Um participante
extra bloqueia o envio para evitar que as prévias sejam entregues a outra pessoa.

## O que continua pendente

- Instalar a API interna do painel e o novo serviço na VPS e validar recursos disponíveis.
- Confirmar o login do dono no Supabase Auth sem alterar contas/políticas do Radar.
- Configurar os números do chip e dos editores; parear pelo celular e confirmar o grupo.
- Busca de 20 em 20 minutos, fontes RSS escolhidas pelo dono e orçamento de cota Tavily.
- Redação Gemini, aprovação de revisão específica e integração com ingestão existente.
- Stories, Reels, tabelas de rascunhos/logs/mídias e leitura delas pelo painel.
- Backup diário dos dados próprios do TomeZap no Supabase e cópia externa da sessão.
- Teste real completo: pauta → prévia no grupo → aprovação → matéria visível no site.

Nenhuma chave Gemini é necessária para este primeiro marco. A chave enviada na
conversa não foi usada, testada nem gravada no repositório. Na etapa de redação,
configurar uma chave nova diretamente na VPS; não reutilizar a Drael nem ativar
cobrança. Nenhuma chamada Gemini, Tavily, Meta ou Cloudinary foi feita neste marco.

## Como conhecer a tela em um minuto

1. Abra `docs/whatsapp-conexao-preview.html` no navegador, inclusive no celular.
2. Confira a área de QR, o aviso sobre chip dedicado e a confirmação do grupo.
3. Os botões estão desabilitados na prévia: ela não gera QR falso, não faz login e não envia dados.
4. A prévia geral em `docs/painel-preview.html` também foi atualizada na área WhatsApp.

## Base do GitHub e serviços preservados

Branch de trabalho: `feat/tomezap-robo-whatsapp`.
Base: `feat/painel-controle-tomezap`, commit
`b26b4d68ba22a228ad38cd993c990ef5972dfb4d`, que já inclui o trabalho da branch Gemini.
A branch de produção `public-site-github-supabase` foi preservada. Não foi feito
merge, troca de branch no Render ou deploy de uma tela sem seu servidor.

O site mantém `https://tomezap.com.br`, o robô mantém `https://bot.tomezap.com.br`
e o AdSense mantém `ca-pub-2000164835494228`. Os serviços `api.`, `chat.`, `whats.`
e o Radar não foram modificados. Não foi acessada nenhuma tabela do Radar.

As correções de aspas do `tmpfs` já estão herdadas da branch do painel.
Os cabeçalhos de segurança preparados no repositório ainda precisam de conferência
no painel do Render antes de afirmar que estão ativos em produção.

## Instalação na VPS — para executar com acesso e revisão do dono

Estes comandos são instruções, **não foram executados na VPS**.
Antes de mudar nginx, reiniciar contêineres existentes ou publicar sobre produção,
mostrar o diff e pedir a confirmação conforme solicitado pelo dono.
Não usar `docker compose down -v`, não apagar a sessão e não substituir o nginx global.

### 1. Conferência somente leitura

Verificar espaço livre, memória, versão Docker, contêineres e listeners existentes.
A nova API usa `127.0.0.1:18081`; o WhatsApp usa a porta 3090 apenas na rede Docker.
Conferir se o projeto `tomezap-painel` já existe e se a porta 18081 está livre.
Conferir o server HTTPS de `bot.tomezap.com.br` sem imprimir arquivos com secrets.
Não instalar por cima de `whats.tomezap.com.br` ou de outra sessão de WhatsApp.

O arquivo do novo serviço limita memória a 384 MB e o painel a 128 MB. São limites
configurados, não uma medição da VPS. É preciso confirmar espaço também para os
serviços já existentes; o agente de redação será dimensionado depois.

### 2. Obter o código

Usar uma pasta nova, sem sobrescrever a instalação que estiver atendendo produção.
Exemplo de caminho escolhido pelo operador: `/opt/tomezap-robo-m1`.

```bash
git clone --branch feat/tomezap-robo-whatsapp --single-branch https://github.com/ppaulomaciel32-cell/tome.git /opt/tomezap-robo-m1
```

Se o repositório for privado, usar a credencial GitHub já configurada no servidor;
não colocar token na URL nem no histórico. Inspecionar o commit e comparar com a
versão que estiver em produção antes de qualquer incorporação.

### 3. Configurar arquivos privados

Criar `panel-api/.env` e `whatsapp-bridge/.env` a partir dos exemplos **somente se
não existirem**. Permissão 0600. Não enviar o conteúdo ao chat ou ao GitHub.

No painel, preencher o Supabase público e o e-mail autorizado conforme o marco
anterior. Acrescentar:

```dotenv
AGENT_PUBLIC_URL=https://bot.tomezap.com.br
WA_BRIDGE_URL=http://whatsapp:3090
WA_BRIDGE_TOKEN=VALOR_ALEATORIO_PRIVADO
```

No novo componente:

```dotenv
WA_ENABLED=true
WA_DEDICATED_NUMBER=NUMERO_DO_CHIP_NOVO_COM_DDI_DDD
WA_ALLOWED_SENDERS=NUMERO_DO_DONO,NUMERO_DA_NAMORADA
WA_BRIDGE_TOKEN=MESMO_VALOR_PRIVADO_DO_PAINEL
WA_SESSION_KEY=OUTRO_VALOR_ALEATORIO_PRIVADO
WA_SESSION_DIR=/data/session
AGENTE_REQUER_APROVACAO=true
```

Cada segredo aleatório deve ter 64 caracteres hexadecimais, gerados com
`openssl rand -hex 32`. São dois valores diferentes. Guardar uma cópia segura da
chave de sessão separada das cópias do banco. Sem ela o backup não pode ser aberto.
Não configurar `SUPABASE_SERVICE_ROLE`, token Meta ou chave Gemini neste serviço.

### 4. Preparar o volume e validar

Conferir primeiro `/opt/tome-news/sessao-wa`. Se já houver dados, identificar o
proprietário e o conteúdo sem imprimir credenciais. Não apagar nem reaproveitar
uma sessão de outro serviço. Se o diretório ainda não existir:

```bash
sudo install -d -m 700 -o 1000 -g 1000 /opt/tome-news/sessao-wa
```

No diretório `panel-api`, validar sem imprimir valores de ambiente:

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml build painel-api whatsapp
```

`npm ci` acontece durante o build da imagem. O site estático continua sem precisar
de NPM. Não executar o compose antigo de `news-agent` para este marco; ele mantém
o transporte Meta anterior e não está integrado ao novo fluxo de aprovação.

### 5. Ativar os dois componentes

**Confirmar antes caso isto reinicie um painel já existente.** Depois de conferir
os nomes dos serviços e o diff:

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml up -d --no-deps painel-api whatsapp
```

Isso deve atingir apenas o projeto `tomezap-painel`. Nunca rodar um comando global
para parar ou recriar os outros contêineres. Não escalar a instância `whatsapp`.

Adicionar apenas os blocos de `panel-api/nginx-location.example.conf` ao server
HTTPS já existente de `bot.tomezap.com.br`. As rotas novas são `/painel-api/`,
`/conectar` e `/conectar/`. Validar com `nginx -t`; somente após aprovação fazer
um reload do nginx. Não alterar DNS, certificados ou rotas de outros subdomínios.
O `/healthz` público antigo permanece intacto neste marco.

Quando a API privada estiver validada, preparar o diff de incorporação da branch
no site de produção. Não usar force-push. O Render continua com
`node scripts/build-public-site.mjs` e `dist-public`. Confirmar a publicação do
`/admin/` e os cabeçalhos no Render. O login deve exigir a conta do dono, sem abrir
cadastro público. A senha é da conta Supabase do projeto, não a senha do Gmail.

### 6. Teste real do marco

1. Sem login, abrir `/conectar`: deve levar ao login, sem QR nem dados do grupo.
2. Entrar como dono no `/admin/` e abrir WhatsApp → Abrir pareamento.
3. Confirmar chip dedicado, gerar QR e escanear com esse chip. O QR deve desaparecer.
4. Adicionar o chip ao grupo de vocês no celular; buscar e confirmar o grupo correto.
5. Clicar no teste: deve chegar uma mensagem no grupo.
6. Digitar `STATUS` como dono e como editora: ambos devem receber a resposta de estado.
7. Um outro grupo ou remetente não autorizado não deve acionar o robô.
8. Somente com aprovação de reinício, reiniciar **apenas este serviço** e confirmar reconexão sem novo QR e persistência do limite de mensagens.

A configuração completa leva mais que um minuto; a conferência da tela depois de
instalada pode ser feita em um minuto. O teste real acima não foi realizado nesta entrega.

### 7. Backup diário da sessão

O comando abaixo cria uma cópia consistente e criptografada em
`/opt/tome-news/sessao-wa/backups`, enquanto o processo continua aberto:

```bash
docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec -T whatsapp node backup-session.mjs
```

Depois de validar o comando e o espaço livre, adicionar uma entrada ao agendador
existente **sem substituir as entradas atuais**. Exemplo às 03:17 no horário do
servidor (verificar o fuso antes):

```cron
17 3 * * * cd /opt/tomezap-robo-m1/panel-api && docker compose -f docker-compose.yml -f docker-compose.whatsapp.yml exec -T whatsapp node backup-session.mjs
```

O agendamento **ainda não foi instalado**. As cópias não são apagadas automaticamente.
Definir retenção e destino externo com o dono: uma cópia na mesma VPS não protege
contra perda do servidor. Este backup contém só a sessão do novo robô; não copia
o Radar nem todo o banco Supabase. O backup das tabelas próprias do TomeZap será
implementado junto delas no marco de integração.

## Evidências e limites dos testes

Saída dos testes: `docs/ROBO_WHATSAPP_M1_TESTES_2026_10_11.txt`.
Foram exercitados SQLite e criptografia reais, backup consistente, servidor HTTP
Node real, validação de acesso, PNG QR local e navegação em Chromium. Conexões
WhatsApp, identidade Supabase e grupos foram simulados nos testes.

Baileys e dependências foram instalados com lockfile, sem executar scripts de
instalação. O adaptador importou corretamente e o processo real iniciou com
`WA_ENABLED=false`, respondeu `/livez` HTTP 200, informou configuração pendente
sem publicação e encerrou sem imprimir chaves. `npm audit --omit=dev` informou
zero vulnerabilidades conhecidas em 11/10/2026; isso não elimina riscos do protocolo.

O Docker e o nginx não estão disponíveis neste ambiente: o YAML foi validado,
mas as imagens e o proxy ainda precisam de teste na VPS. Nenhuma chave foi usada
para fazer chamadas de geração de texto, busca paga ou envio de mensagens.

Conferência pública nesta sessão: site HTTP 200; `/admin/` HTTP 404;
`bot.tomezap.com.br/healthz` HTTP 502; `/conectar` HTTP 404. Esses resultados indicam
que a nova operação ainda não está disponível, mas não diagnosticam sozinhos a
causa do erro do bot. Para resolvê-la são necessários acesso à VPS e logs restritos
aos serviços autorizados, sem copiar secrets.
