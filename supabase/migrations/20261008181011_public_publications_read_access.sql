-- Only the public publications table. No policy is dropped or weakened.
-- Existing RLS: status='published' AND published_at <= now().
alter table public.tomenota_publications enable row level security;
revoke all on public.tomenota_publications from anon;
grant select on public.tomenota_publications to anon;

do $$
begin
  if has_table_privilege('anon','public.tomenota_publications','INSERT,UPDATE,DELETE,TRUNCATE')
     or has_any_column_privilege('anon','public.tomenota_publications','INSERT,UPDATE') then
    raise exception 'Unexpected inherited anonymous write privileges; aborting';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='tomenota_publications'
      and policyname='published Tome Nota stories are public' and cmd='SELECT'
  ) then
    raise exception 'Expected public-read RLS policy is missing; aborting';
  end if;
end $$;
notify pgrst, 'reload schema';
