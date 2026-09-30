-- Public publication fields only; existing RLS policies are unchanged.
begin;
alter table public.tomenota_publications
  add column if not exists author text not null default 'Tome Nota News',
  add column if not exists publisher text not null default 'Tome Nota News';
grant select (id, author, publisher) on public.tomenota_publications to anon;
commit;

