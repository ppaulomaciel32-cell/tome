# Proxima etapa para aprovacao

O documento Texto colado(9).txt pede pausa antes de mudar rotas publicas ou
introduzir dependencias. As etapas de banco, busca e paginacao foram executadas
usando HTML/JS existentes e testes nativos do Node/Postgres.

## SEO proposto — preservando os links atuais

- Adicionar `/noticia/<slug>/index.html` gerado no build. Manter
  `/noticia.html?slug=...`, `/?slug=...` e `/?noticia=...` funcionando.
- Criar scripts Node em `scripts/` para consumir somente a API publica e produzir
  HTML escapado por materia em `dist/`, com NewsArticle, BreadcrumbList, canonical,
  Open Graph, Twitter Card e sitemap com updated_at.
- Nenhum Astro/React/WordPress. O site publicado continua estatico no Render.
- Configuracao publica por env: siteUrl, e-mail editorial, client e slots do
  AdSense. Metatag e ads.txt sao escritos no build; consentimento continua
  obrigatorio para o script externo do Google.
- Antes de trocar o build/publish path no Render, testar localmente o dist e
  documentar o acionamento autenticado do build a cada publicacao. Nao afirmar
  sincronizacao automatica enquanto esse acionamento nao estiver validado.

## Dependencias propostas, somente para build e verificacao

- esbuild: bundle/minificacao e nomes de assets com hash.
- Vitest: suite solicitada, migrando os casos ja comprovados nos testes nativos.
- ESLint e Stylelint: verificacao de JavaScript/CSS.
- Lighthouse CI: medicao dos budgets mobile solicitados.

Fixar versoes e lockfile somente depois da autorizacao. Nao mudar o plano de
Render/Supabase nem contratar servicos. Testes SQL atuais nao exigem pgTAP;
antes de instalar extensao, confirmar a necessidade e o escopo.

## Proxy e recursos seguintes

O proxy `/api/publications` ainda exige confirmar o encaminhamento no Render
estatico e a persistencia do limite de 60 requisicoes/minuto por IP entre
instancias da Edge Function. Um contador apenas em memoria nao garante esse
limite distribuido. Nao criar tabela adicional nem alegar que esconde a anon
key ou substitui RLS sem definir essa arquitetura dentro do escopo permitido.

Depois: headers HTTP reais, carregamento de motion por pagina, imagens
responsivas, PWA/offline e consentimento com versao/timestamp. Verificar cada
etapa antes do commit/publicacao. O e-mail real ainda precisa ser informado.

## Rollback previsto

Manter os arquivos e rotas atuais durante a transicao. Se o build novo falhar,
restaurar `staticPublishPath=public-site` e o comando estatico anterior no Render,
e reverter o commit do build. Nao apagar noticias nem desfazer migrations de
outras partes do sistema.
