# Site publico: seguranca, contato e AdSense

Site: https://tome-nota-publico.onrender.com
Repositorio: ppaulomaciel32-cell/tome
Branch de deploy: public-site-github-supabase
Diretorio publicado: public-site (esta e a raiz HTTP do site).

## Escopo e seguranca

Somente public.tomenota_publications e a nova public.mensagens_contato foram usadas.
A policy existente das publicacoes permanece inalterada: status='published' e
published_at <= now(). Nenhuma tabela privada foi consultada ou modificada.
No frontend ha apenas a chave anon, em public-site/assets/js/config.js.
Robots.txt nao e controle de acesso e nao torna a chave anon secreta.
Nenhuma chave privilegiada foi encontrada nos arquivos publicos inspecionados.

A listagem usa PostgREST REST, sem instalar SDK, com os seis campos:
id,titulo:title,resumo:summary,capa:cover_url,slug,publicado_em:published_at.
Na noticia individual sao acrescentados texto:body,autor:author,editor:publisher.
Sao campos editoriais publicos necessarios ao artigo e ao NewsArticle.
Nao existe select('*') e nao sao solicitados status ou campos internos.
author e publisher foram adicionados somente a tabela publica, com credito
institucional padrao Tome Nota News; substitua o credito autoral por noticia
quando houver autoria individual. SELECT de id, author e publisher foi
concedido apenas a anon, sem alterar RLS.

## SQL

database/mensagens_contato.sql cria a tabela de contato com RLS, checks e
somente INSERT(nome,email,mensagem) para anon. Nao ha SELECT/UPDATE/DELETE
publicos. O POST usa Prefer: return=minimal, sem solicitar retorno dos dados.
database/publication_credits.sql adiciona campos publicos e grant por coluna.
Os dois scripts ja foram aplicados e os testes usam rollback.

O honeypot, os limites e o bloqueio de envio duplicado reduzem erros simples,
mas NAO sao rate limiting nem protecao completa contra bots. Uma API publica
de INSERT pode receber spam; monitore o uso para permanecer nas cotas gratis.
O site nao manda e-mail automaticamente e nao cria um painel: o responsavel
le as mensagens pela interface ja existente do Supabase, sem acesso anonimo.
A retencao e eliminacao de mensagens dependem da operacao do responsavel.

## Cabecalhos no Render: etapa obrigatoria

O Render nao interpreta _headers automaticamente. public-site/_headers contem
a configuracao solicitada; docs/render-public-site.yaml registra o equivalente
oficial para apenas o site publico. O render.yaml existente foi preservado.

No servico tome-nota-publico:
https://dashboard.render.com/static/srv-dau355gu01pc73b2mvjg
abra Settings > Headers e adicione as cinco entradas para o path /*, usando
os nomes/valores de public-site/_headers. Os conectores desta sessao nao
oferecem atualizacao de headers, por isso esta etapa nao foi aplicada.
Nao crie outro servico, nao importe o Blueprint do sistema privado.

As paginas aplicam CSP por meta e Referrer-Policy por meta como protecao
imediata. frame-ancestors e X-Frame-Options exigem headers HTTP reais.
Permissions-Policy e X-Content-Type-Options tambem dependem dessa configuracao.
A CSP segue a lista de hosts pedida. O Google pode exigir hosts adicionais
para formatos/recursos futuros; revise apenas apos testar o codigo real.

## AdSense configurado e campos pendentes

ID instalado em 08/10/2026: ca-pub-2000164835494228 em assets/js/config.js,
nos ins das sete paginas HTML e na metatag google-adsense-account de cada head.
O arquivo public-site/ads.txt usa pub-2000164835494228, sem o prefixo ca-.
A pasta public-site e a raiz publicada pelo Render.

1. E-mail: informe o endereco editorial real em contactEmail de assets/js/config.js.
   Enquanto vazio ou invalido, common.js remove o bloco inteiro de e-mail, sem
   criar mailto. O formulario e o Instagram continuam como canais publicados.
2. Slots manuais, se forem usados: troque 0000000000 nos ins dos HTML pelo ID
   de topo/rodape apropriado.
   Em public-site/app.js, troque o ID do slot criado por adSlot() pelo ID do
   anuncio in-article. Configure cada unidade com o formato correto no Google.

O script externo fica bloqueado ate aceitar todos e ate o cliente ter formato
valido. Slots zerados ficam ocultos junto com o rotulo Publicidade e o espaco
reservado, desde o HTML inicial e tambem no artigo carregado por JavaScript.
Eles nunca sao enviados para a fila de anuncios. ads.js revela somente slots
manuais configurados. Os anuncios automaticos independem desses slots: podem
funcionar apos o consentimento, se ativados no painel e aprovados pelo Google.
Nenhum script do Google e carregado antes da primeira escolha ou pela recusa.

## Verificacao e consentimento

A META TAG de verificacao ja esta no codigo-fonte das sete paginas, abaixo do
comentario <!-- ADSENSE VERIFICATION: cole aqui -->. A verificacao por Metatag
nao depende do consentimento e nao carrega JavaScript do Google. Nunca cole
ali o script externo AdSense: isso violaria o bloqueio antes do consentimento.
No painel AdSense: selecione Metatag, marque Inseri a tag e clique em Verificar.
Solicitar revisao e uma etapa separada; antes, publique conteudo editorial
proprio e revise os dados de contato. Esta alteracao nao solicita revisao e nao
publica materias nem altera dados ou politicas no Supabase.

localStorage.tnn_cookie_consent guarda all ou essential; o aviso nao reaparece
apos uma escolha. O rodape permite reabrir as preferencias. Ao revogar,
a pagina recarrega para descartar scripts. Cookies de terceiros ja existentes
devem ser apagados no navegador; o site nao pode apagar cookies de outro host.
A retirada tambem e propagada entre abas pelo evento storage.

O banner nao e uma CMP certificada pelo Google. Para anuncios a visitantes
de regioes em que o Google exige CMP certificada, configure uma solucao
compativel (por exemplo a oferta gratuita do Google, se aplicavel) antes de
ativar a publicidade nessa regiao. O consentimento de publicidade e separado
da autorizacao do formulario de contato.

Textos em portugues se baseiam na LGPD e descrevem o funcionamento implementado:
https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
Nao constituem auditoria juridica nem garantia de conformidade; o responsavel
deve manter canais, retencao, contratos com operadores e atendimento de direitos.

## SEO e publicacao

Todas as paginas possuem titulo/descricao exclusivos, canonical, OG e Twitter.
A imagem social e assets/images/og-tome-nota.png (PNG 1200x630).
Uma noticia abre em /noticia.html?slug=SLUG. A busca pelo slug e feita no banco,
sem depender das primeiras 60 materias. Links antigos /?noticia=SLUG funcionam.
O JavaScript atualiza metadados e NewsArticle com dados publicos reais.
A tabela e o site podem estar vazios: nenhuma noticia ficticia foi publicada.

Limitacao de sites estaticos com REST no navegador: robos sociais que nao
executam JavaScript veem os metadados genericos de noticia.html, nao os da
materia. Para metadados por URL no HTML de resposta, seria necessario gerar
um HTML estatico por materia durante a publicacao. O sitemap tem as seis
paginas fixas e comentario pronto para inserir URLs de noticias publicadas.
Nao acrescente drafts, noticias inexistentes ou a pagina noticia.html sem slug.

Sem frameworks, sem dependencia de runtime nova e sem npm install obrigatorio.
O antigo service worker elimina apenas caches tome-nota-shell- e se aposenta,
evitando servir codigo antigo de privacidade/consentimento.

## Deploy

O Render ja usa a branch public-site-github-supabase e publishPath public-site.
Um commit nessa branch dispara deploy automatico. Build permanece o no-op
existente, nao ha necessidade de contratar servico nem alterar plano.
Se o deploy falhar, consulte Events do servico publico; nao toque no Radar.
Verifique politica-de-privacidade.html, contato.html, robots.txt, sitemap.xml e
ads.txt. Aplique os headers HTTP na etapa acima e confira a resposta real.
Planos gratuitos possuem cotas; nao ha garantia de custo zero fora dos limites.

## Testes

tests/public-site.test.cjs usa somente Node, sem instalar dependencias.
Execute: node --test tests/public-site.test.cjs.
Usa mocks (nao cria publicacoes no banco) para testar paginas, consentimento,
anuncios, metadados, contato, erros e selecao de colunas.
Validacao visual desktop/mobile nao foi executada: o ambiente nao tem Chromium
e a tentativa de download retornou arquivos invalidos. Confira responsividade
no navegador antes de ativar anuncios reais.
Os testes reais de RLS foram feitos no Supabase com dados temporarios rollback.
