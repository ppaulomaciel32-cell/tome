# Correção de mensagens do dono e produção manual

Atualização: 13/10/2026. Branch: `feat/tomezap-robo-whatsapp`.

**Código implementado; ativação na VPS e teste real ainda pendentes.**
A tentativa SSH desta sessão retornou `Network is unreachable`. Nenhum serviço
foi reiniciado, nenhuma mensagem real foi enviada e nenhuma notícia foi publicada.
Este documento substitui as limitações sobre pauta manual/aprovação descritas
nos relatórios anteriores; aqueles relatórios registram os marcos anteriores.

## O que muda para o dono

No grupo confirmado, o dono pode mandar uma pauta pelo próprio número conectado,
e a namorada continua autorizada. Uma mensagem de texto com 20–4000 caracteres
entra na fila; também são aceitos os prefixos `PAUTA:` e `MANCHETE:`. As próprias
respostas do robô são filtradas para evitar um ciclo infinito de respostas.

O trabalhador busca confirmação nas fontes aprovadas, redige com Gemini e salva
um rascunho privado. Envia título, resumo, fontes, ID e link para ler o texto.
Depois da leitura, o dono ou a namorada responde `APROVAR #ID`, substituindo ID
pelo UUID completo mostrado. `REJEITAR #ID` descarta a proposta da fila de revisão.
Nenhuma pauta é publicada somente porque contém “poste no site”.

A aprovação grava a notícia completa e a decisão na mesma transação. O rebuild
é solicitado depois. “No ar” só é enviado após conferir a página individual e
sua marca de revisão; receber um registro no banco não basta. Se o deploy demorar,
o estado fica pendente e o trabalhador verifica novamente.

## O que já foi instalado no Supabase

Projeto `dfbeerxqqfqkwlljrjko`:

- Migration aplicada: `20261013010357_manual_editorial_approval`.
- `tnn-editorial` implantada, versão 1; `tnn-drafts` atualizada, versão 3.
- Tabela privada de aprovações, view privada de pendências e funções transacionais.
- Verificados RLS/grants: visitante e usuário autenticado comum não leem a tabela
  nem executam as funções privadas. A view usa `security_invoker` e grants restritos.
- As políticas existentes das publicações não foram alteradas. Radar não foi acessado.
- A função editorial ainda aguarda configuração dos novos segredos; a consulta
  pública retornou HTTP 503 `awaiting_configuration`. Isso não significa ativação.

**Não reaplicar essa migration nem executar `supabase db push` indiscriminadamente.**
Conferir o histórico remoto antes de qualquer mudança adicional.

## Roteiro de ativação para o operador com SSH

1. Conectar pela sessão SSH autorizada da VPS Contabo. Confirmar servidor,
   diretório e projeto Compose existentes. Ler instruções locais, comparar o
   checkout com esta branch e preservar mudanças do Claude, `.env`, volumes e
   `/opt/tome-news/sessao-wa`. Não sobrescrever uma instalação por suposição.
2. Incorporar o código desta branch em checkout isolado e revisar o diff.
   Preservar `api.`, `chat.`, `whats.` e Radar. Não mudar DNS/nginx para esta correção.
3. Criar dois segredos aleatórios exclusivos de 64 caracteres hexadecimais,
   gravados diretamente nos ambientes privados, sem imprimir/copiar em chat:
   `TNN_EDITORIAL_SIGNING_KEY` e `TNN_EDITORIAL_TOKEN`. Não reutilizar tokens de
   rascunhos, painel, ponte ou credenciais antigas compartilhadas no chat.
4. Configurar nos secrets da Edge: os dois segredos acima,
   `TNN_MANUAL_ENABLED=true`, `TNN_SITE_URL=https://tomezap.com.br` e
   `TNN_SITE_REBUILD_HOOK` com o deploy hook real do site público no Render.
   Preservar os tokens de leitura/escrita existentes. O hook deve corresponder
   ao serviço público, nunca ao Radar. Não exibir o URL secreto em logs.
5. No ambiente privado da ponte (`whatsapp-bridge/.env`), configurar
   `WA_ACCEPT_OWN_COMMANDS=true`, `WA_MANUAL_ENABLED=true` e a mesma
   `TNN_EDITORIAL_SIGNING_KEY` da Edge. Preservar a namorada em
   `WA_ALLOWED_SENDERS`; não adicionar o número conectado a essa lista.
   O dono é reconhecido pelo indicador autenticado `fromMe`, só no grupo confirmado.
   Preservar sessão, tokens e grupo. Não exigir novo QR sem necessidade e não
   marcar uma declaração de chip exclusivo se o número for pessoal.
6. No trabalhador (`news-agent/.env.autonomous`), configurar
   `MANUAL_ENABLED=true`, `TNN_EDITORIAL_TOKEN` igual ao da Edge e
   `TNN_EDITORIAL_URL=https://dfbeerxqqfqkwlljrjko.supabase.co/functions/v1/tnn-editorial`.
   **Não colocar a chave de assinatura nem service_role no trabalhador.**
   O token de escrita de rascunhos não autoriza publicação. A aprovação exige
   uma assinatura emitida pela ponte após uma mensagem de editor autorizado.
7. Conferir os tokens existentes de rascunhos/painel/pipeline, Redis privado,
   chave Gemini e modelo disponível na conta. Confirmar plano gratuito antes de
   marcar `GEMINI_FREE_TIER_CONFIRMED=true`; não habilitar cobrança. Aprovar e
   testar fontes de pelo menos duas organizações independentes no arquivo real
   `autonomous-sources.json`. Tavily é opcional. `AUTONOMOUS_ENABLED` pode continuar
   false: a pauta manual não depende do ciclo automático de 20 minutos.
8. Dentro de `panel-api`, validar e construir sem reiniciar serviços:

   ```bash
   docker compose --env-file ../news-agent/.env.autonomous -f docker-compose.yml -f docker-compose.whatsapp.yml -f docker-compose.redacao.yml config --quiet
   docker compose --env-file ../news-agent/.env.autonomous -f docker-compose.yml -f docker-compose.whatsapp.yml -f docker-compose.redacao.yml build painel-api whatsapp redacao
   ```

9. Mostrar ao dono os serviços que precisam ser recriados e o breve impacto no
   WhatsApp; obter confirmação antes do reinício, conforme sua regra. Depois,
   atualizar somente `painel-api`, `whatsapp`, `redacao-redis` e `redacao` no
   projeto Compose existente. Não usar `down -v`, não limpar sessão/Redis e não
   subir o trabalhador publicador legado. Se Redis já estiver saudável e sem
   mudança, preservá-lo sem recriação desnecessária.
10. Incorporar o frontend na branch que realmente publica no Render após comparar
    diffs, preservando trabalhos posteriores. Manter build
    `node scripts/build-public-site.mjs`, pasta `dist-public` e domínio
    `https://tomezap.com.br`. Não publicar o `render.yaml` da raiz, que é de outro
    sistema. A sala `/admin/#operacao` informa trabalhador, capacidades e bloqueios.

## Teste real obrigatório, acompanhado pelo dono

Confirmar primeiro o grupo correto. Pedir ao dono para enviar uma pauta real sobre
o Pecém, com links das fontes aprovadas quando disponíveis. Conferir:

1. Mensagem do dono recebe confirmação de entrada; repetir a mesma mensagem
   transportada não duplica o trabalho. Mensagem da namorada também é aceita.
2. Respostas do bot não geram novas pautas; outros grupos/remetentes não entram.
3. Com duas fontes independentes, nasce um rascunho privado e chega a prévia.
   Fonte insuficiente gera explicação e não produz notícia. Texto do WhatsApp
   sozinho não conta como prova dos fatos.
4. O link privado abre o texto completo para o dono/editor. Antes de aprovar,
   a notícia não aparece publicamente.
5. Após `APROVAR #UUID`, conferir a decisão, publicação completa, rebuild e URL
   individual. Só encerrar quando a matéria aparecer também em `/#ultimas`.
6. Repetir a aprovação não cria outra notícia. Testar rejeição com outro rascunho
   e confirmar que ele não é publicado.
7. Comparar os estados reais com a sala de operações. Não declarar o fluxo ativo
   apenas porque o QR, um healthcheck ou um teste simulado funcionou.

## Limites desta correção

- Legenda de imagem entra como pauta; a imagem enviada ainda não vira capa neste
  módulo QR. Usa-se a capa padrão da marca, informada na prévia.
- Áudio, edição por comando, Stories e Reels não foram acrescentados nesta entrega.
- A seleção de fontes exige data real e domínios previamente aprovados. Na pauta
  manual, aceita até sete dias; páginas fora da regra podem ser recusadas.
- Não há garantia de prazo de 90 segundos. Cotas, apuração e rebuild podem atrasar.
- A sala tem demonstração separada e identificada. O teste de DOM não substitui
  inspeção visual no navegador/celular. Essa inspeção e o teste real seguem pendentes.

## Verificação de código

Na implementação foram concluídos 105 testes Node e 64 testes Python, sem falhas
ou skips: remetentes, anti-loop, fila/leases, prova de aprovação, publicação
atômica, repetição, rejeição, RLS, fontes, geração única e confirmação de URL.
APIs externas e WhatsApp foram simulados; SQL foi exercitado em Postgres local
PGlite. Nenhuma nova dependência de produção foi adicionada. Build do site:
0 matérias e 6 localidades. AdSense preservado.

Arquivos principais: `whatsapp-bridge/manual.mjs`, controller/server/vault;
`news-agent/tnn/autonomous/manual.py`, worker/config/clients/collection;
`supabase/functions/tnn-editorial`, `tnn-drafts`, migration de aprovação;
`panel-api/workflow.mjs`, server; módulos do painel e prévias em `docs`;
exemplos de ambiente e testes correspondentes.
