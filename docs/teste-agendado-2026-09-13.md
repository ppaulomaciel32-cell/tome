# Primeiro teste agendado dos agentes

Resultado verificado em produção em 13/09/2026. Não houve invocação manual do coletor:
o job `radar-coletor-cada-15-minutos` disparou às 13:30 UTC / 10:30 Fortaleza.

| Evidência | Resultado |
|---|---|
| Coleta | 13:30:03.061 a 13:32:03.606 UTC |
| Fonte | Câmara Municipal de São Gonçalo do Amarante/CE, SAPL |
| Link lido | https://sapl.saogoncalodoamarante.ce.leg.br/materia/4587 |
| Pauta | TN-20260913-000049 v1 |
| Identificador | 70b83883-a406-4606-8f6e-d46e9e3d00f9 |
| Assunto do candidato | Requerimento nº 36/2026 sobre informações orçamentárias da Cultura |
| Responsável | Agente 10 — Câmara e vereadores |
| Execução | de70ac5f-51a8-49dd-88f4-9b51d89703a4 |
| Método | regras_v1, atribuição explícita pela fonte |
| Resultado | 1 documento lido, 1 candidato, 0 duplicados, 0 erros |
| Tempo total da fonte | 120.597 ms, incluindo Crawl-delay de 60 segundos |
| Tempo da decisão de atribuição | 4,466 ms |
| Consumo de IA | 0 chamadas, 0 tokens, US$ 0 |
| Infraestrutura | Valor monetário não informado; não equivale a custo zero |
| Estado editorial | apurar, v1, conferida=false |

A evidência contém a data de apresentação registrada no SAPL (10/09/2026).
Datas do documento e do fato permanecem a conferir. É uma nova entrada na fila,
não uma afirmação de que o requerimento foi apresentado hoje. Foi lida a ementa
da ficha; não se afirma leitura integral do documento anexado ou apuração própria.

Validação: 50 testes Node aprovados; sete verificações agrupadas no teste PostgreSQL
com rollback (atribuição, deduplicação, auditoria, permissões, revisão sensível e consumo).
Deploy Render `dep-dajaaa8ae00c7396439g` live às 13:29:50 UTC.
Health HTTP 200; `/api/v1/agentes` sem sessão retorna 401; bundle servido corresponde
ao compilado: SHA256 `59977533a82f07e17fb6b8dd5210545993c5a9346c2c1b9cfa17f72000dbe2db`.

Limites: triagem por regras, Instagram não conectado, uma ficha legislativa por rodada,
sem tracking individual de todos os vereadores nesta etapa, sem análise Gemini.
Os testes autenticados usam fixtures isoladas, não a sessão real do editor; não houve
teste visual com login real. Nenhum serviço/plano adicional contratado.
