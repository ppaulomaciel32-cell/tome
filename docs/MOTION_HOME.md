# Movimento da home do Tome Nota News

## Escopo

A home substitui news-intro por tn-reveal e inclui tn-stage antes de #ultimas.
Arquivos de producao alterados/criados:
- public-site/index.html
- public-site/styles.css (somente bloco adicional /* === TN MOTION === */)
- public-site/motion.js
- public-site/vendor/gsap.min.js
- public-site/vendor/ScrollTrigger.min.js

app.js, sw.js, config.js, common.js, consent.js, ads.js, os blocos de anuncios,
as secoes de noticias/comunidade e todas as outras paginas foram preservados.
Nenhum banco ou sistema privado foi acessado.

## Assets e bibliotecas

GSAP e ScrollTrigger 3.15.0 sao copias oficiais da distribuicao:
https://github.com/greensock/GSAP/tree/3.15.0/dist
Os comentarios de licenca originais foram preservados.
Os scripts sao servidos por /vendor, sem CDN, sem build ou npm install no deploy.

As cinco URLs fornecidas estao somente nos locais definidos na especificacao:
base e alternativa nas variaveis CSS, recorte no src da imagem,
video e poster nas constantes de motion.js. O preload repete apenas a base.
O script usa currentSrc/src do recorte para a mascara da silhueta.
A tipografia usa tamanhos fixos por breakpoint e espacamento zero entre letras;
a composicao mantem as fontes e cores existentes. Tempos, mascaras, interpolacao,
scrub, stagger e blur seguem os valores da especificacao.

## Comportamento

A lente aceita mouse/caneta, ignora toque, encaixa na primeira posicao e segue
o cursor com suavizacao independente da frequencia do monitor. Ela desaparece
ao sair, cancelar, perder foco, redimensionar ou rolar para fora da secao.
A altura superior acompanha o anuncio via ResizeObserver, sem duplicar triggers.

O palco usa rolagem nativa e position:sticky. Seu MP4 H.264 continua pausado e
acompanha a rolagem nos dois sentidos, com keyframes do asset fornecido.
O loop para fora da tela e quando o documento fica oculto.
O loader fica somente no palco e tem timeout de 10 segundos.
A timeline funciona mesmo se o video falhar.
Desktop tem pausa de leitura e saida com blur; mobile sobe a coluna de cards.
A navegacao da noticia por ?slug= e ?noticia= nao inicializa o movimento.

Redução de movimento, Economia de Dados ou falha de carregamento do GSAP:
nenhum MP4 e carregado; o poster, a manchete e os tres cards ficam em fluxo
estatico, sem sticky. A lente continua disponivel, com resposta imediata no modo
de reducao de movimento.

## CSP

Somente a meta CSP da home recebeu:
media-src 'self' https://res.cloudinary.com;
Todas as outras diretivas e as outras paginas permaneceram iguais.
A resposta HTTP atual do Render nao possui CSP por cabecalho. Quando os headers
HTTP forem configurados, inclua tambem essa diretiva no CSP da home.
Uma meta CSP nao pode liberar um host bloqueado por outro CSP enviado no header.

## Validacao

- node tests/public-site.test.cjs: 10 testes existentes aprovados.
- node tests/motion-browser.cjs: 11 cenarios de navegador aprovados, mais a
  verificacao de ausencia de erros JavaScript e violacoes de CSP.
- Chrome Headless 154.0.8037.92, com suporte H.264 efetivamente verificado.
- Larguras: 320, 360, 390, 768, 1024 e 1440px; sem overflow horizontal.
- Capturas de abertura e compromisso inspecionadas em desktop e mobile.
- MP4 respondeu HTTP 206, Content-Range bytes 0-1023/3761470.
- Video testado avancando e voltando, sem autoplay, scale ou zoom.
- Anuncio do topo aumentado em 80px: medida atualizada e triggers sem duplicacao.
- Reduced-motion, saveData, GSAP ausente e URLs de noticia testados.

Os testes de navegador usam Playwright apenas como ferramenta opcional.
Nao e dependencia do site. Por padrao usam channel:chrome; se necessario:
TNN_CHROME_EXECUTABLE=/caminho/do/chrome node tests/motion-browser.cjs
TNN_SCREENSHOT_DIR define onde salvar as capturas temporarias.
Noticias do banco sao substituidas por mocks durante os testes, sem gravacoes.

## Deploy

Mesma branch public-site-github-supabase, mesmo servico tome-nota-publico,
mesmo publishPath public-site, mesmo build sem etapas novas e sem alteracao
de plano. Nao altere o render.yaml existente.

