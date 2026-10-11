# Painel TomeZap — primeiro marco

O painel reúne a operação do Tome Nota News. Este primeiro marco entrega a
estrutura visual, a navegação dos seis módulos e o código de acesso protegido.
Os módulos ainda não enviam materiais, mensagens ou posts e não inventam métricas.

## O que abrir

- Prévia offline: `docs/painel-preview.html` (abrir no navegador; não envia dados).
- Interface de produção, após publicação: `https://tomezap.com.br/admin/`.
- Prévia estática, após publicação: `https://tomezap.com.br/admin/preview.html`.
- API isolada, após instalação: `https://bot.tomezap.com.br/painel-api/`.

A interface aproveita o Render e o build atual. A API usa Node.js 22 na VPS
existente, em contêiner separado, sem instalação npm e sem plano adicional.
Nenhum DNS novo é necessário. O serviço estático do Render não executa essa API.

## Acesso e limites deste marco

1. O e-mail do dono autorizado é `p.paulomaciel.32@gmail.com`, configurado somente
   no ambiente do servidor. Editores são autorizados explicitamente por
   `PANEL_EDITOR_EMAILS` e não recebem o papel de dono.
2. O usuário precisa existir no Supabase Auth e ter o e-mail confirmado. O código
   não cria contas, não oferece cadastro aberto e não altera usuários existentes.
   A senha é a da conta do projeto, nunca a senha do Gmail ou do painel Supabase.
3. A cada requisição protegida, o servidor consulta `GET /auth/v1/user`, verifica
   a identidade confirmada e cruza o e-mail com a autorização do servidor.
   `user_metadata` não concede permissões. Não basta esconder um botão.
4. Apenas a chave pública `publishable` ou `anon` é necessária. A API recusa uma
   chave administrativa. Não usa `service_role`, Gemini, Meta, Drael ou Redis.
5. O navegador recebe um identificador aleatório em cookie `__Host-`, `HttpOnly`,
   `Secure`, `SameSite=Strict`, sem `Domain`. Tokens Supabase ficam na memória do
   servidor. Nada é salvo em localStorage ou sessionStorage.
6. Sessões duram no máximo oito horas e expiram após 30 minutos sem requisições.
   Reiniciar a API encerra as sessões locais: basta entrar novamente. Uma única
   instância é o padrão; persistência/escala exigirá armazenamento compartilhado.
7. Logout invalida a sessão local imediatamente e chama o logout Supabase com
   `scope=local`. Nunca solicita logout global de outros sistemas.
8. Contas com segundo fator já habilitado são bloqueadas neste marco, em vez de
   contornar essa proteção. O fluxo de segundo fator precisa ser implementado
   antes de ativar uma conta nessas condições.
9. Requisições exigem origem exata, HTTPS em produção e limites de frequência.
   A saída exige também token CSRF. Nenhum corpo, senha ou cookie é registrado.
10. Não há schema, tabela, policy, trigger ou configuração global do Supabase
    alterada neste marco. As tabelas da biblioteca pertencem ao próximo marco.

O login real ainda precisa ser conferido com a conta do dono após ativação.
Os testes automatizados usam respostas simuladas do Supabase; eles não confirmam
a existência da conta, sua senha, segundo fator ou configurações de produção.

## Ativação em produção — executar somente após autorização do dono

Antes de aplicar, comparar a branch `feat/painel-controle-tomezap` com as branches
atuais. Ela parte de `da141ecb4efd0e8deafccd198cb44855812f13a0` e inclui os ajustes
Gemini/tomezap ainda não incorporados à branch de produção. Não resetar branches
nem sobrescrever trabalho posterior. Não importar o `render.yaml` da raiz.

### 1. Conta do dono

No Supabase Auth, conferir somente a conta informada pelo dono, sem enumerar
usuários do Radar. Se já existir, não recriar nem redefinir sua senha sem pedido.
Se não existir, combinar com o dono a criação/convite e a confirmação de e-mail.
Não alterar SMTP, templates, habilitação de cadastro ou redirecionamentos globais
para este marco. Não colar senhas ou tokens em chats.

### 2. API isolada na VPS

Na pasta `panel-api`, criar `.env` a partir de `.env.example` somente se ela ainda
não existir. Preencher a chave pública do mesmo projeto. Manter o dono informado
e a lista de editores inicialmente vazia. Não copiar a `.env` do agente.

Após autorização, conferir e iniciar apenas o novo projeto Compose:

```sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml up -d --build painel-api
curl --fail http://127.0.0.1:18081/healthz
```

O bind é `127.0.0.1:18081`, com máximo de 128 MB configurado. Conferir antes se a
porta está livre e se há capacidade na VPS; não comprar recursos automaticamente.
Não expor 3080/18081 ao público. O healthcheck confirma o processo e a presença da
configuração, não a validade da conta. `PANEL_TRUST_PROXY=true` só é apropriado
com esse bind e o nginx sobrescrevendo `X-Real-IP` e `X-Forwarded-Proto`.

### 3. Nginx existente

Fazer uma cópia da configuração atual antes de editar. Adicionar o bloco de
`nginx-location.example.conf` somente no server HTTPS de `bot.tomezap.com.br`.
Preservar as rotas do bot e todos os demais hosts. Testar `nginx -t` antes de
recarregar. Não há mudança de DNS, certificado ou portas 80/443 neste marco.

### 4. Render

Mesclar apenas após comparar e autorizar o conjunto de mudanças. O serviço
público usa `node scripts/build-public-site.mjs` e publica `dist-public`.
Os arquivos `/admin/` são copiados automaticamente pelo build existente.
Aplicar no serviço público os cabeçalhos de `docs/render-public-site.yaml`:

- Proteções globais já previstas para o jornal.
- `connect-src` permitindo a API exata de `bot.tomezap.com.br`.
- `/admin/*` com `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow,
  noarchive` e CSP restritiva, sem scripts de anúncios ou terceiros.

O arquivo `_headers` sozinho não ativa cabeçalhos no Render. Conferir as respostas
HTTP depois de configurar o serviço. O painel não adiciona AdSense, pixel ou
cookie de marketing às páginas internas; a configuração do jornal é preservada.

### 5. Teste real com o dono

Abrir `/admin/` no celular. Tentar uma senha errada, depois entrar com a conta
correta. Conferir navegação, sair e confirmar que a área protegida fecha.
Testar também e-mail não autorizado, expiração e indisponibilidade do backend.
Uma conta sem autorização não deve obter `/painel-api/bootstrap`.

Para desfazer a ativação, restaurar somente a configuração do painel e o deploy
anterior do serviço público, sob autorização. Nunca apagar volumes do agente,
alterar Radar ou executar `docker compose down` no projeto da redação.

## Testes locais

```sh
node --test tests/panel-auth.test.mjs tests/ingest.test.mjs tests/ssg.test.mjs tests/public-site.test.cjs
node scripts/build-panel-preview.mjs
node scripts/build-public-site.mjs
```

Teste visual opcional, em ambiente com Playwright/Chromium instalado:

```sh
node --test tests/panel-ui.test.mjs
```

`PANEL_CHROMIUM_PATH` pode apontar para um Chromium de testes já instalado.
Playwright não é dependência de execução do painel ou do build do jornal.
O teste de navegador simula as respostas da API; os testes do servidor fazem
requisições HTTP reais ao servidor local e simulam somente o Supabase upstream.

## Referências oficiais conferidas

- https://supabase.com/changelog.md
- https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- https://supabase.com/docs/guides/auth/sessions
- https://github.com/supabase/auth/blob/master/openapi.yaml

## Próximo marco

Após a aprovação do visual: biblioteca com armazenamento privado, permissões,
metadados e histórico. Só depois conectar o envio ao robô. As demais telas atuais
são estrutura de navegação, não módulos operacionais concluídos.
