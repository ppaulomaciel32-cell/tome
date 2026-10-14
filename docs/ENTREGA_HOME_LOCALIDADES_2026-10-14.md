# Home e localidades — entrega de 14/10/2026

Base conferida com `git fetch origin`: `52f941f1f39b5545430db28d33d6b04f532edfc2`.
Trabalho na branch `feat/tomezap-robo-whatsapp`. Nenhum deploy foi solicitado.

## O que o leitor verá

- Abertura mais curta, em azul, com acesso direto às notícias. A home deixa de
  carregar GSAP, o vídeo e a sequência longa de apresentação; o arquivo
  `motion.js` continua no repositório, sem alteração.
- Primeiras 24 matérias no HTML gerado, preservadas quando o JavaScript inicia.
  Os próximos lotes têm 12 registros. A consulta usa offset bruto, ordem estável
  e data de corte para não deixar novas publicações deslocarem a paginação.
- O observer carrega perto do fim; o botão permanece como alternativa. Há
  deduplicação por id e slug, uma requisição por vez, cancelamento na busca e
  interrupção quando a página se repete ou não há novos registros disponíveis.
- Quando termina, aparece “Você está em dia”. Com 0 ou 1 matéria, o estado do
  build evita outra consulta, esqueletos permanentes e reservas para anúncios
  que ainda não têm posição na lista.
- A cada três lotes (contando o inicial), uma consulta opcional procura até
  100 matérias recentes da mesma localidade, ou da região na home. Seleciona
  três inéditas dos últimos 30 dias. Estas entram na deduplicação e não voltam
  a aparecer nos próximos lotes. Sem três candidatas, o bloco não aparece.
  A busca não mistura destaques externos aos resultados.
- Publicidade depois do 6º cartão regular e depois a cada 12. Destaques não
  contam como cartões regulares. Os anúncios de topo/fim deixam de aparecer
  nas listas para reduzir a densidade; continuam nas páginas de matérias.
- Sem slot válido ou consentimento, aparece “Anuncie no Tome Nota”, com link
  para `/contato.html`. Com slot e consentimento, a mesma reserva recebe AdSense.
  O rótulo “Publicidade” permanece separado das notícias. A altura não muda
  na troca. A distância entre anúncios leva em conta a altura da tela.
- Imagens 16:9, dimensões declaradas, lazy loading e srcset para as capas
  próprias 800/1600. Cartões com área previsível para título e resumo,
  esqueletos equivalentes e `content-visibility` para listas longas.
- Uma coluna até 639 px, duas até 959 px, três a partir de 960 px. Controles
  de pelo menos 44 px, foco visível e respeito à redução de movimento.
- Falha de rede mantém os cartões, interrompe o observer e oferece “Tentar de
  novo”. A tentativa reaproveita o offset que ainda não foi confirmado.

## Arquivos

`public-site/index.html`, `public-site/noticia.html` (carregador usado pelo
template das cidades), `public-site/app.js`, `public-site/styles.css`,
`public-site/assets/js/feed-model.js`, `public-site/assets/js/ads.js`,
`scripts/build-public-site.mjs`, `tests/feed-model.test.mjs`,
`tests/news-feed.test.mjs`, `tests/public-site.test.cjs`,
`tests/ssg.test.mjs`, `tests/monetization.test.mjs` e este documento.

Nenhuma mudança em `news-agent/`, `whatsapp-bridge/`, `panel-api/`,
`public-site/admin/`, banco, migrations, RLS, CSP ou textos legais.
Consentimento, GA4 e editor AdSense `ca-pub-2000164835494228` preservados.
Não há nova dependência do site. Os testes DOM usam o jsdom já existente
nas dependências de desenvolvimento do repositório.

## Verificação executada

```sh
node --test tests/news-feed.test.mjs tests/feed-model.test.mjs tests/public-site.test.cjs tests/ssg.test.mjs tests/monetization.test.mjs
```

Resultado: **32 testes aprovados**, nenhuma falha. Inclui listas com 0, 1 e
100 matérias, término do observer, paginação, destaque a cada terceiro lote,
deduplicação, repetição da página pelo servidor, busca, retry, cartões SEO
preservados, publicidade/fallback/consentimento, srcset e texto malicioso.

Também foi executado o comando solicitado:

```sh
node --test tests/*.test.mjs tests/public-site.test.cjs
```

Após preparar as dependências existentes e o build local esperado pelos testes,
resultado: **201 aprovados, 5 opcionais ignorados, 3 falhas de ambiente**.
As três são `drafts-ui`, `panel-ui` e `whatsapp-ui`: Chromium não instalado.
A instalação do navegador não terminou; houve falha no download e bloqueio
da aprovação de rede na tentativa seguinte. Esses testes não demonstram
regressão no site, mas a suíte completa não foi declarada aprovada.

Não foi medido CLS em navegador real neste ambiente. Dimensões, reservas e
preservação dos elementos foram verificadas por testes; medir em navegador
é parte da conferência final descrita abaixo.

## Claude: publicação

1. Faça fetch e confira o hash final informado pelo Codex nesta branch.
2. Não é necessário reiniciar a VPS, cadastrar secrets, nem rodar migrations.
3. No Render, mantenha `node scripts/build-public-site.mjs` e `dist-public`.
   Execute **Manual Deploy → Deploy latest commit**, conforme autorização do dono.
4. Mantenha os valores atuais de `SITE_URL`, AdSense e GA4. Para anúncios
   manuais da lista, o slot utilizado é `ADSENSE_SLOT_HOME`.
5. Se Auto Ads estiver habilitado na conta Google, exclua a home e as páginas
   `/localidade/` dos posicionamentos automáticos para manter o limite de
   um anúncio por tela. O espaçamento do código controla os blocos manuais;
   posicionamentos adicionais do Google dependem dessa configuração na conta.

## Conferir no celular e computador

- Abra `/` e `/localidade/pecem/`. Com a matéria atual, deve haver um cartão,
  “Você está em dia” e rodapé alcançável, sem carregamento permanente.
- Busque uma palavra da manchete e depois uma inexistente. Limpe a busca.
  O resultado precisa mudar e voltar corretamente.
- Confira 320, 390, 768 e 1440 px: sem rolagem lateral, capas 16:9, controles
  acessíveis e grade de 1/2/3 colunas. Confira também redução de movimento.
- Quando houver mais de 24 notícias, role até o fim e confirme que entram
  lotes de 12, sem repetição. O botão continua utilizável por teclado.
- Com 48 matérias carregadas e três candidatas recentes restantes, confira
  “Destaques do Tome Nota”. Nenhum rótulo de popularidade deve aparecer.
- Em uma lista com seis ou mais matérias, confira o anúncio da casa e o
  rótulo. Com slot real e “Aceitar todos”, confira a troca no mesmo espaço.
- No DevTools, simule Offline antes do próximo lote: cartões preservados,
  “Tentar de novo”, nenhuma sequência automática de erros. Volte Online e tente.
- Na aba Performance, grave carregamento e rolagem com rede lenta: verificar
  layout shifts, principalmente capas, fontes, consentimento e anúncios reais.
  Verifique que os cartões iniciais permanecem os mesmos elementos no DOM.

É necessário volume real para conferir rolagem/destaques em produção; os
testes automatizados usam fixtures de 100 matérias e não publicam notícias.
