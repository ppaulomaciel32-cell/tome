-- Only the new public contact table; no access to private systems.
begin;
create table if not exists public.mensagens_contato (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 2 and 100),
  email text not null check (char_length(btrim(email)) between 5 and 120
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  mensagem text not null check (char_length(btrim(mensagem)) between 10 and 2000),
  criado_em timestamptz not null default now()
);
alter table public.mensagens_contato enable row level security;
alter table public.mensagens_contato
  drop constraint if exists contato_nome_tamanho_real,
  drop constraint if exists contato_mensagem_tamanho_real;
alter table public.mensagens_contato
  add constraint contato_nome_tamanho_real check (char_length(nome) <= 100),
  add constraint contato_mensagem_tamanho_real check (char_length(mensagem) <= 2000);
revoke all on public.mensagens_contato from public, anon, authenticated;
grant insert (nome, email, mensagem) on public.mensagens_contato to anon;
drop policy if exists contato_anon_insert on public.mensagens_contato;
create policy contato_anon_insert on public.mensagens_contato
for insert to anon with check (
  char_length(btrim(nome)) between 2 and 100
  and char_length(nome) <= 100
  and char_length(btrim(email)) between 5 and 120
  and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  and char_length(btrim(mensagem)) between 10 and 2000
  and char_length(mensagem) <= 2000
);
commit;
