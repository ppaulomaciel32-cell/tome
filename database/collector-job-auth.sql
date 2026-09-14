begin;
-- Credencial exclusiva gerada no banco; nunca retorna ao cliente.
do $$ begin
 if not exists(select 1 from vault.secrets where name='radar_collector_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'radar_collector_token','Autorização exclusiva do agendador Radar');
 end if;
end $$;
create function radar_internal.autorizar_coletor(chave text) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='Identidade interna obrigatória.';end if;
 if chave is null or length(chave)<>64 then return false;end if;
 return exists(select 1 from vault.decrypted_secrets where name='radar_collector_token' and extensions.digest(decrypted_secret,'sha256')=extensions.digest(chave,'sha256'));
end $$;
create function public.tn_coletor_autorizar(chave text) returns boolean language sql security invoker set search_path='' as $$select radar_internal.autorizar_coletor(chave)$$;
revoke execute on function radar_internal.autorizar_coletor(text),public.tn_coletor_autorizar(text) from public,anon,authenticated;
grant execute on function radar_internal.autorizar_coletor(text),public.tn_coletor_autorizar(text) to service_role;
do $$ declare j record; changed text; begin
 for j in select jobid,command from cron.job where jobname='radar-coletor-cada-15-minutos' loop
  if position('X-Radar-Collector' in j.command)=0 then
   changed:=regexp_replace(j.command,'(headers\s*[:=]+\s*jsonb_build_object\()',E'\\1''X-Radar-Collector'', (select decrypted_secret from vault.decrypted_secrets where name=''radar_collector_token''), ');
   if changed=j.command then raise exception 'Estrutura do agendador não reconhecida';end if;
   perform cron.alter_job(j.jobid,command:=changed);
  end if;
 end loop;
end $$;
commit;
