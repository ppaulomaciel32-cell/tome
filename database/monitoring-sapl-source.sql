-- Ativar somente depois de implantar radar-coletor com o parser sapl_materia.
insert into radar.fontes(redacao_id,nome,url,tipo,regra_extracao,ativa,intervalo_segundos,proxima_varredura)
select id,'Câmara de São Gonçalo do Amarante/CE — Matérias legislativas',
 'https://sapl.saogoncalodoamarante.ce.leg.br/materia/pesquisar-materia?ano=2026&o=dataD','html',
 '{"parser":"sapl_materia","agente_slug":"camara-vereadores","cidade":"São Gonçalo do Amarante/CE","categoria":"Legislativo","max_itens":1,"link_include":["/materia/"]}'::jsonb,
 true,3600,now() from radar.redacoes
 where id in (select distinct redacao_id from radar.fontes where url='https://www.saogoncalodoamarante.ce.gov.br/informa.php')
on conflict(redacao_id,url) do nothing;
