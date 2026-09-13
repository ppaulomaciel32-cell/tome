-- Preserva a latência medida e o início real, incluindo espera exigida por robots.txt.
create or replace function public.tn_coletor_registrar_coleta(dados jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' and session_user<>'postgres' then
  raise exception using errcode='42501',message='Identidade interna obrigatória.';
 end if;
 insert into radar.coletas(redacao_id,fonte_id,inicio,fim,status,documentos_lidos,candidatos_criados,duplicados,itens_brutos,itens_novos,erros,latencia_ms)
 values((dados->>'redacao_id')::uuid,(dados->>'fonte_id')::uuid,
 coalesce((dados->>'inicio')::timestamptz,now()-coalesce((dados->>'latencia_ms')::int,0)*interval '1 millisecond'),
 coalesce((dados->>'fim')::timestamptz,now()),
 case when dados->>'status' in ('sucesso','parcial','concluida') then 'concluida' else 'falhou' end,
 coalesce((dados->>'documentos_lidos')::int,0),coalesce((dados->>'candidatos_criados')::int,0),coalesce((dados->>'duplicados')::int,0),
 coalesce((dados->>'itens_brutos')::int,0),coalesce((dados->>'itens_novos')::int,0),coalesce((dados->>'erros')::int,0),(dados->>'latencia_ms')::int);
end $$;
revoke execute on function public.tn_coletor_registrar_coleta(jsonb) from public,anon,authenticated;
grant execute on function public.tn_coletor_registrar_coleta(jsonb) to service_role;

-- Ajusta apenas o timeout do job existente; mantém URL, autorização e cadência.
-- Nenhum segredo é lido pelo cliente ou incluído na migração.
do $$ declare j record; begin
 for j in select jobid,command from cron.job where jobname='radar-coletor-cada-15-minutos' loop
  if j.command ~ 'timeout_milliseconds\s*[:=]+\s*120000' then
   perform cron.alter_job(j.jobid,command:=regexp_replace(j.command,'(timeout_milliseconds\s*[:=]+\s*)120000','\1150000'));
  end if;
 end loop;
end $$;
