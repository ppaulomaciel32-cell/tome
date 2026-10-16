# Entrega de 13/10/2026 (Claude) — fonte única, fotos, anúncios e medição

Commits do Claude sobre `c92f2e0`, integrados por merge ao `c335910` do Codex na
branch `feat/tomezap-robo-whatsapp`. A VPS Hostinger rodava `023e8db` (sem o
`c335910`) no momento do merge.

## O que mudou

1. **Fonte única.** Pauta manual e ciclo automático aceitam uma só fonte quando
   ela é oficial (`"official": true` em `autonomous-sources.json`, ou link de
   domínio `.gov.br`, `.leg.br`, `.jus.br`, `.mp.br`, `.def.br` colado pelo
   editor) ou quando o editor cola o texto completo (400+ caracteres). Texto de
   150 a 500 palavras, sempre atribuído. Portal comercial sozinho continua
   sendo fonte fraca.
2. **Grupo.** Prévia numerada: `APROVAR 12`, `REJEITAR 12`, ou frases inteiras
   como "pode publicar" quando há um só rascunho aberto. A assinatura continua
   sendo feita sobre o UUID guardado na ponte.
3. **Ciclo automático.** Tenta até quatro candidatas por rodada e não avisa o
   grupo a cada pauta fraca.
4. **Evidências.** O trecho pode vir do título da fonte e é reduzido à parte
   literal. Antes, rascunhos corretos caíam em `write_failed`.
5. **Fotos.** Foto (ou documento de imagem) com a pauta na legenda vira capa.
   `Foto: nome` na legenda vira o crédito. Original guardado em até 4K;
   versões do site em 1600x900 JPEG e 800x450 WebP, sem EXIF. Sem foto, capa
   gráfica com manchete e localidade.
6. **Site.** `srcset` para as capas próprias. Anúncios por build e GA4 com
   consentimento ficaram com a implementação do Codex (`c335910`), integrada
   por merge; a versão do Claude para esses dois itens foi descartada.

## Banco (já aplicado em produção)

- `20261013230000_single_source_drafts.sql`
- `20261013233000_draft_covers.sql`

## Função Edge

- `tnn-drafts`: `handler.mjs` novo precisa de **Deploy** no painel do Supabase.
  Sonda sem efeito na VPS: `docker exec -i -w /app <redacao> python - < /root/tomezap-sonda-funcao.py`
  (HTTP 400 = versão antiga; 503 = versão nova no ar).
- `tnn-editorial`: sem mudança de código (a capa vem da RPC).

## VPS

- `/opt/tome-news/imagens/entrada` (uid 1000, 700): fotos até a redação buscar.
- `/opt/tome-news/imagens/pub` (uid 10001, 755): capas públicas.
- nginx: `location ~ "^/imagens/…-(1600.jpg|800.webp)$"`; o `-4k.jpg` não é servido.
- `.env.autonomous`: `GEMINI_MAX_CALLS_PER_DAY=60`, `MAX_PENDING_DRAFTS=10`.
- Contêiner `redacao`: Pillow, fonte DejaVu, 640 MB.

## Variáveis de build no Render (implementação do Codex, `c335910`)

`ADSENSE_SLOT_TOP`, `ADSENSE_SLOT_MIDDLE`, `ADSENSE_SLOT_END`,
`ADSENSE_SLOT_HOME` (10 dígitos), `ADSENSE_AUTO_ADS` (padrão ligado) e
`GA4_MEASUREMENT_ID` (`G-…`).

## Não feito nesta entrega

- Editar ou remover matéria pelo WhatsApp e pelo painel (`CORRIGIR`, `CAPA`,
  `REMOVER`): o modelo atual fixa `revisao = 1` em banco, Edge e ponte.
- `STATUS` com cota do dia.
- Crédito da foto na página pública (falta coluna em `tomenota_publications`).
- Busca investigativa fora das fontes aprovadas; Tavily segue sem chave.
- Teste real no grupo com foto: depende do Deploy da função.

## 14/10/2026 — painel unificado (`/admin/`)

- Rascunhos: número da prévia, capa e botões **Aprovar**, **Rejeitar**,
  **Pedir correção** e **Trocar manchete**. O painel chama
  `POST /painel-api/drafts/<id>/decision` (sessão + CSRF, dono ou editor
  autorizado), que vai à ponte (`POST /decision`). A ponte assina e enfileira o
  mesmo comando do grupo e avisa no WhatsApp. Ator = hash do usuário; nenhum
  e-mail vai à ponte.
- Visão geral com números reais (`/painel-api/newsroom` e `/painel-api/infra`).
- "Serviços": site, banco, WhatsApp, robô, função de rascunhos e Gemini.
- "Ferramentas": as cinco ferramentas da VPS, abertas pelo túnel SSH.
- Textos atualizados (aprovação ativa, comandos do grupo, fonte única, fotos).
- CSP do painel aceita imagens de `https://bot.tomezap.com.br` (capas).

## Regra do jornal (16/10/2026, decisão do dono): toda matéria sai com foto

- Capa, nesta ordem: foto do editor (grupo, `FOTO 12` com a imagem, ou painel)
  → foto oficial da página da fonte (og:image do próprio órgão, crédito
  "<Fonte>/Divulgação") → arte do jornal só como espaço reservado.
- Rascunho sem foto real **não pode ser aprovado**, nem pelo grupo, nem pelo
  painel (`needs_photo`), nem agendado. A prévia avisa "SEM FOTO" e diz como
  mandar a foto. Rejeitar continua livre.
- Nunca usar foto de portal comercial. A ponte lê `WA_REQUIRE_PHOTO`
  (padrão: ligado); só desligar por decisão do dono.
