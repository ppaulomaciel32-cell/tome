-- Radar Viral do jornal: objetos novos com prefixo tnn_viral. Não toca no Radar privado.
begin;
create table public.tnn_viral_runs (
 id uuid primary key, turno text not null check(turno in ('manha','tarde','noite','demanda')),
 status text not null check(status in ('running','completed','failed','skipped')),
 metricas jsonb not null default '{}'::jsonb check(jsonb_typeof(metricas)='object'),
 codigo text not null default '' check(codigo ~ '^[a-z0-9_]{0,60}$'),
 criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table public.tnn_viral_pautas (
 id uuid primary key, numero bigint generated always as identity unique,
 run_id uuid not null references public.tnn_viral_runs(id), dedupe_hash text not null check(dedupe_hash ~ '^[a-f0-9]{64}$'),
 turno text not null check(turno in ('manha','tarde','noite','demanda')),
 cidade text not null check(length(cidade) between 2 and 100),
 localidade text not null check(localidade in ('sao-goncalo','pecem','taiba','croata','paracuru','regiao')),
 gatilho text not null check(gatilho in ('curiosidade-concreta','espanto','identidade-local','utilidade','prova-social','nostalgia','historia-humana','contraste')),
 titulos text[] not null check(array_length(titulos,1)=3), hook text not null check(length(hook) between 10 and 500),
 angulo text not null check(length(angulo) between 10 and 500), fonte_url text not null check(fonte_url ~ '^https://[^[:space:]]+$'),
 fonte_titulo text not null check(length(fonte_titulo) between 3 and 500),
 fonte_trecho text not null check(length(fonte_trecho) between 160 and 12000), fonte_data timestamptz not null,
 potencial integer not null check(potencial between 7 and 10), cover_candidato text,
 score_justificativa text not null check(length(score_justificativa) between 5 and 300),
 status text not null default 'pending' check(status in ('pending','approved','rejected','published','expired')),
 revisao integer not null default 1 check(revisao>=1), rejeicao_motivo text,
 redacao_job_id uuid, published_slug text, decisao_recibo text, titulo_escolhido integer not null default 0 check(titulo_escolhido between 0 and 2),
 criado_em timestamptz not null default now(), resolvido_em timestamptz
);
create index tnn_viral_pending_idx on public.tnn_viral_pautas(status,criado_em desc);
create index tnn_viral_dedupe_idx on public.tnn_viral_pautas(dedupe_hash,criado_em desc);
create unique index tnn_viral_job_idx on public.tnn_viral_pautas(redacao_job_id) where redacao_job_id is not null;
alter table public.tnn_viral_runs enable row level security;
alter table public.tnn_viral_pautas enable row level security;
revoke all on public.tnn_viral_runs,public.tnn_viral_pautas from public,anon,authenticated;
revoke all on sequence public.tnn_viral_pautas_numero_seq from public,anon,authenticated;
grant select,insert,update on public.tnn_viral_runs,public.tnn_viral_pautas to service_role;
grant usage,select on sequence public.tnn_viral_pautas_numero_seq to service_role;

-- Consulta anterior ao Gemini: notícias já cobertas não gastam outra geração.
create function public.tnn_viral_seen(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>150 then raise exception 'invalid_input';end if;
 return coalesce((select jsonb_agg(distinct row->>'hash') from jsonb_array_elements(p_rows) row
 where exists(select 1 from public.tnn_viral_pautas v where v.criado_em>now()-interval '72 hours' and (v.dedupe_hash=row->>'hash' or v.fonte_url=row->>'url'))
 or exists(select 1 from public.tomenota_publications p where p.published_at>now()-interval '72 hours' and
 (p.source_hash=row->>'hash' or p.fontes @> jsonb_build_array(jsonb_build_object('url',row->>'url'))))), '[]'::jsonb);
end $$;

create function public.tnn_viral_save(p_run uuid,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare row jsonb; saved jsonb:='[]'::jsonb; item public.tnn_viral_pautas%rowtype;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>3 then raise exception 'invalid_input';end if;
 perform pg_advisory_xact_lock(84621,9);
 for row in select value from jsonb_array_elements(p_rows) loop
   select * into item from public.tnn_viral_pautas where id=(row->>'id')::uuid;
   if found then saved:=saved||jsonb_build_array(to_jsonb(item));continue;end if;
   if exists(select 1 from public.tnn_viral_pautas where dedupe_hash=row->>'dedupe_hash' and criado_em>now()-interval '72 hours') then continue;end if;
   if exists(select 1 from public.tomenota_publications where published_at>now()-interval '72 hours' and (source_hash=row->>'dedupe_hash' or fontes @> jsonb_build_array(jsonb_build_object('url',row->>'fonte_url')))) then continue;end if;
   insert into public.tnn_viral_pautas(id,run_id,dedupe_hash,turno,cidade,localidade,gatilho,titulos,hook,angulo,fonte_url,fonte_titulo,fonte_trecho,fonte_data,potencial,cover_candidato,score_justificativa)
   values((row->>'id')::uuid,p_run,row->>'dedupe_hash',row->>'turno',row->>'cidade',row->>'localidade',row->>'gatilho',
     array(select jsonb_array_elements_text(row->'titulos')),row->>'hook',row->>'angulo',row->>'fonte_url',row->>'fonte_titulo',row->>'fonte_trecho',(row->>'fonte_data')::timestamptz,
     (row->>'potencial')::integer,row->>'cover_candidato',row->>'score_justificativa') returning * into item;
   saved:=saved||jsonb_build_array(to_jsonb(item));
 end loop;
 return saved;
end $$;

create function public.tnn_viral_decide(p_id uuid,p_revision integer,p_action text,p_receipt text,p_edit jsonb default null,p_title integer default 0,p_reason text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.tnn_viral_pautas%rowtype;
begin
 if p_action not in ('approve','reject','correct') or p_receipt !~ '^[a-f0-9]{64}$' or p_title not between 0 and 2 or length(p_reason)>1000 then raise exception 'invalid_input';end if;
 select * into r from public.tnn_viral_pautas where id=p_id for update;
 if not found then return jsonb_build_object('code','not_found');end if;
 if r.decisao_recibo=p_receipt then return jsonb_build_object('ok',true,'item',to_jsonb(r),'duplicate',true);end if;
 if r.status<>'pending' or r.revisao<>p_revision then return jsonb_build_object('code','revision_conflict');end if;
 if r.fonte_data<now()-interval '24 hours' then
   update public.tnn_viral_pautas set status='expired',resolvido_em=now() where id=r.id;
   return jsonb_build_object('code','expired');
 end if;
 if p_action='correct' then
   if p_edit is null then raise exception 'invalid_input';end if;
   update public.tnn_viral_pautas set titulos=array(select jsonb_array_elements_text(p_edit->'titulos')),
    hook=p_edit->>'hook',angulo=p_edit->>'angulo',gatilho=p_edit->>'gatilho',potencial=(p_edit->>'potencial')::integer,
    score_justificativa=p_edit->>'score_justificativa',revisao=revisao+1,decisao_recibo=p_receipt where id=r.id returning * into r;
 else
   update public.tnn_viral_pautas set status=case when p_action='approve' then 'approved' else 'rejected' end,
    titulo_escolhido=p_title,rejeicao_motivo=case when p_action='reject' then left(p_reason,500) end,
    decisao_recibo=p_receipt,resolvido_em=now() where id=r.id returning * into r;
 end if;
 return jsonb_build_object('ok',true,'item',to_jsonb(r));
end $$;

create function public.tnn_viral_sync() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 update public.tnn_viral_pautas v set status='published',published_slug=p.slug
 from public.rascunhos d join public.tomenota_publications p on p.agent_job_id=d.id
 where v.redacao_job_id=d.ciclo_id and v.status='approved' and p.status='published' and p.published_at<=now();
 get diagnostics changed=row_count;
 update public.tnn_viral_pautas set status='expired',resolvido_em=now() where status='pending' and fonte_data<now()-interval '36 hours';
 return jsonb_build_object('updated',changed);
end $$;
revoke all on function public.tnn_viral_seen(jsonb),public.tnn_viral_save(uuid,jsonb),public.tnn_viral_decide(uuid,integer,text,text,jsonb,integer,text),public.tnn_viral_sync() from public,anon,authenticated;
grant execute on function public.tnn_viral_seen(jsonb),public.tnn_viral_save(uuid,jsonb),public.tnn_viral_decide(uuid,integer,text,text,jsonb,integer,text),public.tnn_viral_sync() to service_role;
notify pgrst,'reload schema';
commit;
