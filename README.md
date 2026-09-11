# Radar Tome Nota — servidor

Comece por `COMECE-AQUI.md`. O status atual e as limitações estão em `RELATORIO-ETAPA-2.md`.

A máquina de estados da coleta, circuit breaker, DLQ e o módulo auditável de assuntos em crescimento estão em [`docs/PIPELINE-ASSUNTOS.md`](docs/PIPELINE-ASSUNTOS.md). O estado `publicado` desse pipeline significa visível no painel e não autoriza publicação jornalística.

Etapas concluídas: núcleo editorial, importação v1, autenticação inicial, hospedagem, Gemini direto para headlines, embeddings e comandos de voz, além da estrutura persistente do pipeline/assuntos. O agendador e os adaptadores das fontes ainda precisam ser ligados ao executor de coleta.

## Gemini e voz

Toda IA roda no servidor pela API oficial do Gemini. Configure `GEMINI_API_KEY`, `GEMINI_MODEL` e `GEMINI_EMBEDDING_MODEL`; nenhuma chave chega ao navegador. O botão **Comando de voz** grava no máximo 30 segundos, envia o áudio autenticado e executa somente navegação, atualização, busca, filtro ou criação de pauta em apuração. Voz nunca aprova, descarta ou publica. O áudio bruto não é salvo; a interpretação fica auditada em `radar.comandos_voz`.
