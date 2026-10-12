# TomeZap — busca e rascunhos privados

Atualização: 12/10/2026, horário de Fortaleza.

**Código e testes locais concluídos. Ativação na VPS e teste real pendentes.**
Esta é a continuação do marco de QR e grupo já aprovado. Entrega o marco (b):
pesquisa, redação Gemini, armazenamento privado e prévia por texto no grupo.
Não libera publicação, aprovação, capa, Stories ou Reels. Esses recursos seguem
nos próximos marcos combinados com o dono.

## O que você pode conferir agora

Abra `docs/painel-preview.html`, escolha **Rascunhos** e toque no cartão.
Você verá a leitura completa e o espaço das fontes, também no celular. A tela
usa um exemplo identificado como demonstração, não uma notícia real.
Ela não faz login, não consulta dados privados e não envia mensagens.

O fluxo preparado é:

1. A cada 20 minutos, ler RSS das fontes que o dono aprovar.
2. Escolher no máximo uma pauta local ainda não coberta.
3. Procurar confirmação independente; usar Tavily apenas como complemento opcional.
4. Com menos de duas fontes, avisar “fonte fraca” e parar antes de escrever.
5. Pedir ao Gemini um rascunho de 300–500 palavras, com atribuição das fontes.
6. Validar tamanho, números e evidências textuais; guardar o rascunho completo.
7. Enviar título, resumo, localidade, fontes, ID e link privado ao grupo confirmado.
8. Ler o texto no painel com login. **Nenhuma matéria vai ao site neste marco.**

O link preparado é `https://tomezap.com.br/admin/#rascunho/ID`.
Ele só funciona com o painel/API instalados e uma conta autorizada. Compartilhar
esse link não concede acesso a outra pessoa. `APROVAR`, `EDITAR`, `REJEITAR`,
`PAUSAR` e `RETOMAR` ainda respondem que dependem do próximo módulo.

## Regras da redação

- Fila padrão: cinco rascunhos. Ao atingir esse total, não gera novos textos.
  A liberação da fila por aprovação/rejeição entra no próximo marco.
- RSS com data ausente, futura além da tolerância ou antiga há mais de 72 horas
  não entra na apuração. Pode deixar notícias de fora, de propósito.
- Fontes do mesmo grupo editorial não contam duas vezes. Cópias muito semelhantes
  também não contam como confirmação independente.
- URLs e títulos normalizados são registrados de forma persistente em
  `noticias_vistas`. Similaridade de títulos ajuda na triagem, mas não garante
  detectar todo assunto repetido ou reproduções parafraseadas.
- O prompt trata conteúdo das páginas como dados, não como ordens para o robô.
  Não há execução de ferramentas pelo modelo. Campos de autoria são fixos.
- Datas e números sem suporte são recusados. Trechos de evidência ficam privados
  para conferência; correspondência textual **não prova veracidade**. A revisão
  humana continua indispensável, especialmente em saúde, crimes e acusações.
- O processo tenta novamente falhas transitórias, até duas repetições com espera
  crescente. Não repete geração ou envio que possa ter ocorrido sem confirmação.
- Se falhar antes de salvar, nada é gravado parcialmente. Se falhar o WhatsApp
  depois da gravação, o texto completo continua no painel; não é reenviado às cegas.
- Três falhas consecutivas na mesma etapa geram um alerta fixo, sem chaves ou
  conteúdo de erro bruto. O comando `STATUS` informa estado, fila e atualização.
- Todos os envios compartilham o teto persistente de 20 mensagens por hora.

## Cota gratuita e fontes

O código não habilita cobrança. Por padrão, `AUTONOMOUS_ENABLED`,
`GEMINI_FREE_TIER_CONFIRMED` e `TAVILY_FREE_TIER_CONFIRMED` ficam desativados.
O operador deve conferir o plano do projeto antes de habilitar qualquer provedor.
As chaves antigas coladas no chat não foram usadas nem copiadas.

Usar `gemini-3.5-flash-lite` para texto, com limite local padrão de 20 chamadas/dia.
Tavily é opcional, busca básica, até 20 chamadas/dia e 600/mês por este processo.
RSS evita uma consulta Tavily em cada ciclo: 72 buscas por dia ultrapassariam
a cota mensal gratuita descrita pelo provedor na conferência de 11/10/2026.
Reservas de cota ocorrem antes da chamada, inclusive nas repetições.

Esses contadores não enxergam uso da mesma conta por outro aplicativo. Não são
garantia de custo zero se o operador conectar um projeto com cobrança habilitada.
Preferir uma credencial dedicada em projeto gratuito, manter o Redis e seus backups
e conferir a cota vigente nos painéis. Não apagar o volume para “zerar” limites.

`news-agent/autonomous-sources.example.json` traz dois candidatos de RSS: Governo
do Ceará e Agência Brasil. Ambos começam com `approved: false`; não foram
escolhidos no lugar do dono. Para cada fonte escolhida, registrar domínios exatos
e o grupo editorial real. Duas páginas da mesma prefeitura não são duas fontes
independentes. Redirecionamentos e endereços privados são bloqueados pelo coletor.

Referências oficiais consultadas:
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/pricing
- https://docs.tavily.com/documentation/api-credits
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Isolamento e dados

A migration nova cria somente `public.rascunhos`, `public.noticias_vistas` e
`public.ciclo_log`, índices e duas funções próprias. As tabelas têm RLS ativado
e nenhuma leitura/escrita concedida a `anon` ou `authenticated`.
O painel lê por uma API de sessão, depois de confirmar dono/editor no Supabase Auth.

`tnn-drafts` é uma Edge Function separada da ingestão. Aceita um token exclusivo
de escrita de rascunhos e outro token exclusivo de leitura do painel. A chave
`service_role` fica somente dentro da Edge Function. Não vai para a VPS, navegador,
grupo ou log. O produtor deste marco não recebe o token de `tnn-ingest`.

Uma transação grava rascunho e deduplicação juntos. A janela de 20 minutos é
reservada também no Postgres, além do lock Redis, para resistir a reinícios e
processos duplicados. A função não contém ação de publicação ou rebuild.
`ciclo_log` registra etapa, resultado, código fixo e duração, sem payload bruto.

O novo trabalhador Python usa um Redis separado, autenticado e sem porta pública.
O overlay não sobe o publicador Python antigo nem reutiliza Redis/sessões do Radar.
O token do trabalhador só permite ao bridge consultar o estado, enviar prévia/aviso
e informar o ciclo. Ele não abre QR, inicia pareamento ou escolhe grupo.

AdSense, domínio, tabela de publicações e suas políticas existentes foram preservados.
Não foram acessadas tabelas do Radar. Nenhum serviço `api.`, `chat.` ou `whats.`
foi alterado. A branch de produção e o `render.yaml` do Radar não foram modificados.

## Instalação preparada — não executada em produção

Siga primeiro `docs/ROBO_WHATSAPP_MARCO_1.md` para painel, login, chip dedicado e
grupo. Antes de reiniciar serviço existente, mudar nginx/DNS ou incorporar em
produção, mostrar exatamente o diff e obter a confirmação solicitada pelo dono.
Não executar `docker compose down -v`, não apagar sessões e não aplicar todas
as migrations do repositório indiscriminadamente.

1. Obter a branch `feat/tomezap-robo-whatsapp` em checkout isolado. Comparar
   com a versão em execução e preservar alterações posteriores.
2. Conferir no projeto Supabase `dfbeerxqqfqkwlljrjko` que os três nomes novos não
   colidem com outra aplicação. Aplicar **apenas** a migration
   `supabase/migrations/20261011224051_autonomous_private_drafts.sql`, depois da
   revisão do diff. Conferir grants, RLS e ausência de leitura anônima.
3. Gerar dois segredos diferentes com `openssl rand -hex 32`, diretamente no
   ambiente seguro. Configurar `TNN_DRAFT_SERVICE_TOKEN` e `TNN_DRAFT_READER_TOKEN`
   nos secrets da Edge, sem imprimir os valores. Os secrets Supabase internos
   já são fornecidos pelo runtime da função.
4. Publicar somente a função nova, com autenticação própria obrigatória:

   ```bash
   supabase functions deploy tnn-drafts --no-verify-jwt --project-ref dfbeerxqqfqkwlljrjko
   ```

   O flag desativa a verificação JWT da plataforma, **não** a autenticação
   implementada na função. Sem seus tokens ela responde 401; sem configuração, 503.
5. Criar `news-agent/.env.autonomous` a partir do exemplo, só se ainda não existir,
   com permissão 0600. Preencher nova chave Gemini, tokens privados e segredo Redis.
   Confirmar cota gratuita. Tavily pode permanecer desativado.
6. Criar `news-agent/autonomous-sources.json` a partir do exemplo; manter só fontes
   revisadas pelo dono e marcar as escolhidas. São necessárias duas organizações
   independentes na configuração. Conferir os feeds a partir da própria VPS.
7. Criar outro segredo, `WA_PIPELINE_TOKEN`, igual apenas no trabalhador e em
   `whatsapp-bridge/.env`; deve ser diferente de `WA_BRIDGE_TOKEN`.
8. Em `panel-api/.env`, preencher `TNN_DRAFTS_URL` e o token **de leitura**
   `TNN_DRAFT_READER_TOKEN`. Não copiar as chaves Gemini/Tavily para o painel.
9. Validar recursos da VPS e os arquivos. Os limites novos são 256 MB para redação
   e 128 MB para Redis; são limites configurados, não medições de capacidade.
   Dentro de `panel-api`, usar os três arquivos, sem imprimir secrets:

   ```bash
   docker compose --env-file ../news-agent/.env.autonomous -f docker-compose.yml -f docker-compose.whatsapp.yml -f docker-compose.redacao.yml config --quiet
   docker compose --env-file ../news-agent/.env.autonomous -f docker-compose.yml -f docker-compose.whatsapp.yml -f docker-compose.redacao.yml build painel-api whatsapp redacao
   ```

10. Após confirmar eventual reinício de painel/bridge existentes, iniciar **somente**
    os componentes novos do projeto `tomezap-painel`. Ativar o ciclo no arquivo
    privado só depois dos itens anteriores e do grupo confirmado:

   ```bash
   docker compose --env-file ../news-agent/.env.autonomous -f docker-compose.yml -f docker-compose.whatsapp.yml -f docker-compose.redacao.yml up -d painel-api whatsapp redacao-redis redacao
   ```

Não escalar o bridge ou o trabalhador. A imagem Python usa apenas duas dependências
leves neste marco: Redis e defusedxml. O site continua sem instalação NPM obrigatória.

O `/healthz` do bridge é interno, na porta 3090. Mostra WhatsApp/grupo/ciclo reais
e sempre `publicationEnabled: false`. O `/healthz` público antigo não foi trocado:
é necessário revisar o nginx na VPS para compor ou encaminhar a saúde correta,
preservando os endpoints antigos. Não chamar o endereço público de “integrado”
antes dessa verificação. O healthcheck do trabalhador confirma só o processo,
não a disponibilidade dos provedores.

Publicar `/admin/` no Render somente após conferir o servidor do painel. A incorporação
da branch e os cabeçalhos preparados continuam pendentes de revisão de produção.
Build continua `node scripts/build-public-site.mjs`, pasta `dist-public`.

## Backup e reversão

O Redis usa AOF persistente e snapshot local, sem apagar dados por limite de memória.
Isso não substitui backup diário externo. O agendamento da sessão do marco anterior,
exportação das três tabelas novas e cópia externa do Redis ainda precisam ser
implantados no marco de integração, com retenção e destino definidos pelo dono.
Nenhum agendamento foi criado e não foi feito backup de tabelas do Radar.

Se o ciclo precisar ser interrompido, parar somente o serviço `redacao` após a
confirmação do dono. Preservar volumes, drafts, sessão e secrets. O painel pode
continuar lendo rascunhos. Não usar migração reversa destrutiva como desligamento.

## Testes feitos e limites

Saídas em `docs/ROBO_WHATSAPP_M2_TESTES_2026_10_12.txt`.

- 80 testes Node: regressões do site/painel/bridge, tokens separados, leitura
  autenticada e Postgres local com SQL real para RLS e atomicidade.
- 50 testes Python: redação validada, quotas Redis/Lua, fontes fracas, deduplicação,
  retries, falha de envio, orçamento de geração e ausência de publicação no ciclo novo.
- 12 cenários de navegador entre painel, pareamento e rascunhos; leitura em 320/390 px,
  login antes de buscar dados, HTML malicioso escapado e links de script bloqueados.
- Build público: 0 notícias e 6 localidades; painel incluído, drafts fora do sitemap,
  AdSense preservado, nenhum segredo de servidor no pacote público.
- YAML validado; não houve execução de Docker/nginx neste ambiente.

PGlite exercitou Postgres local. Gemini, autenticação remota, transporte WhatsApp
e respostas de coleta foram simulados nos testes funcionais. A consulta real ao
RSS não pôde ser validada neste ambiente (DNS direto indisponível; proxy recusou
a consulta). O coletor mantém os bloqueios de rede privada; não foram relaxados
para contornar essa limitação. Validar os feeds aprovados na VPS antes de ativar.

Nenhuma chamada autenticada Gemini/Tavily, mensagem real, migração remota, publicação
ou reinício de produção ocorreu. Não foi realizado o teste de pauta real → grupo →
aprovação → site; ele depende da VPS, configuração e marcos seguintes.

Rechecagem pública em 12/10/2026: site HTTP 200, `/admin/` HTTP 404,
`bot.tomezap.com.br/healthz` HTTP 502 e `/conectar` HTTP 404. Portanto o sistema
interno novo **ainda não está no ar**. O HTTP 502 sozinho não identifica a causa.

## Próximo passo

O dono confere a tela de rascunhos. O marco seguinte implementa comandos de
aprovação/rejeição/edição ligados a uma versão específica da matéria. Para instalar
na operação real, disponibilizar acesso seguro à VPS e confirmar o chip dedicado,
editores e fontes. Não colar senhas ou chaves no chat.

## Arquivos deste marco

- `docs/ROBO_WHATSAPP_M2_TESTES_2026_10_12.txt`
- `docs/ROBO_WHATSAPP_MARCO_2.md`
- `docs/painel-preview.html`
- `news-agent/.env.autonomous.example`
- `news-agent/.gitignore`
- `news-agent/Dockerfile.autonomous`
- `news-agent/autonomous-sources.example.json`
- `news-agent/requirements-autonomous.txt`
- `news-agent/tests/test_autonomous.py`
- `news-agent/tnn/autonomous/__init__.py`
- `news-agent/tnn/autonomous/clients.py`
- `news-agent/tnn/autonomous/collection.py`
- `news-agent/tnn/autonomous/config.py`
- `news-agent/tnn/autonomous/editorial.txt`
- `news-agent/tnn/autonomous/pipeline.py`
- `news-agent/tnn/autonomous/store.py`
- `news-agent/tnn/autonomous/worker.py`
- `news-agent/tnn/autonomous/writer.py`
- `news-agent/tnn/providers.py`
- `panel-api/.env.example`
- `panel-api/Dockerfile`
- `panel-api/docker-compose.redacao.yml`
- `panel-api/drafts.mjs`
- `panel-api/server.mjs`
- `public-site/admin/drafts.mjs`
- `public-site/admin/panel.css`
- `public-site/admin/shell.mjs`
- `scripts/build-panel-preview.mjs`
- `supabase/functions/tnn-drafts/handler.mjs`
- `supabase/functions/tnn-drafts/index.ts`
- `supabase/migrations/20261011224051_autonomous_private_drafts.sql`
- `tests/drafts-ui.test.mjs`
- `tests/drafts.test.mjs`
- `tests/whatsapp-bridge.test.mjs`
- `tests/whatsapp-panel.test.mjs`
- `whatsapp-bridge/.env.example`
- `whatsapp-bridge/controller.mjs`
- `whatsapp-bridge/server.mjs`
