# Radar Tome Nota — servidor

Comece por `COMECE-AQUI.md`. O status atual e as limitações estão em `RELATORIO-ETAPA-2.md`.

A máquina de estados da coleta, circuit breaker, DLQ e o módulo auditável de assuntos em crescimento estão em [`docs/PIPELINE-ASSUNTOS.md`](docs/PIPELINE-ASSUNTOS.md). O estado `publicado` desse pipeline significa visível no painel e não autoriza publicação jornalística.

Etapas concluídas: núcleo editorial, importação v1, autenticação inicial, hospedagem, Gemini direto para headlines, embeddings e comandos de voz, além da estrutura persistente do pipeline/assuntos. O agendador e os adaptadores das fontes ainda precisam ser ligados ao executor de coleta.

## Gemini e voz

Toda IA roda no servidor pela API oficial do Gemini. Configure `GEMINI_API_KEY`, `GEMINI_MODEL` e `GEMINI_EMBEDDING_MODEL`; nenhuma chave chega ao navegador. O botão **Comando de voz** grava no máximo 30 segundos, envia o áudio autenticado e executa somente navegação, atualização, busca, filtro ou criação de pauta em apuração. Voz nunca aprova, descarta ou publica. O áudio bruto não é salvo; a interpretação fica auditada em `radar.comandos_voz`.

### Central operacional — 14/09/2026

O dashboard consulta `GET /api/v1/dashboard` a cada 30 segundos, com sessão e redação validadas no servidor. Mostra até 500 pautas, cidades registradas, pendências, fontes e atribuições dos dez agentes. Cards carregam a versão atual antes de abrir o editor. Datas de entrada, documento e fato permanecem distintas; documentos com mais de sete dias, títulos institucionais e datas futuras saem da seleção principal e continuam disponíveis nos filtros.

A prioridade é uma regra explicável de organização do trabalho, separada da afinidade aprendida: base 20, link HTTP(S) +10, evidência +10, documento recente +15, utilidade no título +15, evidência conferida +20; documento antigo −25, título institucional −25, data futura −20, limitado a 0–100. Não é confiança factual nem tendência. A marcação de novas entradas fica por usuário/redação neste navegador; não é conferência editorial.

Aplicar `database/operations-dashboard.sql` antes de atualizar o backend. O coletor SAPL consulta URLs registradas e prioriza a próxima ficha inédita entre os primeiros 30 links; continua respeitando o intervalo de robots.txt. Erros de documentos contam como falha da rodada e são registrados no histórico. A função Edge só aceita a identidade interna do agendador. Fontes que respondem sem documentos elegíveis aparecem como lacuna no painel.

Validação: `npm test`, `npm run build`, `npm run check`; `tests/postgres-operations-dashboard.sql` usa fixtures em transação com rollback. O teste DOM verifica abertura da versão atual, escape de texto externo, filtros, links, marcação de leitura e recuperação de erros. Não substitui revisão visual autenticada em dispositivos reais.

Limites ainda existentes: Instagram e WhatsApp não conectados; os dez agentes fazem triagem por regras, não dez execuções Gemini. Rastreamento completo por vereador e tendências em produção não estão prontos. Fontes bloqueadas ou sem parser adequado precisam de correção específica; sucesso de acesso não significa cobertura completa. Nenhuma dessas lacunas é apresentada como integração ativa.

Autenticação da coleta: `database/collector-job-auth.sql` gera uma credencial exclusiva no Vault e acrescenta `X-Radar-Collector` ao job existente, preservando a cadência. O JWT do projeto passa pelo gateway; a autorização adicional é validada no banco pela identidade interna da função. Sem credencial válida, não ocorre varredura. `tests/postgres-collector-auth.sql` confirma recusas sem expor o segredo.
