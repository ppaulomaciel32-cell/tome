# Ativação de tomenotanews.com.br

> REGISTRO HISTÓRICO — substituído em 11/10/2026 por
> [tomezap.com.br + Gemini](ATIVACAO_TOMEZAP_GEMINI.md).
> Não usar o domínio ou a branch desta versão para a ativação atual.

Registro de trabalho: 11/10/2026 (UTC). Domínio definido pelo proprietário:
**tomenotanews.com.br**. Nenhum serviço ou domínio foi contratado.

## Situação da entrega

As alterações estão na branch `feat/tomenotanews-com-br`, baseada no commit
`60ecb12ee5536f2d08870d9b50594de649844172` da branch de publicação
`public-site-github-supabase`. A branch publicada foi preservada porque a
consulta DNS pública retornou **NXDOMAIN (status 3)** para o domínio novo,
`www` e `bot`. Essa resposta não permite concluir se o domínio está registrado.

Não foram alterados DNS, serviço Render, secrets do Supabase ou a VPS.
Os conectores disponíveis não oferecem administração do DNS da Hostinger,
associação de domínio/edição do build no Render ou acesso SSH à VPS.
Nenhuma tabela ou configuração do Radar foi acessada nesta mudança.

## Endereços preparados

| Uso | Endereço |
|---|---|
| Site e canonical | `https://tomenotanews.com.br` |
| Alias do site | `https://www.tomenotanews.com.br` |
| Bot e previews temporários | `https://bot.tomenotanews.com.br` |
| Webhook Meta | `https://bot.tomenotanews.com.br/webhook` |
| Saúde do bot | `https://bot.tomenotanews.com.br/healthz` |

O serviço existente no Render continua sendo `tome-nota-publico`, ID
`srv-dau355gu01pc73b2mvjg`. Seu hostname técnico continua
`tome-nota-publico.onrender.com`; ele também é o destino do CNAME `www`.

## Ordem de ativação

1. Confirmar que `tomenotanews.com.br` aparece como registrado/ativo na conta
   do proprietário e identificar os servidores DNS autoritativos. Se o DNS
   estiver na Hostinger, editar a zona desse domínio novo, não a de `tomezap`.
2. No serviço público existente do Render, abrir **Settings → Custom Domains**
   e adicionar `tomenotanews.com.br`. Conferir também o alias `www` e seu
   redirecionamento para o domínio principal. Não criar outro serviço.
3. Aplicar os registros indicados pelo Render. A documentação oficial
   consultada orienta os valores abaixo para provedores com registro A/CNAME.
   Se o painel mostrar valores diferentes, usar os valores do próprio serviço.

| Tipo | Nome | Destino |
|---|---|---|
| A | `@` | `216.24.57.1` |
| CNAME | `www` | `tome-nota-publico.onrender.com` |
| A | `bot` | IPv4 público da VPS, após conferir no acesso ao servidor |

   Remover somente registros conflitantes dos nomes que estão sendo
   configurados, inclusive AAAA que aponte esses nomes para outro destino.
   Preservar e-mail e outros registros. Não alterar `api.tomezap.com.br`,
   `chat.tomezap.com.br` ou suas configurações nginx.
4. Esperar os registros aparecerem no DNS público. Verificar os domínios no
   Render e aguardar certificados válidos para o domínio principal e `www`.
5. Incorporar `feat/tomenotanews-com-br` em `public-site-github-supabase`,
   revisando eventuais commits adicionados à branch de publicação nesse meio
   tempo. Atualizar o serviço existente com estes valores:

| Campo | Valor |
|---|---|
| Branch | `public-site-github-supabase` |
| Root Directory | vazio |
| Build Command | `node scripts/build-public-site.mjs` |
| Publish Directory | `dist-public` |
| `SITE_URL` | `https://tomenotanews.com.br` |
| `NODE_VERSION` | `22` |
| `SKIP_INSTALL_DEPS` | `true` |

   A referência completa é [`render-public-site.yaml`](render-public-site.yaml).
   Não aplicar o `render.yaml` da raiz, pois pertence ao outro sistema.
   Conferir o deploy automático. Se não iniciar, usar **Manual Deploy → Deploy
   latest commit** no painel, depois de os valores acima estarem corretos.
6. Conferir home, `/localidade/pecem/`, `/sitemap.xml`, `/robots.txt` e `/ads.txt`.
   Verificar HTTPS, canonical e Open Graph apontando para o domínio principal.
   O AdSense preserva `ca-pub-2000164835494228`, consentimento e slots de exemplo
   ocultos. Adicionar/verificar o novo site na conta AdSense quando estiver
   acessível; o código sozinho não envia o domínio para análise do Google.
7. No Supabase, configurar `TNN_SITE_URL=https://tomenotanews.com.br`, junto aos
   secrets de ingestão/rebuild já documentados. Não alterar políticas RLS.
   Na VPS, usar `SITE_URL` com o mesmo valor e
   `AGENT_PUBLIC_URL=https://bot.tomenotanews.com.br`.
8. Para a VPS com nginx já instalado, seguir a opção de proxy existente em
   [`news-agent/README.md`](../news-agent/README.md). A configuração adicional
   publica somente `127.0.0.1:18080`; o nginx do host recebe as conexões HTTPS
   do bot. Configurar o webhook da Meta somente após o healthcheck público
   funcionar. Credenciais e testes reais continuam necessários.

## Arquivos criados ou alterados

- `public-site/index.html`
- `public-site/noticia.html`
- `public-site/sobre.html`
- `public-site/contato.html`
- `public-site/politica-de-privacidade.html`
- `public-site/termos-de-uso.html`
- `public-site/politica-de-cookies.html`
- `public-site/assets/js/config.js`
- `public-site/robots.txt`
- `public-site/sitemap.xml`
- `docs/render-public-site.yaml`
- `docs/DOMINIO_TOMENOTANEWS_2026_10_11.md` (novo)
- `news-agent/.env.example`
- `news-agent/.env.edge.example`
- `news-agent/README.md`
- `news-agent/tnn/core.py`
- `news-agent/tnn/web.py`
- `news-agent/docker-compose.existing-proxy.yml` (novo)
- `news-agent/nginx-host.example.conf` (novo)
- `tests/public-site.test.cjs`
- `tests/ssg.test.mjs`

Os arquivos gerados em `dist-public` não são versionados; o Render os gera
durante o build. Nenhuma migration SQL foi necessária para a troca do domínio.

## Verificação executada

```text
$ node --test tests/ingest.test.mjs tests/ssg.test.mjs tests/public-site.test.cjs
tests 24
pass 24
fail 0
skipped 0

$ node scripts/build-public-site.mjs
{"articles":0,"localities":6,"out":"/workspace/scratch/e70bc0559a4c/tome-nota-supabase-gh/dist-public"}

Verificação do build gerado:
html_pages_checked: 13
sitemap_urls_checked: 12
canonical_domain: tomenotanews.com.br
adsense_publisher_preserved: true
old_origin_in_pages: false

PASS: Render public blueprint conforms to the official JSON schema
PASS: Compose YAML parsed; bot binds loopback; Redis has no exposed port; container nginx is opt-in
```

O teste SSG também usa um domínio alternativo pela variável `SITE_URL` e
confere canonical, Open Graph, JSON-LD, robots, sitemap e configuração
gerada. Isso verifica que trocar a variável realmente muda as URLs emitidas.
Os dois módulos Python alterados passaram em `py_compile`.

Não executados nesta entrega: `docker compose config`, inicialização dos
contêineres, `nginx -t`, HTTPS do domínio e fluxo real do WhatsApp. Docker e
nginx não estão instalados neste ambiente e o servidor não foi acessado.
Validação de YAML não equivale a esses testes. O fluxo não está ativo.

## Referências oficiais

- [Render: DNS em outros provedores](https://render.com/docs/configure-other-dns)
- [Render: especificação de Blueprint](https://render.com/docs/blueprint-spec)
- [Schema oficial usado na validação](https://render.com/schema/render.yaml.json)
- [Docker Compose: profiles](https://docs.docker.com/compose/how-tos/profiles/)
