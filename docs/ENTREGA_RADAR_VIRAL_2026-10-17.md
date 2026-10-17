# Radar Viral — implementação e instalação

Base: `b97371fe314468cea9243e0d30eee070ad7e5d80`, branch
`feat/tomezap-robo-whatsapp`. Este arquivo acompanha os commits da entrega.

## Para o dono

O Radar procura sugestões; ele não publica. Com o serviço ativado, envie
`RADAR caucaia` ou `RADAR` no grupo já confirmado. A resposta traz até três
sugestões com fonte, três títulos e uma estimativa de interesse editorial.
Essa nota não é audiência medida nem promessa de viralização.

Cada sugestão recebe um identificador como **R12**:

- `APROVAR R12`: encaminha a sugestão para a redação existente.
- `REJEITAR R12: motivo`: descarta a sugestão.
- `CORRIGIR R12: explique a mudança`: refaz somente o ângulo com a mesma fonte.

A redação devolve seu rascunho habitual. A aprovação **do texto final**, com
foto real, continua obrigatória. Os números do rascunho e da sugestão são
independentes. O painel permite escolher qual dos três títulos encaminhar;
no WhatsApp, a aprovação encaminha o primeiro título.

A nova aba será `https://tomezap.com.br/admin/#radar`. Ela precisa do login
existente e da API atualizada. Enquanto desligado, mostra o estado de espera.

## O que foi entregue e o que ainda não foi ativado

- Serviço separado `radar-viral`, Python 3.12, sem porta publicada na internet.
- Agenda de Fortaleza: 06:30, 12:00 e 18:30; modo intensivo opcional, desligado.
- Fontes oficiais/portais RSS e páginas municipais compatíveis com o coletor
  existente; busca Tavily geral e de perfis Instagram públicos configurados.
- Filtro de data, localidade e assuntos proibidos; Gemini produz o ângulo.
- Fila Redis persistente, deduplicação, cotas compartilhadas com a redação,
  decisões assinadas, novas tabelas privadas e nova função Edge.
- Integração aditiva no grupo e no painel. Home pública e fluxo de publicação
  existentes preservados.

**Esta entrega de código não é uma ativação na VPS.** A migration nova e a
função Edge abaixo ainda precisam ser instaladas; o novo serviço está desligado
por padrão. Nenhuma busca paga, mensagem real no grupo ou publicação real foi
executada nestes testes. Não foram alterados DNS, nginx ou serviços antigos.

## Decisões diferentes do rascunho do pedido

1. Tabelas `tnn_viral_pautas` e `tnn_viral_runs`, em vez de `radar_pautas` e
   `agent_log`: nomes exclusivos para não alcançar o antigo Radar Tome Nota.
   Métricas e erros sanitizados ficam em `tnn_viral_runs`.
2. O trabalhador usa o token de rascunhos já existente. `service_role` fica
   somente na nova Edge Function. Não há credencial privilegiada nova na VPS.
3. Cada pauta encaminhada recebe um job próprio; o turno permanece como `run_id`.
   Compartilhar o mesmo job entre três matérias colidiria com a idempotência
   do fluxo atual.
4. Imagem de RSS é apenas referência candidata. Não é baixada nem passa por foto
   autorizada. O Radar não envia essa imagem à publicação: o fluxo exige foto
   real enviada pelo editor, preservando o bloqueio de `b97371f`.
5. O filtro determinístico descarta mortes/tragédias antes do Gemini. Casos
   contextuais, como prevenção à violência, são classificados na mesma chamada
   editorial, evitando uma segunda chamada obrigatória por candidato.
6. Retentativas limitadas para banco/fila. Uma geração com resultado incerto não
   é refeita automaticamente após reinício, para evitar duplicar consumo.
   Envio ao WhatsApp com resultado incerto exige conferência humana; não há
   promessa impossível de entrega exatamente uma vez numa API externa.
7. Portela, Arenoso e São Sebastião não foram adivinhados como municípios.
   Exigem município/contexto confirmado antes de ampliar o mapa. Croatá precisa
   de contexto de distrito/SGA, para não misturar o município homônimo.
8. Google Trends não foi ligado a endpoint privado ou não documentado. A API
   oficial está em acesso antecipado; o conector aceita feed oficial autorizado
   configurado, apenas como pista. Sem acesso/feed, fica aguardando configuração.
   Os cinco tipos são configuráveis, mas não se declara que todos estão ativos.
9. Gatilhos são heurísticas editoriais. Referências científicas incompletas do
   pedido não foram convertidas em afirmações verificadas sobre viralização.

## Claude: instalação sem apagar ou substituir o sistema

### 1. Inspeção e atualização do código

Na **Hostinger**, `/opt/tomezap-robo`, confira o estado antes:

```sh
cd /opt/tomezap-robo
git status --short
git fetch origin
git log --oneline -6 origin/feat/tomezap-robo-whatsapp
```

Se houver modificações locais, preserve-as e compare antes de atualizar.
Somente com a árvore compatível, use avanço simples:

```sh
git pull --ff-only origin feat/tomezap-robo-whatsapp
```

Não use `reset --hard`, force-push ou `down -v`. Não acesse a antiga Contabo.

### 2. Supabase: apenas migration e função novas

Projeto: `dfbeerxqqfqkwlljrjko`.

Migration nova, uma única vez, verificando primeiro o histórico aplicado:

`supabase/migrations/20261017170554_tnn_viral_proposals.sql`

Ela cria duas tabelas privadas e quatro RPCs `tnn_viral_*`, sem mudar políticas
das publicações. As consultas a publicações e rascunhos são somente leitura.
Não execute migrations antigas pendentes às cegas com `db push`. As migrations
20261013230000, 20261013233000 e 20261015151014 já foram aplicadas anteriormente.
Registre a migration nova no histórico do projeto conforme o procedimento atual.

Publique **somente** a função nova:

```sh
supabase functions deploy tnn-viral --project-ref dfbeerxqqfqkwlljrjko --no-verify-jwt
```

O JWT é dispensado porque o handler valida os tokens próprios e assinaturas.
Sem token, a função deve devolver 401, nunca dados. Sem configuração, 503.

Secrets existentes necessários, só nomes — não gerar substitutos:

- `TNN_DRAFT_SERVICE_TOKEN`
- `TNN_DRAFT_READER_TOKEN`
- `TNN_EDITORIAL_SIGNING_KEY`
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` fornecidos pelo ambiente Edge.

Não alterar `tnn-editorial`, `tnn-drafts`, `radar-coletor` nem tabelas privadas
do sistema antigo. Não cole tokens em chat, prints ou saída de terminal.

### 3. Arquivo privado do novo serviço

Copie `radar-viral/.env.example` para `radar-viral/.env` **se ainda não existir**,
com permissão `600`. Complete em editor seguro com os valores existentes:

- `WA_PIPELINE_TOKEN`, `TNN_DRAFT_SERVICE_TOKEN`, `REDACTION_REDIS_PASSWORD`.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `TAVILY_API_KEY`.
- `TNN_VIRAL_URL` já aponta para a nova função neste projeto.
- `AGENTE_REQUER_APROVACAO=true` obrigatório.

Mantenha `RADAR_ENABLED=false` durante a preparação. Confirme no provedor que
o modelo configurado existe e tem cota gratuita na conta; a entrega não valida
o acesso real ao modelo. Só marque `GEMINI_FREE_TIER_CONFIRMED=true` e
`TAVILY_FREE_TIER_CONFIRMED=true` após essa conferência. Não habilite cobrança.

`RADAR_SOURCES` é JSON em **uma linha**, por exemplo, com listas preenchidas a
partir das fontes que o dono já aprovou:

```json
{"official":[],"portals":[],"instagram":[],"trends":[],"web":true}
```

Itens de official/portals: `{ "name": "nome", "url": "https://.../feed" }`.
Para listagem municipal compatível com o coletor existente, acrescente
`"kind":"listing"`. Os endereços devem ser HTTPS públicos e diretos, sem
redirecionamento. Instagram recebe nomes/perfis para a consulta pública; não
recebe senha, sessão ou cookies. Resultados sem data verificável são descartados.

Não coloque feeds fictícios para preencher a lista. Se só houver web habilitada,
o módulo opera com esse conector; fontes desativadas não aparecem como ativas.

### 4. Cotas: dividir o saldo, não somar planos

As variáveis globais devem ter **os mesmos valores** em `news-agent/.env.autonomous`
e `radar-viral/.env`:

| Variável | Padrão | Limite aceito |
|---|---:|---:|
| GEMINI_MAX_CALLS_PER_DAY | 40 | 200 |
| TAVILY_MAX_CALLS_PER_DAY | 20 | 30 |
| TAVILY_MAX_CALLS_PER_MONTH | 600 | 900 |
| RADAR_MAX_PAUTAS_DIA | 12 | 12 |
| RADAR_TAVILY_MAX_CALLS_DIA | 18 | 30 |
| RADAR_GEMINI_MAX_CALLS_DIA | 12 | 40 |

Esses tetos locais não aumentam a franquia do provedor. A redação e o Radar
consomem os mesmos contadores globais Redis. Outros aplicativos com a mesma
chave não entram nesses contadores: conferir também o painel do provedor.

Uma consulta Tavily básica custa 1 crédito. A varredura completa tenta até cinco
consultas prioritárias, uma agregada e uma de Instagram; com limites compartilhados,
algumas consultas/turnos podem ficar sem saldo. O plano gratuito documentado tem
1.000 créditos mensais; o teto local de 600 reserva folga, sem assegurar o saldo
da conta. Gemini: uma chamada por candidato avaliado, inclusive descartado;
uma correção usa outra chamada. Redigir a matéria após aprovar a sugestão consome
adicionalmente a cota do fluxo existente. Não há garantia de três pautas por turno.

Modo intensivo: `RADAR_CADA_20MIN=true`; continua limitado a três sugestões por
janela móvel de duas horas e ao teto diário. Deixe desligado na primeira ativação.

### 5. Compose: preparar antes de reiniciar produção

Confira o conteúdo de `/root/tomezap-compose.sh` para reutilizar o **mesmo**
`--env-file`, nome de projeto e os três overlays atuais. Não imprima o `.env`.
Nomes atuais dos serviços: `painel-api`, `whatsapp`, `redacao`, `redacao-redis`.
O novo overlay é o quarto arquivo; os caminhos são relativos ao primeiro.

Exemplo Bash: substitua o caminho marcado pelo arquivo já usado pelo atalho:

```sh
cd /opt/tomezap-robo
compose_env='/CAMINHO_REAL_DO_ENV_JA_USADO_NO_ATALHO'
dc=(docker compose --project-name tomezap-painel --env-file "$compose_env"
  -f panel-api/docker-compose.yml
  -f panel-api/docker-compose.whatsapp.yml
  -f panel-api/docker-compose.redacao.yml
  -f radar-viral/docker-compose.yml)
"${dc[@]}" config --quiet
"${dc[@]}" build radar-viral whatsapp painel-api
```

Não execute com o caminho de exemplo. `config --quiet` evita imprimir secrets.
A rede `redacao_privada` e o Redis são reutilizados. O serviço não publica porta,
não recebe sessão WhatsApp e não altera volumes ou nginx. Reserve margem de RAM
e confira disco antes do build: o container tem teto de 256 MB e 0,35 CPU.

Após preparar tudo, mostre ao dono os serviços exatos que precisam ser recriados
e peça confirmação **antes de reiniciar produção**. Só então:

```sh
"${dc[@]}" up -d --no-deps radar-viral
"${dc[@]}" up -d --no-deps whatsapp painel-api
"${dc[@]}" ps
```

Na primeira subida o Radar continua desligado. Para ativar, configure
`RADAR_ENABLED=true` tanto no `.env` próprio quanto no `.env` da ponte WhatsApp
(`whatsapp-bridge/.env`, confirme o caminho no Compose atual) e recrie apenas
`radar-viral` e `whatsapp`, após a confirmação necessária. Não reinicie Redis.
Confirme saúde com `exec -T radar-viral python -m tnn_viral.worker --healthcheck`.
Esse healthcheck verifica o processo/fila, não promete validade de todas as APIs.

### 6. Painel público no Render

Faça Manual Deploy da branch `feat/tomezap-robo-whatsapp` depois do push e da
API preparada. Build existente `node scripts/build-public-site.mjs`, saída
`dist-public`. Não aplicar `render.yaml` da raiz, não trocar domínio ou branch.
Abra `/admin/#radar` autenticado. AdSense, consentimento e home são preservados.

## Testes executados nesta entrega

Saídas locais, com APIs e WhatsApp simulados:

```text
Python novo módulo: Ran 16 tests ... OK
Python news-agent existente: Ran 92 tests ... OK
Node integração Radar + ponte + painel: tests 69, pass 69, fail 0
Node suíte completa: tests 233, pass 227, fail 3, skipped 3
```

Os três erros da suíte completa são testes Playwright existentes cujo Chromium
não está instalado neste ambiente (`Executable doesn't exist`). Os três skips
já são condicionais do projeto. A migration foi executada em PostgreSQL local
embutido (PGlite), cobrindo grants/RLS, dedupe, decisão concorrente e expiração.
Esse teste está incluído nos 69 de integração, não é teste no Supabase real.

Comandos de reprodução (dependências de teste em ambiente de desenvolvimento):

```sh
node --test tests/*.test.mjs tests/public-site.test.cjs
PYTHONPATH=news-agent:radar-viral python -m unittest discover -s radar-viral/tests -v
PYTHONPATH=news-agent python -m unittest discover -s news-agent/tests -v
```

Python exige dependências de produção e `fakeredis[lua]` nos testes. Para incluir
o teste SQL, instale `@electric-sql/pglite` fora do runtime e aponte
`TNN_PGLITE_MODULE` ao `dist/index.js`. Sem essa variável o teste SQL é skip.
Os testes visuais exigem a instalação do navegador Playwright em desenvolvimento.
Docker não está disponível neste ambiente; o build Compose e a reversibilidade
com containers reais devem ser verificados na VPS antes de declarar ativo.

## Aceite real na VPS (ainda pendente)

1. Desligado: `/painel-api/radar` devolve 503 autenticado; STATUS e redação
   habituais continuam respondendo. Nenhum cron/chamada de fornecedor do módulo.
2. Ativado: `RADAR caucaia` no grupo autorizado confirma rapidamente. Em até cinco
   minutos conferir sugestões datadas, fonte HTTPS e Caucaia/localidade região.
   Sem candidato adequado, o log deve indicar `no_candidates`, não inventar pauta.
3. Segundo RADAR durante execução responde ocupado; cidade entregue fica em
   intervalo de seis horas. Cron e manual simultâneos não duplicam o turno.
4. Confirmar morte/acidente fatal descartados sem Gemini; quota esgotada não
   inicia nova coleta; comandos de remetente não autorizado são ignorados.
5. `APROVAR R<ID>` cria só um rascunho. Sem foto real, aprovação final continua
   bloqueada. Depois de receber foto e aprovação do texto, conferir publicação
   real e link pelo fluxo existente. Só marcar este teste como passado após isso.
6. Corrigir uma sugestão: nova revisão, mesmos links; aprovar revisão antiga é
   recusado. Fonte com mais de 24 h expira sem gerar matéria.
7. Reinício autorizado: sessão WhatsApp preservada; não repete turnos perdidos.
8. Conferir mobile/desktop na nova aba, correção, escolha de título e erro de rede.

## Desligar / reverter sem apagar dados

Defina `RADAR_ENABLED=false` no arquivo do módulo e da ponte. Após confirmação
para recriar a ponte em produção, aplique apenas esses serviços. O módulo falso
não inicia Redis/cron/provedores. A ponte falsa não envia mensagens Radar nem
interfere com as aprovações normais.

Para remover o container depois, pare/remova **somente `radar-viral`**, sem
volumes, e retire o quarto overlay do atalho. Não retire serviços, redes ou
volumes da redação. As novas tabelas podem ficar privadas para preservar histórico.
Se apenas o container parar, a aba mostra indisponível e os comandos próprios
Radar podem falhar; a redação habitual continua independente.

## Fontes das decisões técnicas

- Tavily: https://docs.tavily.com/documentation/api-credits
- Google Trends API / acesso antecipado: https://developers.google.com/search/apis/trends
- Supabase / privilégios de funções: https://supabase.com/docs/guides/database/functions

Não há credenciais neste documento. Não compartilhar `.env`, sessão WhatsApp,
Deploy Hook, chave Gemini ou tokens com uma IA auditora; forneça código e logs
sanitizados, com acesso de leitura quando possível.
