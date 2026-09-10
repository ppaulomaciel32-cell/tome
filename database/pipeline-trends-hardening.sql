-- Ajuste incremental para bancos que já receberam radar_pipeline_trends_v1.
create or replace function radar_internal.transicionar_item(r uuid,i uuid,n radar.estado_item,m radar.motivo_transicao,o radar.origem_transicao,det jsonb default '{}')
returns radar.itens_coleta language plpgsql security definer set search_path='' as $$
declare atual radar.itens_coleta; anterior radar.estado_item;
begin
 if o='manual' then
  if length(btrim(coalesce(det->>'nota','')))=0 then raise exception using errcode='22023',message='Justificativa obrigatória.';end if;
  perform radar_internal.exigir_papel(r,array['editor_chefe','redator']::radar.papel[]);
 elsif coalesce(auth.jwt()->>'role','')<>'service_role' and session_user<>'postgres' then
  raise exception using errcode='42501',message='Transição automática exige identidade interna do coletor.';
 end if;
 select * into atual from radar.itens_coleta where redacao_id=r and id=i for update;
 if not found then raise exception using errcode='P0002',message='Item não encontrado.';end if;
 anterior:=atual.estado;
 if not radar_internal.transicao_valida(anterior,n,m,o) then raise exception using errcode='22023',message='Transição de estado inválida.';end if;
 update radar.itens_coleta set estado=n,motivo_descarte=case when n='descartado' then m else null end,
  publicado_painel_em=case when n='publicado' then now() else publicado_painel_em end, atualizado_em=now()
 where id=i returning * into atual;
 insert into radar.item_transitions(redacao_id,item_id,estado_anterior,estado_novo,motivo,origem,autor_id,detalhes)
 values(r,i,anterior,n,m,o,case when o='manual' then auth.uid() else null end,coalesce(det,'{}'));
 if anterior='descartado' and n='pendente' and m='reprocessamento_manual' then
  update radar.fila_falhas set estado='reprocessado',reprocessado_em=now(),reprocessado_por=auth.uid()
  where redacao_id=r and item_id=i and estado='pendente';
 end if;
 return atual;
end $$;
grant execute on function radar_internal.transicionar_item(uuid,uuid,radar.estado_item,radar.motivo_transicao,radar.origem_transicao,jsonb) to authenticated,service_role;
create or replace function public.tn_reprocessar_item(redacao_id uuid,item_id uuid,nota text) returns jsonb language sql security invoker set search_path='' as $$
 select to_jsonb(radar_internal.transicionar_item(redacao_id,item_id,'pendente','reprocessamento_manual','manual',jsonb_build_object('nota',nota)))
$$;
alter function public.tn_reprocessar_item(uuid,uuid,text) security invoker;
revoke execute on function public.tn_reprocessar_item(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.tn_reprocessar_item(uuid,uuid,text) to authenticated;
create index itens_redacao_fonte_fk on radar.itens_coleta(redacao_id,fonte_id);
create index itens_duplicado_fk on radar.itens_coleta(redacao_id,duplicado_de) where duplicado_de is not null;
create index duplicatas_original_fk on radar.item_duplicatas(redacao_id,item_original_id);
create index duplicatas_fonte_fk on radar.item_duplicatas(redacao_id,fonte_id);
create index alertas_fonte_fk on radar.alertas_coleta(redacao_id,fonte_id);
create index chamadas_item_fk on radar.chamadas_ia(redacao_id,item_id);
create index dlq_reprocessado_por_fk on radar.fila_falhas(reprocessado_por) where reprocessado_por is not null;
create index transicoes_autor_fk on radar.item_transitions(autor_id) where autor_id is not null;
