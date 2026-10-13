-- Somente o agente TomeZap. Versão alinhada ao histórico remoto após apply_migration.
-- Publicações e suas policies existentes ficam intactas.
begin;
create table public.aprovacoes (
  rascunho_id uuid primary key references public.rascunhos(id),
  revisao integer not null check(revisao=1),
  decisao text not null check(decisao in ('approve','reject')),
  mensagem_hash text not null unique check(mensagem_hash ~ '^[a-f0-9]{64}$'),
  editor_hash text not null check(editor_hash ~ '^[a-f0-9]{64}$'),
  publicacao jsonb,
  criado_em timestamptz not null default now()
);
alter table public.aprovacoes enable row level security;
revoke all on public.aprovacoes from public,anon,authenticated;
grant select,insert on public.aprovacoes to service_role;

create view public.tnn_pending_drafts with(security_invoker=true) as
select r.id,r.ciclo_id,r.slug,r.titulo,r.resumo,r.localidade,r.status,r.revisao,r.criado_em
from public.rascunhos r where not exists(select 1 from public.aprovacoes a where a.rascunho_id=r.id);
revoke all on public.tnn_pending_drafts from public,anon,authenticated;
grant select on public.tnn_pending_drafts to service_role;

create function public.tnn_manual_begin(p_id uuid,p_receipt text,p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w bigint;
begin
  if p_receipt !~ '^[a-f0-9]{64}$' or p_max_pending not between 1 and 10 then raise exception 'invalid_input'; end if;
  w := -(('x'||substring(p_receipt,1,15))::bit(60)::bigint)-1;
  perform pg_advisory_xact_lock(84621,2);
  if exists(select 1 from public.ciclo_log where id=p_id and janela=w) then
    update public.ciclo_log set status='running',atualizado_em=now() where id=p_id;
    return jsonb_build_object('started',true,'id',p_id);
  end if;
  if exists(select 1 from public.ciclo_log where janela=w) then return jsonb_build_object('started',false,'reason','already_seen'); end if;
  if (select count(*) from public.tnn_pending_drafts)>=p_max_pending then return jsonb_build_object('started',false,'reason','queue_full'); end if;
  insert into public.ciclo_log(id,janela,status,etapa) values(p_id,w,'running','inicio');
  return jsonb_build_object('started',true,'id',p_id);
end $$;

-- A fila considera só rascunhos ainda sem decisão; não altera sua imutabilidade.
create or replace function public.tnn_drafts_begin(p_id uuid,p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w bigint:=floor(extract(epoch from now())/1200);
begin
  if p_max_pending not between 1 and 10 then raise exception 'invalid_limit'; end if;
  perform pg_advisory_xact_lock(84621,2);
  if exists(select 1 from public.ciclo_log where id=p_id and janela=w and status='running') then return jsonb_build_object('started',true,'id',p_id); end if;
  if exists(select 1 from public.ciclo_log where janela=w) then return jsonb_build_object('started',false,'reason','cycle_exists'); end if;
  if (select count(*) from public.tnn_pending_drafts)>=p_max_pending then return jsonb_build_object('started',false,'reason','queue_full'); end if;
  insert into public.ciclo_log(id,janela,status,etapa) values(p_id,w,'running','inicio');
  return jsonb_build_object('started',true,'id',p_id);
end $$;

create or replace function public.tnn_drafts_save(p_cycle uuid,p_draft jsonb,p_seen jsonb,p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_id uuid; draft_id uuid:=(p_draft->>'id')::uuid;
begin
  if p_max_pending not between 1 and 10 or jsonb_typeof(p_seen)<>'array' or jsonb_array_length(p_seen) not between 3 and 6 then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(84621,2);
  select id into old_id from public.rascunhos where ciclo_id=p_cycle;
  if old_id is not null then return jsonb_build_object('saved',true,'id',old_id,'replayed',true); end if;
  if not exists(select 1 from public.ciclo_log where id=p_cycle and status='running') then raise exception 'cycle_not_running'; end if;
  if (select count(*) from public.tnn_pending_drafts)>=p_max_pending then return jsonb_build_object('saved',false,'reason','queue_full'); end if;
  if exists(select 1 from public.noticias_vistas n join jsonb_array_elements(p_seen) s on n.hash=s->>'hash') then return jsonb_build_object('saved',false,'reason','already_seen'); end if;
  insert into public.rascunhos(id,ciclo_id,slug,titulo,resumo,texto,localidade,fontes,evidencias)
    values(draft_id,p_cycle,p_draft->>'slug',p_draft->>'titulo',p_draft->>'resumo',p_draft->>'texto',p_draft->>'localidade',p_draft->'fontes',p_draft->'evidencias');
  insert into public.noticias_vistas(hash,tipo,titulo,rascunho_id) select s->>'hash',s->>'tipo',s->>'titulo',draft_id from jsonb_array_elements(p_seen) s;
  update public.ciclo_log set etapa='rascunho',atualizado_em=now() where id=p_cycle;
  return jsonb_build_object('saved',true,'id',draft_id,'replayed',false);
end $$;

-- Decisão e notícia são uma única transação. Executável somente pela Edge.
create function public.tnn_editorial_decide(p_id uuid,p_revision integer,p_receipt text,p_editor text,p_decision text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.rascunhos%rowtype; a public.aprovacoes%rowtype; result jsonb; fingerprint text; sources jsonb;
begin
  if p_revision<>1 or p_receipt !~ '^[a-f0-9]{64}$' or p_editor !~ '^[a-f0-9]{64}$' or p_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  perform pg_advisory_xact_lock(84621,2);
  if exists(select 1 from public.aprovacoes where mensagem_hash=p_receipt and rascunho_id<>p_id) then return jsonb_build_object('ok',false,'code','receipt_conflict'); end if;
  -- O advisory lock acima serializa decisões; o rascunho continua sem grant UPDATE.
  select * into r from public.rascunhos where id=p_id;
  if not found then return jsonb_build_object('ok',false,'code','not_found'); end if;
  if r.revisao<>p_revision then return jsonb_build_object('ok',false,'code','revision_conflict'); end if;
  select * into a from public.aprovacoes where rascunho_id=p_id;
  if found then
    if a.decisao<>p_decision then return jsonb_build_object('ok',false,'code','already_decided'); end if;
    return jsonb_build_object('ok',true,'publication',a.publicacao,'replayed',true);
  end if;
  if p_decision='approve' then
    select hash into fingerprint from public.noticias_vistas where rascunho_id=r.id and tipo='titulo' limit 1;
    if fingerprint is null then raise exception 'source_hash_missing'; end if;
    select jsonb_agg(jsonb_build_object('titulo',s->>'title','url',s->>'url','data',s->>'published_date')) into sources from jsonb_array_elements(r.fontes) s;
    result := public.tnn_ingest_agent(jsonb_build_object('job_id',r.id,'revision',r.revisao,'source_hash',fingerprint,
      'slug',r.slug,'titulo',r.titulo,'resumo',r.resumo,'texto',r.texto,'localidade',r.localidade,'gerada_por','ia',
      'cover_url','https://tomezap.com.br/assets/images/og-tome-nota.png','fontes',sources),
      jsonb_build_object('draft_id',r.id,'revision',r.revisao,'approval_receipt',p_receipt));
    if not exists(select 1 from public.tomenota_publications where id=(result->>'id')::uuid and agent_job_id=r.id) then raise exception 'already_published_by_another_job'; end if;
  end if;
  insert into public.aprovacoes(rascunho_id,revisao,decisao,mensagem_hash,editor_hash,publicacao) values(r.id,r.revisao,p_decision,p_receipt,p_editor,result);
  return jsonb_build_object('ok',true,'publication',result,'replayed',false);
end $$;
revoke all on function public.tnn_manual_begin(uuid,text,integer),public.tnn_editorial_decide(uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.tnn_manual_begin(uuid,text,integer),public.tnn_editorial_decide(uuid,integer,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
