-- Public reader for the Tome Nota News site; the private radar schema is separate.
create table if not exists public.tomenota_publications (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(trim(title)) between 5 and 180),
  summary text not null default '' check (char_length(summary) <= 500),
  body text not null check (char_length(trim(body)) between 1 and 40000),
  city text not null default 'São Gonçalo do Amarante' check (char_length(city) <= 100),
  section text not null default 'noticias' check (section in ('noticias', 'vagas', 'comunidade', 'eleicoes', 'servicos')),
  cover_url text check (cover_url is null or cover_url ~ '^https://'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or published_at is not null)
);
create index if not exists tomenota_publications_published_idx on public.tomenota_publications (published_at desc) where status = 'published';
alter table public.tomenota_publications enable row level security;
revoke all on table public.tomenota_publications from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select (slug, title, summary, body, city, section, cover_url, published_at) on table public.tomenota_publications to anon, authenticated;
drop policy if exists "published Tome Nota stories are public" on public.tomenota_publications;
create policy "published Tome Nota stories are public" on public.tomenota_publications
  for select to anon, authenticated
  using (status = 'published' and published_at <= now());
comment on table public.tomenota_publications is 'Approved public Tome Nota website content. Radar collection data is not exposed here.';
