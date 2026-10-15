-- Somente publicações Tome Nota; preserva todas as policies existentes.
begin;
alter table public.tomenota_publications add column cover_credit text
  check (cover_credit is null or (length(cover_credit) between 2 and 120 and cover_credit !~ '[<>\x01-\x1f]'));

create function public.tnn_copy_cover_credit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.agent_job_id is not null then
    select capa_credito into new.cover_credit from public.rascunhos where id=new.agent_job_id;
  end if;
  return new;
end $$;
revoke all on function public.tnn_copy_cover_credit() from public,anon,authenticated;
grant execute on function public.tnn_copy_cover_credit() to service_role;
create trigger tnn_publication_credit before insert or update of agent_job_id,cover_url
  on public.tomenota_publications for each row execute function public.tnn_copy_cover_credit();

update public.tomenota_publications p set cover_credit=r.capa_credito
  from public.rascunhos r where p.agent_job_id=r.id and r.capa_credito is not null;
notify pgrst,'reload schema';
commit;
