-- Run as the SQL editor owner. All fixtures are rolled back, never published.
begin;
set local statement_timeout = '10s';
insert into public.tomenota_publications (slug, title, summary, body, status, published_at)
values
  ('tnn-rls-fixture-publicada-20261008', 'Materia publicada de teste', 'Resumo usado apenas no teste SQL.', 'Texto da fixture transacional.', 'published', now() - interval '1 hour'),
  ('tnn-rls-fixture-rascunho-20261008', 'Materia em rascunho de teste', 'Resumo usado apenas no teste SQL.', 'Texto da fixture transacional.', 'draft', null),
  ('tnn-rls-fixture-agendada-20261008', 'Materia agendada de teste', 'Resumo usado apenas no teste SQL.', 'Texto da fixture transacional.', 'published', now() + interval '1 day');

set local role anon;
do $$
begin
  if (select count(*) from public.tomenota_publications where slug like 'tnn-rls-fixture-%-20261008') <> 1 then
    raise exception 'FAIL: anon must see only the already-published fixture';
  end if;
  if (select count(*) from public.tomenota_publications where status = 'draft') <> 0 then
    raise exception 'FAIL: a draft is visible to anon';
  end if;
  if exists (select 1 from public.tomenota_publications where slug = 'tnn-rls-fixture-agendada-20261008') then
    raise exception 'FAIL: scheduled article is visible before its date';
  end if;
  begin
    insert into public.tomenota_publications (slug,title,summary,body)
    values ('tnn-rls-fixture-insert-20261008','Tentativa anonima','Resumo valido para testar permissoes.','Texto valido.');
    raise exception 'FAIL: anon INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.tomenota_publications set title='Alteracao indevida' where slug='tnn-rls-fixture-publicada-20261008';
    raise exception 'FAIL: anon UPDATE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.tomenota_publications where slug='tnn-rls-fixture-publicada-20261008';
    raise exception 'FAIL: anon DELETE unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: published visible; draft/scheduled hidden; INSERT/UPDATE/DELETE rejected with 42501' as result;
rollback;
