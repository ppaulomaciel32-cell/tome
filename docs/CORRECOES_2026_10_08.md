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

## Proximas etapas e limites

Usar os nomes reais `title`, `summary` e `body`; os nomes em portugues sao aliases
do PostgREST. Preservar URLs antigas e a policy que tambem bloqueia publicacoes
agendadas. O escopo de banco e somente `public.tomenota_publications`.

O documento recebido exige confirmacao antes de novas rotas ou dependencias.
Pre-render em `/noticia/<slug>/`, proxy em `/api/publications` e ferramentas novas
de build/CI serao apresentados para decisao antes da implementacao.
