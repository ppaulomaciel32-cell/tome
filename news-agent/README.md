# Redação Tome Nota News pelo WhatsApp

Implementação para Python 3.12, Meta WhatsApp Cloud API, Gemini, Tavily,
Cloudinary, Redis, Supabase e o site estático existente no Render.
O código está implementado; a operação real depende das configurações abaixo.
Consulte [a ativação atual](../docs/ATIVACAO_TOMEZAP_GEMINI.md). O
[relatório de 10/10](../docs/AGENTE_ENTREGA_2026_10_10.md) registra a versão anterior.
O domínio definido é **tomezap.com.br**; o bot usará
**bot.tomezap.com.br**. A troca está preparada no código, com ativação
dependente de DNS e HTTPS. Consulte o
[roteiro de ativação do domínio e Gemini](../docs/ATIVACAO_TOMEZAP_GEMINI.md).

## Escopo e decisões

- O agente fica na VPS, em quatro serviços: `bot-whatsapp`, `agente`, `redis` e
  `nginx`. O navegador recebe somente os arquivos estáticos e a chave anon.
- O site continua no Render, que já oferece CDN para sites estáticos. Não foi
  contratada VPS, assinatura, domínio ou serviço adicional.
- A IA de redação é **Gemini**, pela API oficial `generateContent` do Google.
  A implementação usa HTTP da biblioteca padrão, sem SDK adicional. Configure
  `GEMINI_API_KEY` somente no servidor e `GEMINI_MODEL=gemini-3.5-flash-lite`.
  O endpoint fica fixo em `generativelanguage.googleapis.com`; a chave vai no
  cabeçalho `x-goog-api-key`, sem aparecer na URL. Não há fallback para Drael
  nem troca automática de modelo/plano quando uma cota acaba.
- A resposta estruturada permite matéria ou recusa por fontes insuficientes.
  A validação local bloqueia números sem suporte, JSON inválido, conteúdo
  truncado, respostas bloqueadas pelo Google e chamadas inesperadas de ferramentas.
  A pesquisa continua no Tavily; nenhuma ferramenta de busca/execução do Gemini
  é habilitada. O Gemini recebe texto de pauta, fontes e eventual correção.
- O banco real usa `title`, `summary` e `body`. A API aceita `titulo`, `resumo`
  e `texto` e faz a correspondência sem renomear colunas.
- Apenas `public.tomenota_publications`, a nova `public.agent_log` e a função
  específica `public.tnn_ingest_agent` são usadas. O Radar não participa.
- A escrita administrativa permanece dentro da Edge Function. O produtor
  envia um **INGEST_SERVICE_TOKEN exclusivo**, em vez de receber a service_role
  inteira do projeto. Isso reduz o alcance de uma credencial da VPS.
- A rota nativa é `/functions/v1/tnn-ingest`, equivalente à ingestão pedida
  como `/api/ingest`; não foi sobrescrita outra função do projeto.
- Publicação automática é o padrão. **Uma fonte exige APROVAR antes da
  redação; nenhuma fonte interrompe a pauta.** Esta exceção evita transformar
  uma busca fraca em notícia automática. “Informações preliminares” só é
  permitido quando a própria fonte declara isso.
- A transcrição é local, com faster-whisper tiny em CPU. Áudio e fotos não
  são enviados ao Gemini por esta implementação. A VPS precisa de memória/CPU disponíveis;
  a imagem Docker inclui o modelo e fica maior por essa razão.
- São usadas conversas individuais da API oficial. Integração com grupos
  depende da elegibilidade da conta e não está implementada nesta versão.

## Fluxo e comandos

Envie uma foto com legenda, ou uma foto seguida da manchete em até cinco
minutos. Sem foto, use `MANCHETE: assunto`. Áudio de até dois minutos pode
substituir o texto; uma foto enviada antes é associada à pauta.

O bot confirma o recebimento, busca até cinco fontes permitidas, escreve,
valida os campos, envia a capa ao Cloudinary e gera o story. Depois responde:

1. PNG do story.
2. Título, localidade, número de fontes, resumo e preview temporário.
3. `No ar: ...` somente depois de encontrar a revisão correta na página pública.

`STATUS` consulta a última pauta do remetente e retoma a conferência de um
deploy pendente. `LISTAR` mostra as cinco últimas publicações da IA.
`APROVAR` libera a pauta aguardando revisão. `CORRIGIR: orientação` refaz
a redação com as mesmas fontes e mantém o slug já publicado.

`AGENTE_REQUER_APROVACAO=true` exige APROVAR para todas as matérias.
No modo automático, há cinco segundos de intervalo após o preview; correções
recebidas nesse intervalo são aplicadas antes da ingestão. Depois da gravação,
a correção é uma nova revisão da mesma matéria.

## 1. Supabase

Neste projeto, as duas migrations já foram aplicadas e a Edge Function já
foi publicada. **Não execute novamente estas migrations no mesmo projeto.**
Em uma instalação nova compatível, aplicar nesta ordem:

1. [20261009221026_whatsapp_news_agent.sql](../supabase/migrations/20261009221026_whatsapp_news_agent.sql)
2. [20261009222557_align_agent_city.sql](../supabase/migrations/20261009222557_align_agent_city.sql)

A política de publicações existente não é alterada. `agent_log` tem RLS,
sem SELECT público. Somente service_role executa a função SQL de ingestão.
Gravação da matéria e auditoria editorial acontecem na mesma transação.
A RPC preserva o slug de uma correção, compara revisões, evita duplicatas
por hash por 72 horas e acrescenta `-2`, `-3` etc. em colisões de novas pautas.

No Dashboard Supabase, em **Edge Functions → Secrets**, configurar:

| Secret | Valor |
|---|---|
| `INGEST_SERVICE_TOKEN` | Segredo aleatório exclusivo, pelo menos 32 caracteres; igual ao da VPS |
| `TNN_SITE_URL` | `https://tomezap.com.br` |
| `TNN_SITE_REBUILD_HOOK` | Deploy Hook privado do serviço público no Render |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são fornecidos pelo runtime.
Não colocar a service_role no arquivo público de configuração nem na VPS.

Os arquivos completos estão em `supabase/functions/tnn-ingest/`.
O JWT do gateway fica desativado **porque o handler valida seu próprio
x-service-token**, em tempo constante. Não remova essa validação.

URL configurada no bot:

```text
https://dfbeerxqqfqkwlljrjko.supabase.co/functions/v1/tnn-ingest
```

Sem secrets, o endpoint retorna 503 e não grava. Token incorreto retorna
401; JSON não objeto, 400; matéria inválida, 422. Publicação gravada com
rebuild ainda não solicitado retorna 202 e `deploy_requested=false`.
O endpoint não promete que o site já está no ar ao retornar 200.

## 2. Site público no Render

No serviço **tome-nota-publico** (`srv-dau355gu01pc73b2mvjg`), manter o repo
e a branch `public-site-github-supabase`. Na configuração do serviço:

| Campo | Valor |
|---|---|
| Root Directory | vazio, raiz do repositório |
| Build Command | `node scripts/build-public-site.mjs` |
| Publish Directory | `dist-public` |
| `NODE_VERSION` | `22` |
| `SKIP_INSTALL_DEPS` | `true` |
| `SITE_URL` | `https://tomezap.com.br` |

O conector disponível não permite editar Build Command/Publish Directory.
Esses dois valores ainda precisam ser salvos no painel. Não crie outro serviço
nem aplique o `render.yaml` da raiz, que pertence a outro sistema.

Antes de ativar estes valores, associe o domínio ao serviço, configure o DNS,
confirme HTTPS e incorpore a branch `feat/tomezap-gemini` à branch de
publicação. Não troque os links do site atual enquanto o novo endereço não
resolver. A configuração desejada está em
[`docs/render-public-site.yaml`](../docs/render-public-site.yaml).

Depois de salvar, confira o deploy automático; se ele não iniciar, use
**Manual Deploy → Deploy latest commit** no painel. Copie o
Deploy Hook deste serviço diretamente para o secret da Edge Function.
O hook é uma credencial: não colocar no código, mensagens ou logs.

O build usa somente leitura anon com colunas explícitas. Gera seis páginas
`/localidade/<slug>/`, artigos `/noticia/<slug>/`, sitemap, metadados, NewsArticle
e BreadcrumbList. Só entram matérias publicadas com data não futura. As
sete páginas HTML anteriores continuam disponíveis. Anúncios continuam
dependendo do consentimento, e os slots `0000000000` continuam ocultos.

Localidades: São Gonçalo do Amarante, Pecém, Taíba, Croatá, Paracuru e Região.
Não foi criada tabela extra de localidades nem alterado o sistema privado.

O arquivo `_headers` é preservado, mas não substitui a configuração de
cabeçalhos HTTP do Render. O trabalho atual não certifica esses cabeçalhos
como ativos no serviço; use as regras já documentadas para o site público.

## 3. Meta WhatsApp Cloud API

Os nomes das telas podem variar conforme o tipo e a situação da conta.

1. Em [Meta for Developers](https://developers.facebook.com/apps/), crie ou
   selecione o app empresarial e habilite o caso de uso/produto WhatsApp.
   Vincule o portfólio empresarial e a WhatsApp Business Account (WABA).
2. Em API Setup, use primeiro o número de teste e cadastre seu número como
   destinatário autorizado. Para produção, registre o número dedicado,
   valide sua posse e conclua os requisitos exibidos para essa conta.
3. Anote o **Phone Number ID**, diferente do telefone com DDD. Configure-o
   em `META_PHONE_ID`; use a versão Graph mostrada no painel em
   `META_GRAPH_VERSION` (formato `vNN.0`).
4. O token temporário do painel serve para o primeiro teste. Para operação,
   configure um usuário de sistema no Business Settings, atribua o app e
   a WABA e gere um token com os acessos necessários a
   `whatsapp_business_messaging` e `whatsapp_business_management`.
   Disponibilidade e expiração dependem da conta. Salve-o só em `META_TOKEN`.
5. Copie o **App Secret** para `META_APP_SECRET`. Ele valida o HMAC
   `X-Hub-Signature-256` de cada POST; não é o Verify Token do webhook.
6. Com a VPS e o HTTPS funcionando, configure Callback URL
   `https://bot.tomezap.com.br/webhook` e um Verify Token aleatório igual a
   `WEBHOOK_VERIFY_TOKEN`. A verificação GET devolve o challenge.
7. Assine o campo **messages** do objeto `whatsapp_business_account`.
   Eventos de status de entrega vêm em `value.statuses`, sem disparar jobs.
   Confirme a assinatura do app na WABA e faça o teste de recebimento.
8. Configure `WHITELIST_NUMBERS` com seus telefones no formato internacional,
   somente dígitos, separados por vírgula. Um número fora da lista recebe
   “Número não autorizado” e não cria pauta.

O bot responde dentro da janela de atendimento de 24 horas após uma mensagem
recebida. Fora dela, interrompe o envio e pede nova interação via STATUS.
Não dispara templates pagos ou mensagens promocionais por conta própria.
Cobrança, elegibilidade e limites devem ser conferidos na conta Meta.

Referências oficiais: [início](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started),
[webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview),
[coleção da Meta](https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api).

## 4. Credenciais e VPS

Pré-requisitos: Linux, Docker Engine com Compose v2, acesso ao host, DNS
apontando para a VPS e certificado HTTPS válido. O usuário confirmou que o
servidor existente é seu. O relatório fornecido descreve Ubuntu com nginx
nas portas 80/443; acesso SSH e recursos livres ainda não foram verificados.
Para esse cenário, use a opção com nginx existente abaixo. O compose padrão
serve para um host com 80/443 livres. Não desative serviços para liberar portas.

Na pasta `news-agent` do checkout:

```sh
umask 077
cp .env.example .env
mkdir -p certs backups
chmod 700 certs backups
sudo chown 10001:10001 backups
```

Edite `.env` no servidor. Não cole credenciais no chat e não versione `.env`.
Preencha Meta, Gemini, Tavily, Cloudinary e os endereços. Use um preset
**signed** do Cloudinary e `CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@dalwymbky`.
O upload usa assinatura, foto com EXIF removido e public_id por job.

Gere segredos aleatórios no próprio host. Exemplo de comando local:

```sh
openssl rand -hex 32
```

Use valores diferentes para INGEST_SERVICE_TOKEN, WEBHOOK_VERIFY_TOKEN e
REDIS_PASSWORD. Configure `REDIS_URL=redis://:SENHA_HEXADECIMAL@redis:6379/0`.
Essa variável fica apenas nos contêineres privados. Nenhuma porta do Redis
é exposta à internet.

### VPS com as portas 80/443 livres

Instale o certificado do hostname do bot em `certs/fullchain.pem` e
`certs/privkey.pem`, com renovação automatizada no host. O nginx fornecido
termina TLS; emissão e renovação dependem do DNS/SO ainda não informados.
Após renovar os arquivos: `docker compose exec nginx nginx -s reload`.

```sh
docker compose config --quiet
docker compose build
docker compose run --rm bot-whatsapp python -m tnn.preflight
docker compose up -d
docker compose ps
curl --fail https://bot.tomezap.com.br/healthz
```

### VPS com nginx existente — opção para o servidor informado

Use os dois arquivos Compose juntos. A sobreposição expõe o bot somente em
`127.0.0.1:18080` e deixa o nginx do contêiner fora da inicialização padrão.
Redis permanece sem porta pública. Não ative o perfil `standalone-proxy`.
Confirme que a porta local 18080 está livre antes de iniciar.

```sh
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml build
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml run --rm bot-whatsapp python -m tnn.preflight
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml up -d
docker compose -f docker-compose.yml -f docker-compose.existing-proxy.yml ps
curl --fail http://127.0.0.1:18080/healthz
```

O arquivo [`nginx-host.example.conf`](nginx-host.example.conf) contém somente
os blocos do novo hostname. Adicione-o separadamente à configuração do nginx
do host, sem substituir outros sites. Emita primeiro o certificado de
`bot.tomezap.com.br` pelo procedimento já usado no servidor e ajuste os
caminhos no exemplo. Se mudar `BOT_BIND_PORT`, ajuste também o upstream.
Execute `nginx -t` antes de recarregar o nginx existente. Não aplique esse
arquivo antes de o certificado existir. Depois confira
`https://bot.tomezap.com.br/healthz` e configure o webhook na Meta.
Essa instalação ainda precisa ser testada no servidor real.

O preflight verifica presença/formato, não validade de saldo ou tokens.
A fila tem persistência AOF/RDB. Um lock do Redis mantém um worker ativo;
jobs interrompidos voltam da lista processing no reinício. Cada etapa tem
timeout nos adaptadores e até duas novas tentativas para falhas transitórias.
Timeout incerto do Gemini não é repetido, pois pode já consumir cota; envio
incerto da Meta também não é repetido cegamente.

## 5. Fontes, arte e operação

`TRUSTED_SOURCE_DOMAINS` controla a lista permitida na busca Tavily. O exemplo
inclui domínios governamentais; acrescente veículos locais após verificá-los.
Resultados do mesmo host ou textos idênticos não contam como duas fontes.
Cada fonte guarda título, URL, conteúdo e data quando fornecida pela busca.
Datas ausentes não são inventadas. O prompt completo está em
[tnn/editorial.txt](tnn/editorial.txt).

As verificações de JSON, números e atribuição reduzem falhas, mas não comprovam
todo nome, cargo ou fato. Para revisão editorial humana, habilite a flag de
aprovação. A IA não recebeu treinamento/fine-tuning: usa instruções editoriais
e contexto das fontes a cada pauta.

O story é um template desenhado com Pillow, sem geração paga de imagem.
Dimensão 1080×1920, PNG menor que 1,5 MB, DejaVu Sans Bold de 72 px, máximo
quatro linhas. Manchetes maiores recebem reticências na arte; o artigo mantém
o título completo. A capa sem foto é marcada “IMAGEM PADRÃO”.

O preview usa token aleatório de 256 bits, expira em 24h, é noindex/no-store
e escapa o texto. Quem recebe o link pode vê-lo até expirar; não é um login.
Jobs e estados pessoais expiram do Redis em sete dias; hashes em 72h.
Arquivos de jobs e backups no volume da VPS precisam de retenção operacional.

## 6. Backup e observabilidade

Cada etapa envia job_id, status, duração e erro resumido para `agent_log`.
Falhas temporárias da auditoria ficam em fila local. O payload editorial
validado é auditado na mesma transação da publicação, com e-mails e segredos
removidos; não se registra o corpo bruto do webhook no log público.
Três falhas consecutivas em uma etapa geram alerta ao remetente autorizado.

Teste manual do backup antes de agendar:

```sh
sh backup.sh
```

Depois configure no cron do host, adaptando o caminho real. Exemplo em UTC
(03:15 UTC corresponde a 00:15 em Fortaleza):

```cron
15 3 * * * cd /opt/tome/news-agent && sh backup.sh >> backups/backup-cron.log 2>&1
```

O script força snapshot do Redis e exporta somente `agent_log` via endpoint
privado. Não foi criado cron nesta sessão porque não há acesso à VPS.
Guarde cópia fora do host conforme a infraestrutura já disponível; o volume
local sozinho não protege contra perda da VPS. Defina retenção antes de
acumular backups. Não restaure dados sobre produção sem conferir o destino.

## 7. Testes reproduzíveis e aceitação

Da raiz do repositório (Node 22+):

```sh
node --test tests/ingest.test.mjs tests/ssg.test.mjs tests/public-site.test.cjs
node scripts/build-public-site.mjs
```

Na pasta `news-agent`, para testes de lógica sem baixar o modelo de áudio:

```sh
python3.12 -m venv .venv
.venv/bin/pip install Pillow==12.3.0 redis==8.1.0 -r requirements-test.txt
.venv/bin/python -m unittest discover -s tests -v
```

`tests/agent-schema.sql` é um teste transacional com ROLLBACK, executado no
Supabase autorizado. Ele não deixa notícias de teste publicadas.

Antes de declarar a operação pronta, realizar na VPS os oito testes reais
do pedido: foto+manchete e URL em menos de 90s; duplicação em 5min; falta de
foto; número fora da lista; uma fonte; falha transitória/persistente;
CORRIGIR com mesmo slug; leitura do PNG no celular. Adicionar áudio real,
reinício de Redis/worker e restauração do backup. Anotar a saída e os horários.
O tempo de busca, geração e rebuild depende de serviços externos; não há
promessa de 90s enquanto esse teste não for medido.

## Custos e limites

Não foi contratado serviço nem executada chamada real de geração nesta troca.
A tabela oficial consultada em 11/10/2026 oferece free tier para texto no
`gemini-3.5-flash-lite`. A disponibilidade efetiva depende da conta e das
cotas. Configure uma chave de projeto no plano gratuito no Google AI Studio;
o código não consegue deduzir pela chave se o projeto tem faturamento ativo.
Não habilite cobrança para contornar limite. O código limita a saída a 4096
tokens e não aciona ferramentas extras do Gemini. Confira as condições de
uso de dados do plano escolhido antes de enviar informações confidenciais.

Tavily, Cloudinary, Supabase, Render e Meta têm limites/regras próprios.
Use as cotas existentes e não habilite recarga automática sem decisão sua.
A VPS e o domínio também precisam já estar disponíveis para não haver nova
contratação. O frontend não exige npm install; os pacotes Python ficam no bot.

Fontes técnicas: [Gemini generateContent](https://ai.google.dev/api/generate-content),
[modelo Gemini](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite),
[preços e cotas Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[Tavily](https://docs.tavily.com/documentation/api-reference/endpoint/search),
[Cloudinary](https://cloudinary.com/documentation/upload_images),
[Render Static Sites](https://render.com/docs/static-sites).
