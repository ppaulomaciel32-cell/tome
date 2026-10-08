# Correcoes do site publico — 08/10/2026

## Etapa 1 — AdSense e contato

ID `ca-pub-2000164835494228` instalado no config e nas sete paginas HTML;
metatag estatica em cada head e `pub-2000164835494228` em `public-site/ads.txt`.
Slots manuais de exemplo ficam ocultos, incluindo rotulo e altura reservada,
e nao entram em `adsbygoogle.push`. Anuncios automaticos podem carregar apenas
depois do aceite. `consent.js` permanece sem alteracoes.

O e-mail nao informado foi retirado do conteudo visivel. `common.js` valida a
configuracao, remove o bloco se invalida e so cria `mailto:` para endereco valido.

Arquivos: sete HTML em `public-site/`; `ads.txt`; `app.js`;
`assets/js/{config,ads,common}.js`; `tests/public-site.test.cjs` e documentacao.

Teste: `node --test tests/public-site.test.cjs`.

Risco: a instalacao nao habilita anuncios na conta Google nem solicita revisao.
Slots manuais exigem IDs reais. A revisao depende do conteudo editorial e da
analise do Google. Configuracao por env sera integrada ao build de pre-render.

Rollback: reverter o commit `fix(adsense): connect publisher and hide placeholders`
e publicar novamente no mesmo servico Render. Nenhuma migration nesta etapa.

## Etapa 1.1 — Schema publico

Preflight: 0 registros totais, 0 visiveis, 0 usando data existente e 0 exigindo
fallback de created_at. Backfill nao promove rascunhos nem antecipara agendadas.
Migration em `supabase/migrations/*_harden_publications.sql`: limites de slug,
title e summary, vetor de busca em portugues, indices e trigger de timestamps.
Chaves, nomes fisicos, limite de body, cover HTTPS e policy existente preservados.

Arquivos: migration, `database/publications_backfill_preflight.sql`,
`tests/publications-schema.sql`, `tests/publications-rls.sql` e este documento.

Teste: `psql "$TNN_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/publications-schema.sql`.
Tambem pode executar o arquivo inteiro no SQL Editor; termina com ROLLBACK.
Resultado executado no Supabase: PASS para defaults, transicao de publicacao,
updated_at, vetor gerado em portugues e rejeicao dos quatro campos invalidos.
O teste RLS foi escrito antes das permissoes e reproduziu 42501 ao filtrar status:
a role anon ainda nao tinha acesso a essa coluna. A etapa 1.2 corrige esse acesso.

Risco: novas escritas exigem resumo de 10 a 500 caracteres, titulo de 3 a 300 e
slug de 3 a 240. Rollback seguro do frontend e `git revert` do commit correspondente.
Antes de reverter constraints no banco, conferir se novas linhas cabem nos limites
antigos (titulo 5-180; resumo <=500). Nao remover dados para forcar rollback.

## Etapa 1.2 — Acesso anonimo e RLS

Migration `supabase/migrations/*_public_publications_read_access.sql` concede
somente SELECT a anon na tabela publica, inclusive status/search para filtros.
Mantida a policy original: `status='published' AND published_at <= now()`.
Nao houve mudanca em policies, nomes ou dados de tabelas privadas.

Teste: `psql "$TNN_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/publications-rls.sql`.
Resultado no banco: PASS; publicada visivel, rascunho/agendada invisiveis,
INSERT/UPDATE/DELETE rejeitados com 42501; 0 fixtures depois do rollback.
Conferencia adicional: anon_write=false, trigger security_definer=false,
RPC do trigger inacessivel a anon. Inspecao de seguranca limitada a esta tabela.

Risco: SELECT abrange todas as colunas da tabela publica; manter apenas dados
publicaveis nela. O cliente continua com whitelist de campos. Para reverter o
GRANT, primeiro reverter o filtro/busca no frontend e depois revogar SELECT da
tabela (os antigos grants de leitura por coluna permanecem).

## Etapa 1.3 — Filtro explicito no cliente

`public-site/app.js` acrescenta `status=eq.published` no ponto unico de requests,
para a listagem e para noticias por slug. Teste: `node --test tests/public-site.test.cjs`;
11/11 passaram, incluindo a assercao do filtro na consulta individual.
Rollback: reverter o commit `fix(api): explicitly filter published stories`.
As rotas antigas continuam validas; nenhum filtro de seguranca foi removido.

## Etapa 1.4 — Busca em todas as publicacoes

`public-site/app.js`: busca no servidor, debounce de 300 ms, cancelamento com
AbortController, protecao contra respostas atrasadas e offset zerado por termo.
O caso de 95 noticias com a materia procurada na posicao 91 falhou antes da
correcao e passou depois. `tests/public-site.test.cjs` tambem testa cancelamento
e termos contendo virgula, parenteses, aspas, porcentagem, underscore e asterisco.

A sintaxe REST correta e `search=wfts(portuguese).TERMO` e os filtros usam
`title`/`summary`, nunca os aliases `titulo`/`resumo`. Termos curtos usam ILIKE
com valor entre aspas. Para `*` literal usa-se regex escapada, porque o PostgREST
converte asteriscos de LIKE em curingas mesmo dentro das aspas.

Teste: `node --test tests/public-site.test.cjs` — 14/14 passaram.
Rollback: reverter o commit `fix(search): query all published stories on the server`;
a coluna e o indice de busca podem permanecer no banco sem afetar a versao antiga.

## Proximas etapas e limites

## Etapa 1.5 — Paginacao com total real

Arquivos: `public-site/app.js`, `public-site/index.html`,
`tests/public-site.test.cjs` e este documento. Paginas de 24 materias,
`Prefer: count=exact`, total lido de `Content-Range` e indicador X de Y materias.
O botao de carregar mais usa o total real. Falta de contagem gera estado de erro,
sem inventar um total. A busca e limitada a 100 caracteres. Apenas a contagem,
e nao o grid inteiro, usa aria-live.

Teste: `node --test tests/public-site.test.cjs` — 16/16 passaram.
Fixture de paginacao: 24 de 52, 48 de 52, 52 de 52; offsets 0, 24, 48.
Queries HTTP anon reais para full-text, virgula/parentese, asterisco literal e
rascunhos retornaram HTTP 200, Content-Range */0 e nenhuma noticia.
Rollback: `git revert` do commit `fix(pagination): use exact totals and pages of 24`.
Risco: count=exact pode ficar mais caro com um catalogo muito grande; monitorar
sem substituir silenciosamente o total por estimativa.

## Proximas etapas e limites

Usar os nomes reais `title`, `summary` e `body`; os nomes em portugues sao aliases
do PostgREST. Preservar URLs antigas e a policy que tambem bloqueia publicacoes
agendadas. O escopo de banco e somente `public.tomenota_publications`.

O documento recebido exige confirmacao antes de novas rotas ou dependencias.
Pre-render em `/noticia/<slug>/`, proxy em `/api/publications` e ferramentas novas
de build/CI serao apresentados para decisao antes da implementacao.
