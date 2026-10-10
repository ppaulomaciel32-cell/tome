# Entrega técnica — agente de redação — 10/10/2026

Código do agente implementado com **Drael** e testes locais executados.
**Ainda não está operando no WhatsApp real.** Não houve geração paga,
mensagem real para terceiros ou contratação de serviços nesta sessão.

## Resultado verificado

| Verificação executada | Resultado | Limite da evidência |
|---|---|---|
| Node: site público, ingestão e SSG | 24 testes passaram, zero falhas | Rede de ingestão simulada nos testes unitários |
| Python: bot, pipeline, comandos, arte, fila e HTTP | 21 testes passaram, zero falhas | Provedores externos simulados; Redis via fakeredis/Lua |
| SQL no Supabase real, dentro de BEGIN/ROLLBACK | PASS | Não criou notícias permanentes |
| Build real usando leitura anon | 0 notícias, 6 localidades geradas | Banco ainda sem notícias |
| HTTP real da Edge Function | GET e POST sem credencial: 503, serviço não configurado | Ingestão autenticada real ainda não foi exercitada |
| Inspeção de permissões | anon sem INSERT, sem leitura de agent_log, sem EXECUTE da RPC | Auditoria restrita aos objetos autorizados |
| Contagem após rollback | 0 publicações, 0 logs | Confirma remoção dos dados de teste |
| Arte gerada e aberta visualmente | PNG 1080×1920, 81.810 bytes | Sem foto real; não substitui conferência no celular |
| docker-compose.yml | YAML válido, quatro serviços, Redis privado, um worker | Docker não disponível neste ambiente; imagem/serviços não iniciados |

Saída resumida dos comandos executados:

```text
node --test tests/ingest.test.mjs tests/ssg.test.mjs tests/public-site.test.cjs
tests 24
pass 24
fail 0

python -m unittest discover -s tests -v
Ran 21 tests
OK

SQL:
PASS: atomicidade, idempotência, colisão, correção, logs privados e anon sem escrita

node scripts/build-public-site.mjs
{"articles":0,"localities":6,"out":".../dist-public"}

GET /functions/v1/tnn-ingest
503 {"error":"Serviço ainda não configurado."}
POST /functions/v1/tnn-ingest
503 {"error":"Serviço ainda não configurado."}
```

As saídas completas dos testes estão em [AGENTE_TESTES_2026_10_10.txt](AGENTE_TESTES_2026_10_10.txt).
Nenhum teste com mocks comprova o prazo real de 90 segundos.

## Supabase aplicado

Projeto: `dfbeerxqqfqkwlljrjko`.

- Migration `20261009221026_whatsapp_news_agent`: campos do agente na tabela
  pública, índices, agent_log privado e RPC transacional.
- Migration `20261009222557_align_agent_city`: município acompanha correções
  de localidade, sem alterar slug, autoria ou RLS.
- Edge Function `tnn-ingest`, versão 2, publicada. Autenticação por
  `x-service-token` no handler; secrets operacionais ainda não configurados.
- Política preservada: anon/authenticated só leem publicações com
  `status='published' AND published_at <= now()`.

Não foram consultadas ou alteradas tabelas do Radar.
Uma chamada da CLI foi bloqueada pela revisão automática por possível
telemetria externa. Ela não foi repetida; a implantação prosseguiu pelo
conector Supabase autorizado. O código entregue não depende dessa chamada.

## Situação dos oito testes de aceitação solicitados

| Caso | Teste automatizado executado | Validação externa pendente |
|---|---|---|
| Foto + manchete → arte + notícia em menos de 90s | Ordem imagem, preview, ingestão e confirmação exercitada com mocks | Meta, fontes reais, Drael, Cloudinary e tempo do rebuild |
| Duplicação em 5 minutos | Mesmo pedido gera um job; reserva concorrente e TTL de 72h validados | Reenvio pelo aparelho |
| Manchete sem foto | Gera capa padrão e aviso | Conferir recebimento no WhatsApp |
| Remetente fora da whitelist | Resposta de não autorizado, sem job | Envio de outro número |
| Menos de duas fontes | Aviso antes da escrita; uma fonte espera APROVAR | Busca web real e relevância das fontes |
| Falha de rede | Duas novas tentativas, erro final e nenhuma ingestão parcial | Simulação na VPS e provedores reais |
| CORRIGIR mantém slug | Pipeline reaproveita fontes/job; SQL real mantém slug e corrige município | Mensagem de correção real e URL no site |
| Arte legível no celular | Dimensões, tamanho, limites de linhas e inspeção visual | Abrir PNG no aparelho do usuário |

Também passaram STATUS/LISTAR, alerta de três falhas consecutivas, assinatura
HMAC e rejeição de payload alterado, HTTP local real, preview privado,
escapamento HTML, bloqueio de números sem fonte e espera de revisão no HTML
antes de enviar “No ar”. A transcrição do teste usa um adaptador falso;
o modelo de áudio local ainda não foi executado neste ambiente.

## Para ativar

1. No Render, salvar Build Command `node scripts/build-public-site.mjs` e
   Publish Directory `dist-public`. Manter a branch pública. O conector não
   permite editar esses dois campos. Usar Node 22 e SKIP_INSTALL_DEPS=true.
2. Copiar o deploy hook privado do serviço público para os secrets da Edge
   Function, junto com TNN_SITE_URL e um INGEST_SERVICE_TOKEN exclusivo.
3. Informar qual é a VPS real: endereço, SO, recursos e acesso seguro; definir
   o hostname HTTPS do bot e instalar o certificado. Não foram fornecidos.
4. Configurar a conta Meta, número dedicado, Phone Number ID, app secret,
   token, versão Graph, webhook e números autorizados.
5. Configurar Drael com uma chave nova em variável de ambiente; confirmar que
   a assinatura atual libera a API. Configurar Tavily e Cloudinary nos seus
   planos/cotas existentes, sem contratar novos serviços.
6. Subir o Docker, testar backup, programar cron na VPS e executar os testes
   externos acima com uma pauta verdadeira e fontes conferidas.

Instruções completas, configuração da Meta e exemplos:
[news-agent/README.md](../news-agent/README.md).

## Arquivos novos e alterados

Somente `public-site/app.js` altera um arquivo existente do site nesta entrega.
Os demais abaixo são arquivos novos deste agente:

```text
public-site/app.js
scripts/build-public-site.mjs
supabase/migrations/20261009221026_whatsapp_news_agent.sql
supabase/migrations/20261009222557_align_agent_city.sql
supabase/functions/tnn-ingest/index.ts
supabase/functions/tnn-ingest/handler.mjs
supabase/functions/tnn-ingest/deno.json
tests/agent-schema.sql
tests/ingest.test.mjs
tests/ssg.test.mjs
news-agent/.gitignore
news-agent/.dockerignore
news-agent/.env.example
news-agent/.env.edge.example
news-agent/Dockerfile
news-agent/docker-compose.yml
news-agent/nginx.conf
news-agent/requirements.txt
news-agent/requirements-test.txt
news-agent/backup.sh
news-agent/README.md
news-agent/tnn/__init__.py
news-agent/tnn/core.py
news-agent/tnn/store.py
news-agent/tnn/web.py
news-agent/tnn/providers.py
news-agent/tnn/pipeline.py
news-agent/tnn/worker.py
news-agent/tnn/art.py
news-agent/tnn/editorial.txt
news-agent/tnn/backup.py
news-agent/tnn/preflight.py
news-agent/tests/test_agent.py
news-agent/tests/test_http.py
news-agent/tests/test_redis.py
docs/AGENTE_ENTREGA_2026_10_10.md
docs/AGENTE_TESTES_2026_10_10.txt
```

O output `dist-public`, arquivos locais de teste, certificados, credenciais e
volumes não fazem parte do commit. Os SQL completos estão nos arquivos de
migration; os dois já estão aplicados neste projeto. O frontend conserva o
ID AdSense ca-pub-2000164835494228 e a lógica de consentimento.
