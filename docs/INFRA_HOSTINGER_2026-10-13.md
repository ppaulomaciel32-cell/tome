# Hostinger: estado informado e correções de código

Atualizado em 13/10/2026. **Claude cuida da VPS, DNS e Render; Codex cuida do código.**
Este documento tem prioridade sobre os endereços e as instruções de deploy dos
relatórios anteriores. As informações da infraestrutura abaixo foram fornecidas
pelo dono/Claude; não representam uma inspeção desta sessão no servidor.

## Infraestrutura atual

- VPS: `srv2059750.hstgr.cloud`, `191.215.47.101`, Hostinger KVM 1, 1 vCPU/4 GB,
  Ubuntu 26.04, swap 2 GB, fuso America/Fortaleza. Validade informada: 13/11/2026.
- Projeto em `/opt/tomezap-robo`, branch `feat/tomezap-robo-whatsapp`, versão
  informada em execução `20f3e77`. Compose `tomezap-painel`; atalho
  `/root/tomezap-compose.sh` já inclui os três arquivos e o ambiente.
- Serviços informados saudáveis: `painel-api`, `whatsapp`, `redacao`, `redacao-redis`.
- Sessão WhatsApp: `/opt/tome-news/sessao-wa`, UID/GID 1000:1000; backup diário
  às 03:47, somente na própria VPS.
- nginx `tomezap-bot`: `/painel-api/`, `/conectar` e `/conectar/` para
  `127.0.0.1:18081`. Outros caminhos retornam 404. HTTPS Let's Encrypt com renovação.
- `bot.tomezap.com.br` aponta para a VPS nova. Não existe `/healthz` público,
  `/webhook` Meta nem `/preview/`. Os healthchecks Docker são internos;
  use o painel autenticado para conferir os componentes.
- Site público no Render: `tomezap.com.br`; raiz `216.24.57.1`, www
  `tome-nota-publico.onrender.com`. Serviço `tome-nota-publico` publica esta mesma
  branch, com deploy manual. Não trocar para `public-site-github-supabase`.
- Contabo antiga `169.58.169.224` inacessível: **não tentar SSH nela** nem depender
  dos seus arquivos. `api.`, `chat.`, `whats.` continuam apontados para lá,
  informados pelo dono como sistemas sem uso; não alterar esses apontamentos.

## Bloqueios de ativação informados

WhatsApp ainda `idle`, grupo não confirmado, Gemini sem chave, zero rascunhos e
zero publicações. Serviços saudáveis não significam fluxo editorial ativo.

Todos os segredos da VPS foram recriados. O dono/Claude precisa sincronizar no
Supabase, diretamente no ambiente seguro:

- `TNN_DRAFT_SERVICE_TOKEN`, `TNN_DRAFT_READER_TOKEN`;
- `TNN_EDITORIAL_TOKEN`, `TNN_EDITORIAL_SIGNING_KEY`;
- `TNN_MANUAL_ENABLED=true`, `TNN_SITE_URL=https://tomezap.com.br`;
- `TNN_SITE_REBUILD_HOOK`, do site público real no Render.

Não colar chaves em chat/log. Preservar a separação de segredos documentada na
[correção de pautas](CORRECAO_PAUTAS_APROVACAO_WHATSAPP.md). Assinatura editorial
fica só na ponte e na Edge; nunca no trabalhador Python ou navegador. O relato
atual é `tnn-drafts` 401 e `tnn-editorial` 503 enquanto isso não for resolvido.
**Não reaplicar migrations.**

As flags de entrada manual, mensagens do dono e ciclo automático já foram
ativadas na VPS. A aprovação humana continua obrigatória. Foram informadas
nove fontes RSS aprovadas de oito organizações; não substituí-las pelo exemplo.

## Correções deste commit

### Número brasileiro

O código compara o formato atual com nono dígito e o formato antigo do mesmo
celular brasileiro. A regra exige DDI 55, DDD válido e faixa móvel antiga 6–9.
Não remove dígitos de telefones fixos, de outros países, de LIDs ou de grupos.
Aplica-se à conferência do chip, aos participantes autenticados, à whitelist e à
deduplicação. O mesmo editor em duas grafias não vira duas autorizações.

O contorno atual da VPS (números sem 9) continua funcionando. Não é necessário
editar os números para instalar; pode-se usar o formato completo depois de
conferir cada contato. Não acrescentar o número conectado à whitelist: mensagens
do dono são reconhecidas por `fromMe` e `WA_ACCEPT_OWN_COMMANDS=true`.

A tela de conexão passa a pedir autorização para conectar o número e ciência do
risco de bloqueio, inclusive quando pessoal. Mantém a recomendação de chip
dedicado. Não exige uma declaração falsa de exclusividade. O número conectado
ainda precisa corresponder ao configurado e o grupo continua restrito.

### Login persistente

Novo cofre local AES-256-GCM com escrita atômica e sincronização em disco. O
Compose monta o volume `painel_sessoes` em `/data/panel-sessions`; no projeto
atual, o nome padrão é `tomezap-painel_painel_sessoes`. O diretório tem permissão
0700; a chave gerada automaticamente e o arquivo criptografado, 0600. O Dockerfile
prepara o diretório para o usuário `node` (UID 1000).

Nenhuma nova chave precisa ser colada manualmente e nenhuma dependência nova
foi adicionada. Preservar **a chave e o arquivo juntos** no volume; jamais commitar
ou imprimir o conteúdo. Rodar apenas uma instância de `painel-api` para este
cofre: ele não é um armazenamento compartilhado para múltiplas réplicas.

Após a primeira atualização, faça login novamente: sessões antigas em memória
não podem ser recuperadas. Os próximos logins resistem à recriação com o mesmo
volume. Mantêm 30 minutos sem uso e oito horas de duração máxima; logout e
revalidação no Supabase continuam obrigatórios. Não promete login permanente.
Arquivo adulterado, chave perdida ou erro de gravação bloqueiam acesso com erro
controlado, preservando os dados para diagnóstico.

## Aplicação pelo Claude, sem alterar outros serviços

1. Comparar checkout e alterações locais antes de incorporar a branch. Preservar
   ambientes, fontes, sessão WhatsApp, Redis e as adaptações do nginx da Hostinger.
2. Conferir o diff de `panel-api/docker-compose.yml` e `Dockerfile`: novo volume
   privado para login, sem porta ou serviço adicional. Manter nome do projeto.
   Validar a configuração com `config --quiet`, sem imprimir os ambientes.
3. Construir somente `painel-api` e `whatsapp`. A regra do dono exige confirmação
   antes de recriar/reiniciar serviços existentes: mostrar o impacto concreto e
   aguardar. Não executar `down -v` nem apagar volumes/chaves.
4. Com autorização, recriar esses dois serviços usando o atalho existente.
   Redação e Redis não precisam ser reiniciados por este commit. Não fazer deploy
   no Render por esta correção: os arquivos executáveis alterados são da VPS.
   A prévia em `docs` é somente um artefato de conferência, não o frontend público.
5. Entrar no painel, conferir a tela de autorização, parear o número correto e
   confirmar o grupo. Não apagar uma sessão nem limpar bloqueios persistidos para
   forçar pareamento; se aparecer `wrong_number` antigo, revisar a identidade
   primeiro e tratar especificamente com o dono.
6. Validar o login após uma recriação controlada do painel com autorização. Fazer
   dentro de 30 minutos, usando o mesmo navegador e volume. Não confundir expiração
   normal, logout, perda de volume ou credencial revogada com o defeito corrigido.
7. Depois de sincronizar secrets e configurar Gemini gratuito, testar mensagem
   do dono e da namorada, rascunho, leitura, `APROVAR #ID`, rebuild e URL real.
   Como o Render usa deploy manual, conferir se o deploy hook explícito conclui
   o rebuild quando a aprovação o chama; falha deve continuar como pendência.

## Verificação desta entrega

63 testes locais passaram, sem falhas ou skips, abrangendo autenticação HTTP,
ponte WhatsApp e novo cofre. Incluem leitura da sessão por outro processo Node,
rotação de token com requisições simultâneas, logout após reinício, expiração,
conta revogada, arquivo adulterado, chave perdida e falha de escrita. Números
brasileiros foram testados nos dois sentidos, preservando bloqueio de intrusos.

Supabase Auth e WhatsApp foram simulados nesses testes. Não houve pareamento,
mensagem real, consulta ao banco, migration, mudança de secrets, SSH, DNS,
reinício, rebuild Render ou publicação nesta sessão. Docker e navegador de
testes não estão disponíveis aqui: instalação do volume na VPS e teste visual
renderizado ficam com o Claude. O teste de interface foi atualizado para a nova
confirmação, mas não deve ser anunciado como executado.
