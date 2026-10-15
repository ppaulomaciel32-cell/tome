# Pendências do TomeZap — entrega e instalação

Branch: `feat/tomezap-robo-whatsapp`, base auditada `3f386ca` (posterior a `52f941f`).
Não altera Radar, suas tabelas, `radar-coletor`, DNS ou a abertura da home.

## Estado honesto de cada item

| Item | Entrega | O que falta para funcionar na conta real |
|---|---|---|
| A1 | Tavily agora descobre domínios fora dos feeds cadastrados; aceita fonte oficial única e mantém deduplicação e cotas | Chave gratuita na VPS e confirmação do plano gratuito |
| A2 | GA4 já existia, com consentimento `all`, exclusão do admin e limpeza de dados privados da URL | `GA4_MEASUREMENT_ID` no Render e Manual Deploy |
| A3 | Relatório privado por matéria, localidade e origem já existia; acrescentado ranking agregado público | Conta de serviço somente Leitor na propriedade GA4; credencial só no servidor |
| A4 | Slots configuráveis e Auto Ads já existiam; preservados publisher e consentimento | Aprovação do Google e IDs reais dos blocos, informados no Render |
| A5/B2 | Monitor próprio de páginas oficiais, referência inicial, comparação, alerta no grupo e proposta de rascunho | Montar e habilitar a lista de URLs oficiais na VPS; não depende de n8n ou e-mail |
| B3 | Descoberta de documentos e modo investigativo: título `A apurar:`, documentação separada de perguntas | Conferência humana dos documentos e das partes citadas; não é prova automática de irregularidade |
| B4 | Edição direta de título, resumo, texto e localidade do rascunho, sem chamar Gemini | Instalar API/ponte/trabalhador e publicar o frontend |
| B5 | Foto de capa enviada no rascunho pelo painel, crédito obrigatório, transporte privado | Mesma instalação; nginx precisa aceitar o tamanho do formulário |
| B6 | Crédito copiado do rascunho para a publicação e exibido na matéria/Stories | Migration já aplicada; fazer deploy do site |
| B7 | Aprovar e agendar no painel ou `AGENDAR 12 2026-10-17 07:00`; cancelar no painel ou `CANCELAR 12` | Instalar ponte/trabalhador; horário sempre Fortaleza |
| B8 | Resumo diário no grupo, fila e aprovadas do dia; ranking dos últimos 30 dias quando disponível | Habilitar resumo na VPS; GA4 para ranking |
| B9 | Seção Mais lidas de verdade, baseada no GA4 e apenas em publicações públicas | Credenciais A3; sem dados suficientes, não aparece nem substitui Destaques por ranking inventado |
| B10 | Template existente reutilizado: PNG 1080×1920, menos de 1,5 MB, capa própria, crédito e marca, enviado após confirmar a matéria no ar | Instalar ponte/trabalhador e testar uma aprovação real |

Edição aqui é do **rascunho antes da aprovação**. As mudanças geram outro rascunho, retiram o anterior e exigem nova aprovação. Não implementa reescrita silenciosa de matéria publicada.

## Supabase: já feito por Codex em 15/10/2026

- Migration **`20261015151014_editorial_photo_credit`** aplicada e registrada.
  O arquivo local foi alinhado à versão que o Supabase atribuiu. **Não reaplicar.**
  Adiciona somente `tomenota_publications.cover_credit`, trigger restrito que copia
  `rascunhos.capa_credito` e preenchimento dos créditos existentes quando houver vínculo.
- RLS de publicações conferida antes/depois, sem alteração:
  `status = 'published' AND published_at <= now()`, leitura para anon/authenticated.
- `tnn-editorial` publicada, **versão 3**, preservando autenticação e aprovação HMAC.
  Horário agendado faz parte da assinatura; remover ou antecipar esse horário invalida a prova.
- `tnn-drafts` **versão 6** já coincide com o handler do repositório; não foi republicada.
- Nenhum segredo novo é exigido na Edge. Não rodar `supabase db push` de todo o histórico.

## Claude: instalação na VPS Hostinger

Servidor: `191.215.47.101`, repositório `/opt/tomezap-robo`.
Não tentar a Contabo; não recriar sessões nem volumes.

1. Conferir `git status --short`, executar `git fetch origin` e comparar o HEAD com a
   branch remota. Preservar alterações locais. Se estiver limpo e atrás, usar
   `git merge --ff-only origin/feat/tomezap-robo-whatsapp`. Nunca reset/force-push.
2. Fazer backup consistente da sessão e da fila pelo procedimento existente,
   incluindo a base criptografada da ponte: ela guarda os agendamentos aprovados.
   Confirmar que os backups podem ser restaurados. Backup somente na mesma VPS
   não protege contra perda do servidor.
3. Manter `.env` e sessão atuais. Acrescentar configurações pelos nomes abaixo,
   sem imprimir os valores nem compartilhá-los em chat, commit ou log.
4. Para o monitor, copiar `news-agent/monitors.example.json` para um arquivo privado
   de configuração, conferir os endereços oficiais e marcar somente os aprovados.
   Os exemplos ficam desligados de propósito; a primeira consulta cria a referência.
   Montar o arquivo somente leitura em `/app/config/monitors.json`, no serviço `redacao`.
   Definir `TNN_MONITORS_FILE=/app/config/monitors.json` no `.env.autonomous`.
   Pode aproveitar as seis URLs já conferidas no changedetection.io. Este código
   não acessa nem altera aquele serviço ou as tabelas do Radar.
5. Ajustar **apenas** o nginx de `bot.tomezap.com.br`: dentro da localização já
   existente `/painel-api/`, permitir `client_max_body_size 30m;` e tempo de envio
   compatível com upload de 20 MB. Manter destino `127.0.0.1:18081`, cabeçalhos
   seguros, TLS e portas privadas. Rodar `nginx -t` antes de qualquer reload.
   Mostrar o diff ao dono e obter confirmação antes de alterar/recarregar produção.
6. Preparar as imagens sem interromper serviços:

   ```sh
   /root/tomezap-compose.sh config --quiet
   /root/tomezap-compose.sh build painel-api whatsapp redacao
   ```

   Depois de mostrar o diff e obter confirmação para recriar esses três processos:

   ```sh
   /root/tomezap-compose.sh up -d --no-deps painel-api whatsapp redacao
   /root/tomezap-compose.sh ps
   ```

   O atalho já deve incluir os três arquivos Compose e o `--env-file` da instalação.
   Não usar `down`, `down -v`, remover sessão, abrir Redis na internet ou reiniciar
   os outros serviços. Confirmar reconexão sem novo QR e recuperação dos agendamentos.
7. Os novos endpoints usam a mesma rota `/painel-api/`: não exigem DNS novo.
   `/popular` expõe somente ranking agregado; `/analytics`, edição, fotos e decisões
   continuam exigindo sessão autorizada e, nas mutações, CSRF.

### Variáveis — somente nomes, valores privados na VPS

- Trabalhador: `TAVILY_API_KEY`, `TAVILY_FREE_TIER_CONFIRMED`,
  `TAVILY_MAX_CALLS_PER_DAY`, `TAVILY_MAX_CALLS_PER_MONTH`,
  `TNN_MONITORS_FILE`, `TNN_DAILY_SUMMARY_ENABLED`, `TNN_DAILY_SUMMARY_HOUR`.
- Painel/API: `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_EMAIL`, `GA4_PRIVATE_KEY`.
- Preservar todos os tokens exclusivos existentes, incluindo `WA_PIPELINE_TOKEN`,
  `TNN_EDITORIAL_TOKEN`, `TNN_EDITORIAL_SIGNING_KEY`, tokens de rascunho e segredo Redis.
- Continuar com `AGENTE_REQUER_APROVACAO=true` e as autorizações do grupo existentes.

Sugestão de operação: 20 chamadas Tavily/dia e 600/mês (tetos locais 30/900).
A documentação do Tavily em 15/10 informa 1.000 créditos gratuitos/mês;
busca `basic` custa 1 crédito. Não habilitar pay-as-you-go. Outras aplicações
que usam a mesma chave também consomem essa franquia; usar projeto/chave dedicada.
Uma matéria normalmente consome 1 chamada Gemini; correção por IA acrescenta 1.
Edição direta, troca exata de manchete, capa gráfica e Stories não usam LLM.
Falhas de geração reservadas também contam na cota local. Não aumentar plano
para contornar limite do provedor. 40 chamadas/dia já deixam margem para 17
redações e correções; a capacidade real depende da cota gratuita da conta.

Agendamentos ficam no cofre persistente da ponte, com limite total da fila
de 30 pedidos e até 30 dias de antecedência. Exigem processo ligado; se voltar
depois do horário, publica atrasado. Cancelar antes da execução devolve o texto
à revisão. A assinatura impede o trabalhador de publicar antes do horário.

## Render: configuração do dono e deploy

Serviço existente `tome-nota-publico`, branch `feat/tomezap-robo-whatsapp`, build
`node scripts/build-public-site.mjs`, diretório `dist-public`. Não aplicar o
`render.yaml` da raiz, não alterar plano ou domínio.

Variáveis públicas novas ou ainda não preenchidas:
`GA4_MEASUREMENT_ID`, `ADSENSE_SLOT_TOP`, `ADSENSE_SLOT_MIDDLE`,
`ADSENSE_SLOT_END`, `ADSENSE_SLOT_HOME`, `ADSENSE_AUTO_ADS`.
Preservar `ADSENSE_CLIENT=ca-pub-2000164835494228`.

Usar Manual Deploy → Deploy latest commit se não houver deploy automático
já em andamento. Conferir o SHA e o estado live. ID de medição não é a chave
privada do Google. Nunca colocar `GA4_PRIVATE_KEY` ou service_role no Render
do site estático. As páginas legais e o consentimento continuam preservados.

### Contas externas — passos do dono

1. Tavily: criar chave no plano gratuito, sem cartão/cobrança, e instalá-la no
   `.env.autonomous` pelo canal privado do servidor.
2. GA4: criar propriedade e fluxo web de `https://tomezap.com.br`, obter `G-…`
   e o ID numérico da propriedade. No projeto Google, habilitar Analytics Data
   API e criar conta de serviço; dar a ela somente papel Leitor nessa propriedade.
   Chave privada somente no painel/API da VPS. Pode haver atraso no relatório;
   não confundir visualizações com visitantes únicos.
3. AdSense: confirmar domínio/conta aprovados e criar os blocos para os quatro
   espaços; copiar IDs para as variáveis. Auto Ads é opcional e também aguarda
   aprovação e consentimento. Google não estabelece número mínimo fixo de
   matérias no requisito de qualificação: 15 ou 20 matérias não garantem aprovação.
   Conferir conteúdo próprio e útil, navegação, páginas institucionais e um canal
   de contato real. IA não dispensa revisão, atribuição de fontes e direitos
   sobre fotos; conteúdo copiado ou produção em massa sem valor não atende a isso.
4. Imagens: nenhuma conta nova. O código usa o armazenamento já contratado da
   VPS, mantendo original até 4K e versões leves, sem EXIF/GPS. Acompanhar espaço
   livre e incluir imagens nos backups; não há promessa de armazenamento ilimitado.

## Teste de aceitação real — não realizado nesta sessão

1. No painel, abrir um rascunho, editar uma frase e salvar: chegar outra prévia,
   sem publicar. Conferir que as palavras foram mantidas exatamente.
2. Mandar uma foto própria com crédito pelo painel. Conferir capa e crédito na
   nova prévia. Aprovar o texto final no grupo; aguardar link, crédito no site
   e PNG de Stories no mesmo grupo. Abrir a arte no celular, sem zoom.
3. Agendar outro rascunho para daqui a 3 minutos: não deve sair antes. Cancelar
   um agendamento separado e verificar que volta para revisão.
4. Ativar monitor com URL oficial, fazer primeira leitura como referência;
   usar fixture local para simular mudança antes de aguardar publicação oficial.
   Uma atualização real deve gerar um alerta e uma proposta, nunca autopublicar.
5. Após instalar GA4, aceitar cookies no site e verificar Realtime. Com “Só
   essenciais”, nenhum GA4/AdSense deve ser carregado. Mais lidas só aparece
   quando houver pelo menos duas matérias com leituras reais.

## Verificação executada

- Python: **89 testes passaram**; arte PNG validada em 1080×1920 e abaixo de 1,5 MB.
- Node, com Postgres local PGlite: **215 passaram, 3 ignorados e 3 bloqueados**
  por falta do executável Chromium neste ambiente. Não chamar a suíte inteira
  de aprovada: os testes de navegador de drafts/painel/WhatsApp ainda precisam
  rodar num ambiente com Playwright Chromium instalado.
- Os testes novos de fila, horário assinado, edição, upload, cancelamento,
  resumo, monitor, Stories, ranking agregado e RLS passaram. Testes SQL foram
  executados em Postgres local; não inseriram notícia de teste na produção.
- A função `tnn-drafts` ativa foi comparada byte a byte com o handler do repo.
- Home `public-site/index.html` e animação `motion.js` sem alterações nesta entrega.
- Nenhuma publicação real ou mensagem real ao grupo foi enviada nesta sessão.

Fontes técnicas consultadas: [Tavily](https://docs.tavily.com/documentation/api-credits),
[GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart),
[requisitos AdSense](https://support.google.com/adsense/answer/9724?hl=pt-BR).
