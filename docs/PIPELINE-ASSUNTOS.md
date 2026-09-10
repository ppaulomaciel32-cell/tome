# Pipeline automático e assuntos em crescimento

`publicado` no pipeline significa **visível no painel de monitoramento**. Não aprova pauta e não publica conteúdo jornalístico.

## Estados

`pendente → coletando → normalizado → classificado → deduplicado → publicado` é o caminho automático. `revisao` recebe itens sem cidade, com confiança baixa ou assunto novo. `descartado` guarda duplicidade, irrelevância ou falha definitiva. Saídas de `revisao` e reprocessamento de `descartado` são manuais e justificadas.

Todas as mudanças entram em `radar.item_transitions`, que bloqueia `UPDATE` e `DELETE`. Reprocessar uma falha usa `public.tn_reprocessar_item(redacao_id, item_id, nota)`; editor-chefe e redator podem chamar a RPC com justificativa.

## Idempotência e falhas

A chave canônica é SHA-256 de URL normalizada, título normalizado e data. A URL perde rastreadores, âncora, AMP e barra final. Um hash do corpo impede que a mesma matéria entre por URLs diferentes. Ocorrências duplicadas ficam em `item_duplicatas` ligadas ao original.

Cada fonte abre o circuito após três falhas. O backoff é 5, 15, 45, 120 e depois 240 minutos. Após o cooldown, uma probe coloca o circuito em meia-abertura; sucesso o fecha. Três falhas de item enviam o registro para `fila_falhas`. O lote processa no máximo cinco itens simultaneamente.

Falha de IA aciona extração determinística por texto e gazetteer. O item recebe confiança abaixo de 50. A coleta continua; ausência de cidade envia para `revisao`.

## Assuntos e tendência

Itens só agrupam quando têm cidade igual, entidade comum, distância temporal de até 48 horas e similaridade suficiente. Embeddings usam limiar padrão 0,85. Quando indisponíveis, palavras-chave usam limiar 0,35 e o grupo fica com confiança baixa.

`baseline_24h` é a média das sete janelas anteriores. `crescimento = (ocorrências_24h - baseline_24h) / max(baseline_24h, 1)`.

Uma tendência editorial exige pelo menos cinco ocorrências, três fontes, crescimento de 100% e atividade nas últimas seis horas. Instagram exige dez ocorrências, cinco autores, o mesmo crescimento e corroboração editorial. Abaixo disso, os rótulos são `emergindo` ou `sinal_fraco`.

O ciclo é `emergindo → crescendo → pico → esfriando → encerrado`. Duas janelas de queda produzem `esfriando`; sete dias sem ocorrência produzem `encerrado`. Mudanças ficam em `assunto_ciclo_transitions`.

Os limiares devem virar configuração da redação após o piloto; alterar limiares não deve reescrever o histórico anterior.
