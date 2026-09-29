# Tome Nota News — GitHub Pages + Supabase

Esta edição pública substitui a instalação WordPress do ZIP por uma página estática no GitHub Pages e uma tabela somente de leitura no projeto Supabase gratuito já conectado. O repositório do Radar Tome Nota e o schema privado radar permanecem separados.

## Publicação

- Site: https://ppaulomaciel32-cell.github.io/tome/
- Arquivos do site: public-site/
- Tabela pública: public.tomenota_publications
- Workflow: .github/workflows/public-site.yml
- SQL: database/tomenota_public_site.sql

O workflow publica public-site/ com GitHub Actions. A fonte do GitHub Pages precisa estar como GitHub Actions no repositório. O endereço só fica disponível depois da primeira publicação concluída.

## Publicar uma matéria

Use o SQL Editor do projeto Supabase ou peça ao Codex conectado para inserir a matéria depois da revisão editorial. A tabela não aceita escrita anônima nem leitura de rascunhos.

    insert into public.tomenota_publications
      (slug, title, summary, body, city, section, status, published_at)
    values
      ('slug-da-materia', 'Título revisado', 'Resumo revisado.', 'Texto revisado da matéria.',
       'Pecém', 'noticias', 'published', now());

Para manter a matéria fora do site, use status = 'draft' e deixe published_at nulo. A API pública só pode ler os campos editoriais de publicações aprovadas. Não publique dados pessoais nem textos sem apuração.

## Limites desta adaptação

- GitHub Pages serve HTML, CSS e JavaScript. Ele não executa o PHP nem instala o tema ou plugin WordPress do ZIP.
- Esta primeira versão cobre a página pública de notícias, busca, filtro por cidade e editoria, leitura de matéria, compartilhamento manual e instalação PWA.
- Não há painel editorial web, login de leitor, envio de fotos, vagas com validade, pesquisas eleitorais, anúncios, Café diário ou moderação de contribuições nesta adaptação. Esses recursos continuam no ZIP WordPress.
- As matérias devem ser aprovadas e inseridas no Supabase pela redação. Conteúdo de apuração no schema radar não é usado nem exposto no site.
- Não há domínio próprio, e-mail transacional, analytics, IA paga, API de WhatsApp ou outro serviço contratado.

## Custo

O site usa o plano gratuito existente do GitHub e o projeto Supabase já conectado. Não há coleta pública de dados: o navegador só lê matérias aprovadas e pode guardar os arquivos estáticos no cache local do PWA.
