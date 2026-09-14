begin;
create function radar_internal.painel_operacao(r uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform radar_internal.exigir_papel(r,array['editor_chefe','redator','leitor']::radar.papel[]);
 return radar_internal.painel_agentes(r)||jsonb_build_object(
 'total_pautas',(select count(*) from radar.pautas where redacao_id=r),
 'pautas',coalesce((select jsonb_agg(to_jsonb(x) order by x.criada_em desc) from (
  select p.id,p.codigo,p.titulo,p.localidade,p.categoria,p.fonte_id,p.url_fonte,p.data_documento,p.data_fato,
   p.status,p.versao,p.criada_em,p.atualizada_em,p.origem,p.conferida,
   length(btrim(p.evidencia))>0 tem_evidencia,
   exists(select 1 from radar.rascunhos d where d.pauta_id=p.id and d.versao=p.versao and length(btrim(d.texto_site))>0) tem_rascunho,
   exists(select 1 from radar.conferencias c where c.id=p.conferencia_evidencia_id and c.versao=p.versao and c.hash_verificado=p.hash_evidencia) evidencia_conferida,
   a.nome agente,a.numero agente_numero,a.revisao_sensivel,
   f.nome fonte
  from radar.pautas p left join radar.fontes f on f.id=p.fonte_id
  left join radar.agentes_pautas ap on ap.pauta_id=p.id and ap.redacao_id=p.redacao_id
  left join radar.agentes_monitoramento a on a.id=ap.agente_id
  where p.redacao_id=r order by p.criada_em desc limit 500)x),'[]'::jsonb),
 'coletas_24h',coalesce((select jsonb_agg(to_jsonb(x) order by x.inicio desc) from (
  select c.fonte_id,c.inicio,c.fim,c.status,c.documentos_lidos,c.candidatos_criados,c.duplicados,c.erros,c.latencia_ms
  from radar.coletas c where c.redacao_id=r and c.inicio>now()-interval '24 hours' order by c.inicio desc limit 1000)x),'[]'::jsonb));
end $$;
create function public.tn_painel_operacao(redacao_id uuid) returns jsonb language sql security invoker set search_path='' as $$select radar_internal.painel_operacao(redacao_id)$$;
revoke execute on function radar_internal.painel_operacao(uuid),public.tn_painel_operacao(uuid) from public,anon,service_role;
grant execute on function radar_internal.painel_operacao(uuid),public.tn_painel_operacao(uuid) to authenticated;

-- O coletor consulta somente URLs já registradas da fonte; não lê dados de usuários.
create function radar_internal.urls_coletadas(f uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='Identidade interna obrigatória.';end if;
 return coalesce((select jsonb_agg(url_fonte) from radar.pautas where fonte_id=f),'[]'::jsonb);
end $$;
create function public.tn_coletor_urls_conhecidas(fonte_id uuid) returns jsonb language sql security invoker set search_path='' as $$select radar_internal.urls_coletadas(fonte_id)$$;
revoke execute on function radar_internal.urls_coletadas(uuid),public.tn_coletor_urls_conhecidas(uuid) from public,anon,authenticated;
grant usage on schema radar_internal to service_role;
grant execute on function radar_internal.urls_coletadas(uuid),public.tn_coletor_urls_conhecidas(uuid) to service_role;
commit;
