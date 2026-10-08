-- Existing physical columns are title/summary/body; Portuguese names are API aliases.
-- Preflight 2026-10-08: total=0, currently_visible=0, fallback_created_at=0.
-- No column rename, no data deletion, no change to the existing RLS policy.
alter table public.tomenota_publications
  alter column id set default gen_random_uuid(),
  alter column summary drop default,
  drop constraint tomenota_publications_title_check,
  add constraint tomenota_publications_title_check check (char_length(title) between 3 and 300),
  drop constraint tomenota_publications_summary_check,
  add constraint tomenota_publications_summary_check check (char_length(summary) between 10 and 500),
  add constraint tomenota_publications_slug_length_check check (char_length(slug) between 3 and 240),
  add column search tsvector generated always as (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(title,'')), 'A') ||
    setweight(to_tsvector('portuguese'::regconfig, coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('portuguese'::regconfig, coalesce(body,'')), 'C')
  ) stored;

create function public.tnn_publication_timestamps()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status = 'published' and new.published_at is null then
    if tg_op = 'INSERT' then
      new.published_at := now();
    elsif old.status = 'draft' then
      new.published_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.tnn_publication_timestamps() from public, anon, authenticated;
create trigger tnn_publication_timestamps
before insert or update on public.tomenota_publications
for each row execute function public.tnn_publication_timestamps();

create index publications_public_idx on public.tomenota_publications (published_at desc, slug)
  where status = 'published';
create index publications_search_idx on public.tomenota_publications using gin (search);
analyze public.tomenota_publications;
notify pgrst, 'reload schema';
