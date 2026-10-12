-- Somente a redação nova. Não altera publicações, políticas existentes ou Radar.
begin;

create table public.ciclo_log (
  id uuid primary key,
  janela bigint not null unique,
  status text not null check (status in ('running','completed','skipped','failed')),
  etapa text not null check (etapa in ('inicio','coleta','redacao','rascunho','previa','fim')),
  codigo text not null default '' check (codigo ~ '^[a-z0-9_]{0,60}$'),
  duracao_ms integer not null default 0 check (duracao_ms between 0 and 900000),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.rascunhos (
  id uuid primary key,
  ciclo_id uuid not null unique references public.ciclo_log(id),
  slug text not null check (length(slug) between 3 and 240 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  titulo text not null check (length(titulo) between 3 and 300),
  resumo text not null check (length(resumo) between 10 and 500),
  texto text not null check (length(texto) between 100 and 20000),
  localidade text not null check (localidade in ('sao-goncalo','pecem','taiba','croata','paracuru','regiao')),
  fontes jsonb not null check (jsonb_typeof(fontes) = 'array' and jsonb_array_length(fontes) between 2 and 5),
  evidencias jsonb not null check (jsonb_typeof(evidencias) = 'array' and jsonb_array_length(evidencias) between 6 and 14),
  author text not null default 'Redação Tome Nota' check (author = 'Redação Tome Nota'),
  publisher text not null default 'Tome Nota News' check (publisher = 'Tome Nota News'),
  gerada_por text not null default 'ia' check (gerada_por = 'ia'),
  status text not null default 'draft' check (status = 'draft'),
  revisao integer not null default 1 check (revisao = 1),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index rascunhos_criado_idx on public.rascunhos (criado_em desc);
create index ciclo_log_criado_idx on public.ciclo_log (criado_em desc);

create table public.noticias_vistas (
  hash text primary key check (hash ~ '^[a-f0-9]{64}$'),
  tipo text not null check (tipo in ('url','titulo')),
  titulo text not null check (length(titulo) between 3 and 500),
  rascunho_id uuid not null references public.rascunhos(id),
  criado_em timestamptz not null default now()
);
create index noticias_vistas_criado_idx on public.noticias_vistas (criado_em desc);

alter table public.ciclo_log enable row level security;
alter table public.rascunhos enable row level security;
alter table public.noticias_vistas enable row level security;
revoke all on public.ciclo_log, public.rascunhos, public.noticias_vistas from public, anon, authenticated;
grant select, insert, update on public.ciclo_log to service_role;
grant select, insert on public.rascunhos, public.noticias_vistas to service_role;
-- Nenhuma policy de leitura pública ou de escrita por usuário logado.

create function public.tnn_drafts_begin(p_id uuid, p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_window bigint := floor(extract(epoch from now()) / 1200); v_count integer;
begin
  if p_max_pending not between 1 and 10 then raise exception 'invalid_limit'; end if;
  perform pg_advisory_xact_lock(84621, 2);
  if exists(select 1 from public.ciclo_log where id = p_id and janela = v_window and status = 'running') then
    return jsonb_build_object('started', true, 'id', p_id);
  end if;
  if exists(select 1 from public.ciclo_log where janela = v_window) then
    return jsonb_build_object('started', false, 'reason', 'cycle_exists');
  end if;
  select count(*) into v_count from public.rascunhos where status = 'draft';
  if v_count >= p_max_pending then return jsonb_build_object('started', false, 'reason', 'queue_full'); end if;
  insert into public.ciclo_log(id, janela, status, etapa) values(p_id, v_window, 'running', 'inicio');
  return jsonb_build_object('started', true, 'id', p_id);
end $$;

create function public.tnn_drafts_save(p_cycle uuid, p_draft jsonb, p_seen jsonb, p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_existing uuid; v_id uuid := (p_draft->>'id')::uuid;
begin
  if p_max_pending not between 1 and 10 or jsonb_typeof(p_seen) <> 'array'
    or jsonb_array_length(p_seen) not between 3 and 6 then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(84621, 2);
  select id into v_existing from public.rascunhos where ciclo_id = p_cycle;
  if v_existing is not null then return jsonb_build_object('saved', true, 'id', v_existing, 'replayed', true); end if;
  if not exists(select 1 from public.ciclo_log where id = p_cycle and status = 'running') then raise exception 'cycle_not_running'; end if;
  if (select count(*) from public.rascunhos where status = 'draft') >= p_max_pending then
    return jsonb_build_object('saved', false, 'reason', 'queue_full');
  end if;
  if exists(select 1 from public.noticias_vistas n join jsonb_array_elements(p_seen) s on n.hash = s->>'hash') then
    return jsonb_build_object('saved', false, 'reason', 'already_seen');
  end if;
  insert into public.rascunhos(id, ciclo_id, slug, titulo, resumo, texto, localidade, fontes, evidencias)
  values(v_id, p_cycle, p_draft->>'slug', p_draft->>'titulo', p_draft->>'resumo', p_draft->>'texto',
    p_draft->>'localidade', p_draft->'fontes', p_draft->'evidencias');
  insert into public.noticias_vistas(hash, tipo, titulo, rascunho_id)
    select s->>'hash', s->>'tipo', s->>'titulo', v_id from jsonb_array_elements(p_seen) s;
  update public.ciclo_log set etapa = 'rascunho', atualizado_em = now() where id = p_cycle;
  return jsonb_build_object('saved', true, 'id', v_id, 'replayed', false);
end $$;

revoke all on function public.tnn_drafts_begin(uuid, integer), public.tnn_drafts_save(uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tnn_drafts_begin(uuid, integer), public.tnn_drafts_save(uuid, jsonb, jsonb, integer) to service_role;
commit;
