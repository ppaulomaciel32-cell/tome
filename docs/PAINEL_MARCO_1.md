# Painel TomeZap — entrega do marco 1

Data: 11 de outubro de 2026. Branch: `feat/painel-controle-tomezap`.
Base preservada: `da141ecb4efd0e8deafccd198cb44855812f13a0`.
Responsável autorizado: `p.paulomaciel.32@gmail.com`.

## O que mudou

- Painel azul-marinho com navegação para Biblioteca, WhatsApp, Instagram,
  Marketing, Infraestrutura e Resultados, além da visão geral e ajuda.
- Tela de login e API Node independente, com autenticação no Supabase e
  autorização conferida no servidor. Nenhum cadastro aberto ou chave secreta
  no navegador. O e-mail do dono está no exemplo de configuração do servidor.
- Sessão protegida, limite de tentativas, verificação de origem e encerramento
  local da sessão. Editores autorizados recebem papel distinto do dono.
- Estados de espera explícitos. Indicadores ainda sem fonte aparecem como “—”,
  e serviços ainda não monitorados aparecem como “Ainda não verificado”.
- Prévia offline para avaliar o visual sem conectar qualquer conta.
- Aspas corrigidas nos dois `tmpfs` do agente e corretas no novo Compose do painel.
- Configuração preparada para os cabeçalhos de segurança no serviço público,
  incluindo as páginas internas. A ativação no Render ainda não foi realizada.

## Veja em um minuto

1. Abra `docs/painel-preview.html` no navegador.
2. Clique em Biblioteca, WhatsApp e Infraestrutura. No celular, abra o menu no topo.
3. Clique em “Ir para o login” (ou no ícone de saída no celular) para ver essa tela.
4. Use “Conhecer o visual do painel” para voltar. A prévia não autentica ninguém,
   não envia senhas, não consulta dados reais e não publica materiais.

## Validação executada

- 42 testes Node aprovados: 18 do novo acesso + 24 do site, ingestão e build.
- Quatro cenários no Chrome for Testing aprovados: navegação dos seis módulos,
  prévia offline, celular em 390/320 px sem rolagem lateral e fluxo visual de
  login/erro/saída. A saída do test runner conta também o teste pai (5/5).
- Conferência visual das imagens de computador, celular e login.
- Build real do site concluído: 0 matérias públicas e 6 localidades naquele
  momento. Arquivos do painel copiados para `dist-public/admin`; painel fora
  do sitemap. O código do AdSense e a lógica de consentimento foram preservados.
- YAML conferido: cada montagem tmpfs é uma única string com `mode=1777`.
  Docker/Compose e nginx não foram executados nesta máquina; exigem teste na VPS.

Saída dos testes: [PAINEL_M1_TESTES_2026_10_11.txt](PAINEL_M1_TESTES_2026_10_11.txt).
Nos testes de login, o servidor Node é real e as respostas do Supabase são
simuladas. No navegador, as respostas da API também são simuladas. Não houve
login com a conta real do dono, envio de e-mail, convite, chamada de IA ou envio
de WhatsApp/Instagram nesta entrega.

## Arquivos

- Interface: todos os arquivos de `public-site/admin/`.
- API e instalação: todos os arquivos de `panel-api/`, incluindo `.env.example`.
- Prévia: `scripts/build-panel-preview.mjs` e `docs/painel-preview.html`.
- Testes: `tests/panel-auth.test.mjs` e `tests/panel-ui.test.mjs`.
- Configuração preparada: `docs/render-public-site.yaml`, `public-site/_headers`
  e correção em `news-agent/docker-compose.yml`.
- Entrega: este documento e `docs/PAINEL_M1_TESTES_2026_10_11.txt`.

## O que ainda está pendente

O código está na branch de trabalho. Nada foi mesclado à branch de produção,
instalado na VPS ou alterado em DNS/Render/Supabase. Nenhuma tabela ou policy,
incluindo publicações e Radar, foi consultada ou modificada pelo painel. O build
consulta apenas a tabela de publicações com a chave anônima já existente.

Para ativar, será necessário confirmar a conta do dono, instalar somente a API
do painel, adicionar a rota ao nginx e publicar a interface com os cabeçalhos.
As instruções e os limites estão em [panel-api/README.md](../panel-api/README.md).
Essas mudanças em produção dependem de autorização específica do dono.

**Próximo passo:** obter a aprovação do visual e avançar para a Biblioteca de
Materiais. Uploads, integrações, métricas e monitoramento pertencem aos marcos
seguintes e ainda não estão operacionais.
