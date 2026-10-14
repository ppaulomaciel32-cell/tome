-- Somente o agente TomeZap. Aceita rascunho com fonte única (oficial ou material do editor).
-- Não toca em publicações, policies existentes nem no Radar.
begin;
alter table public.rascunhos drop constraint rascunhos_fontes_check;
alter table public.rascunhos add constraint rascunhos_fontes_check
  check (jsonb_typeof(fontes) = 'array' and jsonb_array_length(fontes) between 1 and 5);

create or replace function public.tnn_drafts_save(p_cycle uuid,p_draft jsonb,p_seen jsonb,p_max_pending integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_id uuid; draft_id uuid:=(p_draft->>'id')::uuid;
begin
  if p_max_pending not between 1 and 10 or jsonb_typeof(p_seen)<>'array' or jsonb_array_length(p_seen) not between 2 and 6 then raise exception 'invalid_input'; end if;
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
notify pgrst,'reload schema';
commit;
