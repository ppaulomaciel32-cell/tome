# Radar Tome Nota

Central editorial do Tome Nota News. Node/Fastify, React e Supabase/Postgres.

## Estado

Entrega intermediária: fluxo editorial, histórico imutável, importação do HTML v1 e acesso por papéis. Coleta automática, aprendizado, geração por Claude e backup diário ainda não estão implementados. Aprovação não publica notícias.

## Executar

Use Node 22 ou superior. Execute `npm ci --ignore-scripts`, copie `.env.example` para `.env.local`, preencha as variáveis no ambiente do servidor e rode `npm run build` e `npm start`.

No Render, a origem é obtida de `RENDER_EXTERNAL_URL`, ou de `APP_ORIGIN` quando definida. Nenhuma chave deve ser inserida no frontend ou no repositório.

## Validar

`npm test` executa os testes HTTP com provedor simulado. Os testes SQL em `tests/` verificam o Postgres com fixtures revertidas. Não execute as migrações de criação em uma base já configurada.
