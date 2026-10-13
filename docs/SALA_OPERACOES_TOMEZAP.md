# Sala de operações — TomeZap

> Atualização posterior: a entrada de pautas e aprovação foi implementada no
> código. Para o estado atual e ativação, seguir
> [Correção de pautas e aprovação](CORRECAO_PAUTAS_APROVACAO_WHATSAPP.md).
> O relato abaixo descreve o marco anterior.

Entrega de 12/10/2026, horário de Fortaleza. **Código salvo e testado localmente;
instalação na VPS e publicação da nova versão ainda pendentes.**

## Para o dono

Abra `docs/redacao-visual-preview.html`. A sala abre direto no mapa, com seis mesas:
WhatsApp, apuração, Gemini, revisão, publicador e site. Toque em uma mesa para
entender seu papel. A prévia diz DEMONSTRAÇÃO: as animações são exemplos e não
significam que seu servidor está produzindo uma matéria.

Quando instalada, a mesma tela fica em `/admin/#operacao`, depois do login.
A atualização ocorre a cada 15 segundos enquanto a aba está visível. O dono e
editores autorizados podem observar. Não há botão para publicar ou reiniciar.

Verde confirma uma conexão, não o fluxo completo. Animação significa uma etapa
ativa informada pelo trabalhador. Cinza significa falta de confirmação. Ao
falhar a consulta, a tela descarta os estados anteriores em vez de continuar
mostrando um personagem trabalhando.

## Por que o primeiro pedido não publicou

Na branch inspecionada, a ponte aceita `STATUS`. Comandos de aprovação ainda
respondem que o módulo será ativado depois. Texto livre como “faça uma matéria”
não é convertido em pauta; o trabalhador separado começa por RSS.

A ponte também ignora mensagens enviadas pelo próprio número conectado.
Um editor autorizado deve falar no grupo escolhido. Isso explica uma possível
ausência de resposta, mas o teste específico não foi reproduzido nem teve sua
mensagem lida nesta sessão.

Na conferência de 12/10 às 20:55 de Fortaleza, o Supabase tinha as três tabelas
privadas e a função `tnn-drafts` instalada, porém **0 ciclos, 0 rascunhos e 0
publicações**. O painel `/admin/` respondeu HTTP 200; o `/healthz` público do
bot respondeu HTTP 502. Esse erro não permite concluir se a ponte está conectada,
pois pode ser um encaminhamento antigo do nginx. Não houve acesso SSH ao servidor.

O relato do Claude informa que faltam tokens de rascunhos. Esta sessão não leu
secrets da VPS nem confirmou o estado desses tokens. Não confundir função
instalada com função configurada e trabalhador ativo.

**Não marque “chip exclusivo” se o chip for seu número pessoal.** A implementação
não oficial tem risco de bloqueio; um chip dedicado continua sendo recomendado.

## Para que serve a VPS

- Manter a conexão WhatsApp persistente e a API de acesso privado.
- Executar o trabalhador Python e seu Redis privado quando configurados.
- Informar etapas e guardar a sessão criptografada.

Ela não substitui o site estático no Render nem o banco Supabase. No momento,
há evidência do painel respondendo e relato de pareamento; não há evidência de
produção de notícias nesta conferência.

## Integração implementada

`GET /painel-api/workflow`, somente após sessão e origem autorizadas:

- Lê `/status` da ponte pela rede privada, usando o token que já fica no servidor.
- Lê o contexto privado pela API `tnn-drafts` e seu token de leitura existente.
- Faz HEAD no site configurado, sem seguir redirecionamentos.
- Consulta apenas `id,title,slug,published_at` das publicações públicas via chave
  publishable/anon, limitado às cinco recentes. Não consulta tabelas do Radar.
- Filtra campos, horários, estados e códigos; não devolve telefone, grupo ID,
  credenciais, QR Code, corpo bruto de erro ou texto integral de fontes.
- Compartilha consultas concorrentes e guarda o resultado por dez segundos.
- Não tem operações de geração, mensagem, ingestão, aprovação ou rebuild.

O trabalhador agora informa as etapas `coleta`, `redacao`, `rascunho` e `previa`.
A ponte registra um histórico curto de códigos fixos, preservado no cofre da
sessão. A sala lê até doze eventos; isso não é um histórico editorial completo.
Falha da telemetria opcional não descarta um rascunho completo.

O momento de publicar continua bloqueado. A presença de um registro de publicação
no banco é mostrada como **banco**, nunca como confirmação do deploy de uma URL.
Não há verificação artigo-a-artigo neste marco.

## Ativação: precisa de acesso ao servidor

1. Conferir checkout/commit e alterações locais na VPS; não sobrescrever ajustes
   feitos pelo Claude. Preservar `.env`, sessões, volumes e nginx.
2. Incorporar apenas estes arquivos na instalação do projeto. Nenhuma migration
   nova é necessária, nem alteração nas policies das publicações.
3. Validar a configuração existente dos tokens de leitura, redação e ponte,
   sem imprimir os valores. Confirmar chip e grupo reais antes de qualquer envio.
4. Recompilar `painel-api`, `whatsapp` e `redacao` usando os overlays documentados
   em `ROBO_WHATSAPP_MARCO_2.md`. Nunca subir o trabalhador publicador legado.
5. **Antes de recriar/reiniciar serviços existentes, mostrar o impacto e obter
   confirmação do dono.** Não executar `down -v`, não alterar DNS e não trocar
   configuração global de nginx. `api.`, `chat.`, `whats.` e Radar ficam intactos.
6. Conferir GET autenticado `/painel-api/workflow`: visitante 401, origem alheia
   403, POST 405. Só depois incorporar o frontend na produção do Render,
   preservando mudanças posteriores e o build `node scripts/build-public-site.mjs`.
7. No painel, abrir Redação ao vivo e comparar o estado de WhatsApp, rascunhos e
   passos com os registros do servidor. Se o ciclo não estiver ativo, mostrar
   seu bloqueio — não marcar a integração como completa.

Próximos trabalhos separados: entrada de pauta manual, aprovação/rejeição no
grupo, ingestão/rebuild e conferência da URL pública. Nenhum deles é liberado
apenas por instalar o monitor.

## Testes realizados

- **95 testes Node passaram**, sem falhas ou skips: API, acesso, publicação
  bloqueada, ponte, segurança, SSG, monitor e DOM virtual. Inclui Postgres local
  PGlite com SQL real, RLS e transações.
- **52 testes Python passaram**, com mocks de APIs externas e Redis em memória
  com Lua real. Inclui ordem das etapas e falha da telemetria opcional.
- Build público concluído: 0 matérias e 6 localidades. O painel e assets novos
  foram copiados; rascunhos continuam fora do sitemap e AdSense preservado.
- Sintaxe Node e Python conferida. Nenhuma dependência de produção nova.

O DOM virtual testa interação e timers, **não renderiza pixels nem comprova
layout no navegador/celular**. A conferência visual renderizada ficou pendente:
não havia navegador de testes disponível neste ambiente. CSS tem regras para
celular e movimento reduzido, mas isso não equivale a teste visual concluído.

Não houve chamada autenticada ao Gemini, envio real de WhatsApp, publicação,
rebuild remoto, alteração de Supabase ou reinício de VPS nesta entrega. O teste
real “pedido → prévia → APROVAR → notícia no ar” permanece pendente.

## Arquivos desta entrega

- `panel-api/workflow.mjs` (novo), `server.mjs`, `Dockerfile`.
- `public-site/admin/operations.mjs`, `operations.css` (novos).
- `public-site/admin/shell.mjs`, `app.mjs`, `index.html`, `preview.html`.
- `whatsapp-bridge/controller.mjs`.
- `news-agent/tnn/autonomous/pipeline.py`.
- `scripts/build-panel-preview.mjs`.
- `docs/painel-preview.html`, `docs/redacao-visual-preview.html` (nova).
- `tests/workflow.test.mjs` (novo), `tests/whatsapp-bridge.test.mjs`.
- `news-agent/tests/test_autonomous.py`.
- Este relatório.
