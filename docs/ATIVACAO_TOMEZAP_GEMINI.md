# Tome Nota News — tomezap.com.br e Gemini

Decisão atualizada pelo proprietário em 11/10/2026 (Fortaleza).
Esta orientação substitui o roteiro que usava `tomenotanews.com.br` e Drael.
O nome editorial continua **Tome Nota News**.

## Fonte de código para a ativação

- Repositório: `ppaulomaciel32-cell/tome`.
- Branch atual deste ajuste: **`feat/tomezap-gemini`**.
- Branch de publicação: `public-site-github-supabase`.
- A branch atual inclui os ajustes anteriores de SSG e proxy da VPS, com o
  domínio corrigido e o redator Gemini. Não publicar a branch anterior
  `feat/tomenotanews-com-br` isoladamente.
- Conferir mudanças posteriores antes de incorporar a branch; não sobrescrever
  trabalhos em andamento no GitHub ou na VPS.

## Valores corretos

| Uso | Valor |
|---|---|
| Site/canonical | `https://tomezap.com.br` |
| Alias | `https://www.tomezap.com.br` |
| Bot/previews | `https://bot.tomezap.com.br` |
| Callback Meta | `https://bot.tomezap.com.br/webhook` |
| Healthcheck | `https://bot.tomezap.com.br/healthz` |
| `SITE_URL` no Render e na VPS | `https://tomezap.com.br` |
| `TNN_SITE_URL` no Supabase | `https://tomezap.com.br` |
| `AGENT_PUBLIC_URL` na VPS | `https://bot.tomezap.com.br` |
| `GEMINI_MODEL` na VPS | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` na VPS | chave Gemini inserida diretamente no `.env` protegido |

Não usar a chave Drael como chave Gemini. Não é necessário criar variável
Gemini no frontend, no Render estático ou na Edge Function. A redação roda
na VPS. O token exclusivo de ingestão continua separado da chave do modelo.

## Domínio e Render

Preservar `api.tomezap.com.br`, `chat.tomezap.com.br`, o nginx existente,
e-mail e todos os serviços fora do portal público. O Radar não participa.

Usar o serviço Render já existente `tome-nota-publico`, ID
`srv-dau355gu01pc73b2mvjg`. Associar `tomezap.com.br` e `www` a esse serviço,
conferir os registros exibidos pelo painel e apontar somente esses nomes.
Para `bot`, usar o IP confirmado da VPS. Não trocar os nameservers de toda
a zona sem preservar os registros existentes.

Conferir DNS e HTTPS antes de mudar as URLs em produção. A consulta feita
neste ambiente em 11/10 não conseguiu confirmar o novo estado: houve timeout
na consulta DNS e HTTP 502 no acesso de verificação. Isso não comprova que o
domínio esteja fora do ar; confirmar no painel e no ambiente do operador.

Incorporar `feat/tomezap-gemini` à branch de publicação quando o domínio
estiver acessível. Configurar o serviço público:

| Campo | Valor |
|---|---|
| Branch | `public-site-github-supabase` |
| Root Directory | vazio |
| Build Command | `node scripts/build-public-site.mjs` |
| Publish Directory | `dist-public` |
| `SITE_URL` | `https://tomezap.com.br` |
| `NODE_VERSION` | `22` |
| `SKIP_INSTALL_DEPS` | `true` |

Usar `docs/render-public-site.yaml` como referência. O `render.yaml` da raiz
pertence ao outro sistema e não deve ser aplicado. Conferir o deploy iniciado
automaticamente antes de solicitar outro. Validar notícias, localidades,
canonical, OG, robots, sitemap e cabeçalhos. O AdSense conserva o publisher
`ca-pub-2000164835494228` e a lógica de consentimento.

## VPS, IA e Supabase

1. Atualizar o checkout/artefato do agente a partir desta branch. Copiar apenas
   novos nomes/valores necessários do `.env.example`, sem sobrescrever tokens
   válidos ou arquivos de dados existentes.
2. Criar/configurar `GEMINI_API_KEY` no servidor, proveniente do projeto
   correto no Google AI Studio. Conferir o free tier e as cotas da conta.
   Não habilitar cobrança, ferramentas pagas ou troca automática de modelo.
3. Usar `GEMINI_MODEL=gemini-3.5-flash-lite`. A documentação oficial recomenda
   modelos atuais para projetos novos; modelos 2.5 têm acesso limitado a
   usuários anteriores. Um identificador configurável permite trocar o modelo
   explicitamente quando necessário, após checar suporte e custos.
4. Preservar Tavily para busca, Cloudinary para capa e Pillow para a arte.
   Não houve mudança na transcrição local nem nas regras de aprovação.
5. Instalar o certificado de `bot.tomezap.com.br` e usar o nginx do host com
   `docker-compose.existing-proxy.yml`. O bot é exposto só em
   `127.0.0.1:18080`; não habilitar o perfil `standalone-proxy` nesse cenário.
   Testar `nginx -t` antes de recarregar os blocos desse hostname.
6. Executar preflight, reconstruir/recriar os contêineres do agente e do bot
   para carregarem código e ambiente novos. Um simples restart pode conservar
   o ambiente anterior. Preservar volumes Redis, arquivos e backups.
7. No Supabase, definir `TNN_SITE_URL=https://tomezap.com.br`. Preservar
   `INGEST_SERVICE_TOKEN` igual ao da VPS e `TNN_SITE_REBUILD_HOOK` correto.
   Não reenviar migrations ou alterar policies por causa desta troca.
8. Atualizar o Callback URL no painel Meta, validar assinatura/whitelist e
   testar o fluxo com uma pauta real. O modo individual segue implementado;
   integração com grupos continua dependente de trabalho e validação próprios.

A API Gemini é chamada por HTTPS na rota oficial `generateContent`. Chave
no cabeçalho, host fixo, temperatura 0,3, limite de saída de 4096 tokens e
JSON estruturado. O parser exige conclusão `STOP`, filtra conteúdo de
raciocínio e rejeita respostas incompletas, bloqueadas ou com ferramentas.
Erros editoriais e números sem suporte nas fontes bloqueiam a publicação.
Timeout de geração não é repetido automaticamente para evitar consumo incerto
de cota. Limites conhecidos mantêm as tentativas controladas do pipeline.

## Validação e limites desta entrega

Resultado local em 11/10/2026: **24 testes Node e 31 testes Python passaram**.
O build consultou somente as publicações públicas e gerou seis localidades,
com zero notícias disponíveis. As 13 páginas HTML e as 12 URLs do sitemap
foram conferidas com `https://tomezap.com.br`; publisher AdSense preservado.
A saída está em [TOMEZAP_GEMINI_TESTES_2026_10_11.txt](TOMEZAP_GEMINI_TESTES_2026_10_11.txt).

Rodar da raiz:

```sh
node --test tests/ingest.test.mjs tests/ssg.test.mjs tests/public-site.test.cjs
node scripts/build-public-site.mjs
```

Rodar na pasta `news-agent`, usando o ambiente Python documentado no README:

```sh
python -m unittest discover -s tests -v
```

Os testes Gemini usam respostas simuladas e verificam a integração do parser
com o pipeline. Eles não comprovam a validade de uma chave, cota disponível,
qualidade de geração real, compatibilidade da conta com o modelo ou ativação
do bot. Não foi executada chamada real de geração nem alterado painel externo
nesta entrega. O operador deve concluir o teste real após configurar a chave.

## Fontes oficiais consultadas

- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
- https://ai.google.dev/gemini-api/docs/pricing
