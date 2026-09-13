# Agentes de monitoramento — primeira etapa

Esta entrega implementa a atribuição automática e auditável dos candidatos que chegam
pela coleta agendada. Os dez agentes são **triagem por regras v1**, não dez agentes Gemini.
Nenhuma chamada de IA acontece neste fluxo. Instagram e tracking individual de vereadores
continuam pendentes; a fonte SAPL inicia a cobertura legislativa documental.

## Funcionamento

- O pg_cron existente verifica fontes a cada 15 minutos; cada fonte tem seu intervalo.
- O coletor lê fontes uma vez, aplica a deduplicação existente e insere candidatos em `apurar`.
- Um trigger transacional atribui um responsável: regra explícita da fonte, depois sinais
  no título por prioridade, depois Cotidiano como destino provisório a conferir.
- Títulos/evidências externos são dados, nunca instruções para o executor.
- Uma única pauta e execução por candidato. Duplicatas não disparam novas atribuições.
- `agentes_monitoramento` e `agentes_fontes` registram configuração/cobertura.
- `execucoes_agentes` e `agentes_pautas` são append-only (update/delete/truncate recusados).
- `eventos` inclui `agente_atribuido`, seguido pelo evento original `coleta_automatica`.
  Snapshots posteriores passam a incluir a atribuição; os antigos não são reescritos.
- Nenhum candidato recebe rascunho, conferência, aprovação ou publicação automática.
- Candidatos anteriores não são retroativamente apresentados como trabalho dos agentes.

## Consulta

`GET /api/v1/agentes` usa sessão HttpOnly e `X-Redacao-ID`. A RPC `tn_painel_agentes`
valida a associação do usuário à redação no banco. Retorna dez agentes, fontes e as
30 atribuições mais recentes. O dashboard consulta a cada 30 segundos enquanto montado,
mantém a última resposta visível quando há falha e identifica dados desatualizados.
O botão de abrir pauta busca o snapshot atual em `/api/v1/pautas/:id`.

## SAPL

A fonte ordena matérias de 2026 pela apresentação mais recente; uma ficha/rodada,
intervalo de uma hora, janela de sete dias. O robots.txt exige Crawl-delay de 60 segundos,
respeitado entre robôs, índice e ficha. Essa fonte roda sozinha na invocação para
manter a duração dentro do limite; fontes restantes seguem na próxima rodada. Não cobre todas as matérias de dias de alto
volume: paginação incremental e reconciliação são próximas etapas antes de prometer
tracking completo. Atualizar o filtro anual no início do novo ano.

O parser usa h1, ementa e data de apresentação explicitamente identificados. A data de
apresentação serve ao filtro de recência, mas não vira data de publicação do documento.
`data_documento` e `data_fato` permanecem a conferir. Texto é a ementa realmente lida;
não se afirma ter lido a íntegra do PDF, votos, autoria ou tramitação.

## Consumo

Cada atribuição registra tempo em ms, zero chamadas, zero tokens e custo de IA US$ 0.
Infraestrutura fica `null` (não informado), pois tempo de CPU não comprova cobrança.
O coletor mantém contadores de documentos/candidatos/duplicados/erros e latência da fonte.
Nenhum serviço ou plano novo foi contratado. Para medir custo de Gemini, uma etapa futura
deve efetivamente chamar o provedor e registrar consumo e preço aplicável.

## Implantação e verificação

1. Aplicar `database/monitoring-agents.sql` (migration `monitoring_agents_first_flow`).
2. Implantar `supabase/functions/radar-coletor/index.ts`, `sapl.mjs` e `robots.mjs`, com JWT ativado.
3. Aplicar `database/monitoring-sapl-source.sql`; o agendador existente recolhe a fonte.
4. Compilar e implantar o app. Não é preciso manter o navegador aberto para coletar.
5. `npm run build`, `npm run check`, `npm test`.
6. Executar `tests/postgres-monitoring-agents.sql`: fixtures isoladas com rollback,
   incluindo deduplicação, snapshots, imutabilidade e recusa entre redações.

O teste agendado real deve ser comprovado por `pautas`, `execucoes_agentes`,
`eventos`, `item_transitions` e `coletas`; sucesso do cron sozinho só prova disparo HTTP.
