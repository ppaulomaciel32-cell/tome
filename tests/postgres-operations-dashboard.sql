-- Fixtures isoladas; nenhuma sessão real é utilizada; todos os dados são revertidos.
begin;
create function pg_temp.test_operations() returns jsonb language plpgsql as $$
declare r uuid:=gen_random_uuid(); other_r uuid:=gen_random_uuid(); f uuid; u uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); p uuid; result jsonb; checks jsonb:='[]'; raw text:='Vagas para profissionais no Pecém: documento fictício de teste, sem validade editorial.';
begin
 insert into radar.redacoes(id,slug,nome) values(r,'teste-'||r,'Teste agentes'),(other_r,'teste-'||other_r,'Outra redação');
 insert into radar.agentes_monitoramento(redacao_id,numero,slug,nome,instrucao,padrao_titulo,prioridade,revisao_sensivel)
 select r,numero,slug,nome,instrucao,padrao_titulo,prioridade,revisao_sensivel from radar.agentes_monitoramento
 where redacao_id=(select redacao_id from radar.agentes_monitoramento limit 1);
 insert into radar.fontes(redacao_id,nome,url,tipo,regra_extracao,intervalo_segundos)
 values(r,'Fonte fixture','https://teste.invalid/noticias','html','{}',3600) returning id into f;
 if (select count(*) from radar.agentes_fontes where fonte_id=f)<>10 then raise exception 'Fonte nova não vinculada'; end if;
 result:=public.tn_ingerir_candidato_automatico(r,f,'https://teste.invalid/1','https://teste.invalid/1','Vagas para profissionais no Pecém','vagas para profissionais no pecém',current_date,raw,radar_internal.hash_texto(raw),radar_internal.hash_texto('url+titulo+data'),'Pecém','Emprego');
 p:=(result->>'pauta_id')::uuid;
 if not (result->>'novo')::boolean or p is null then raise exception 'Não criou candidato';end if;
 if (select a.numero from radar.agentes_pautas ap join radar.agentes_monitoramento a on a.id=ap.agente_id where ap.pauta_id=p)<>2 then raise exception 'Agente incorreto';end if;
 if (select status from radar.pautas where id=p)<>'apurar' or (select conferida from radar.pautas where id=p) or exists(select 1 from radar.rascunhos where pauta_id=p) then raise exception 'Trava editorial alterada';end if;
 if not exists(select 1 from radar.eventos where pauta_id=p and acao='agente_atribuido' and snapshot#>>'{agente_responsavel,numero}'='2' and snapshot#>>'{pauta,evidencia}'=raw) then raise exception 'Snapshot incompleto';end if;
 if (select count(*) from radar.eventos where pauta_id=p)<>2 then raise exception 'Histórico incompleto';end if;
 result:=public.tn_ingerir_candidato_automatico(r,f,'https://teste.invalid/outro','https://teste.invalid/outro','Vagas para profissionais no Pecém','vagas para profissionais no pecém',current_date,raw,radar_internal.hash_texto(raw),radar_internal.hash_texto('outra-url'),'Pecém','Emprego');
 if (result->>'novo')::boolean or (select count(*) from radar.execucoes_agentes where redacao_id=r)<>1 then raise exception 'Duplicou execução';end if;
 checks:=checks||jsonb_build_array('Candidato automático atribuído ao agente 2, em apuração, sem rascunho','Dois eventos com snapshot e execução persistida','Conteúdo repetido em outra URL não duplica pauta nem execução');
 begin update radar.execucoes_agentes set motivo='alterado' where pauta_id=p; raise exception 'Alterou histórico';exception when sqlstate '55000' then null;end;
 begin delete from radar.agentes_pautas where pauta_id=p; raise exception 'Apagou atribuição';exception when sqlstate '55000' then null;end;
 insert into auth.users(id,aud,role,email) values(u,'authenticated','authenticated',u||'@teste.invalid');
 insert into auth.sessions(id,user_id,not_after) values(sid,u,now()+interval '1 hour');
 insert into radar.usuarios(id,nome) values(u,'Teste agentes');
 insert into radar.membros_redacao(redacao_id,usuario_id,papel) values(r,u,'leitor');
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
 execute 'set local role authenticated';
 result:=public.tn_painel_operacao(r);
 if jsonb_array_length(result->'pautas')<>1 or result#>>'{pautas,0,agente_numero}'<>'2' or result#>>'{pautas,0,tem_evidencia}'<>'true' or (result#>'{pautas,0}') ? 'evidencia' then raise exception 'Resumo operacional incorreto';end if;
 begin perform public.tn_coletor_urls_conhecidas(f);raise exception 'Leitor acessou RPC interno';exception when sqlstate '42501' then null;end;
 if jsonb_array_length(result->'agentes')<>10 or jsonb_array_length(result->'execucoes')<>1 or result#>>'{execucoes,0,tokens}'<>'0' then raise exception 'Painel ou consumo incorreto';end if;
 begin perform public.tn_painel_operacao(other_r);raise exception 'Acessou outra redação';exception when sqlstate '42501' then null;end;
 begin perform public.tn_ingerir_candidato_automatico(r,f,'https://teste.invalid/3','https://teste.invalid/3','Teste','teste',current_date,raw,radar_internal.hash_texto('x'),radar_internal.hash_texto('y'),'Pecém','Emprego');raise exception 'Usuário chamou ingestão';exception when sqlstate '42501' then null;end;
 execute 'reset role';
 update radar.membros_redacao set papel='redator' where redacao_id=r and usuario_id=u;
 update radar.agentes_monitoramento set revisao_sensivel=true where redacao_id=r and numero=2;
 execute 'set local role authenticated';
 begin
  perform public.tn_comando(r,p,'conferir_evidencia',1,'{"confirmacao_humana":true}','Conferência de teste sem marcação sensível.');
  raise exception 'Dispensou revisão sensível do agente';
 exception when sqlstate '22023' then if sqlerrm not like 'Assunto sensível%' then raise;end if;
 end;
 result:=public.tn_comando(r,p,'conferir_evidencia',1,'{"confirmacao_humana":true,"revisao_sensivel":true}','Conferência de teste incluindo revisão sensível.');
 if result->'conferencia_evidencia'='null'::jsonb then raise exception 'Não registrou conferência sensível';end if;
 execute 'reset role';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 execute 'set local role service_role';
 result:=public.tn_coletor_urls_conhecidas(f);
 if jsonb_array_length(result)<>1 then raise exception 'Consulta interna URLs incorreta';end if;
 execute 'reset role';
 return checks||jsonb_build_array('Execuções e atribuições imutáveis','Leitor consulta; acesso a outra redação e ingestão interna recusados','Consumo: zero tokens e chamadas, infraestrutura sem valor inventado','Classificação sensível do agente exige revisão específica no servidor');
end $$;
select pg_temp.test_operations() as testes;
rollback;
