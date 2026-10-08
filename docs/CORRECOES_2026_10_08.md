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

## Proximas etapas e limites

Usar os nomes reais `title`, `summary` e `body`; os nomes em portugues sao aliases
do PostgREST. Preservar URLs antigas e a policy que tambem bloqueia publicacoes
agendadas. O escopo de banco e somente `public.tomenota_publications`.

O documento recebido exige confirmacao antes de novas rotas ou dependencias.
Pre-render em `/noticia/<slug>/`, proxy em `/api/publications` e ferramentas novas
de build/CI serao apresentados para decisao antes da implementacao.
