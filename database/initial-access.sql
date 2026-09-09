-- Reserva do primeiro editor-chefe. Não cria conta Auth nem envia e-mail.
create table radar.acessos_iniciais (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null unique references radar.redacoes(id),
 email text not null check(email=lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 papel radar.papel not null default 'editor_chefe' check(papel='editor_chefe'),
 situacao text not null default 'aguardando' check(situacao in ('aguardando','utilizado','revogado')),
 nota_autorizacao text not null check(length(btrim(nota_autorizacao))>0),
 registrada_em timestamptz not null default now(), utilizada_por uuid references radar.usuarios(id), utilizada_em timestamptz,
 check((situacao='utilizado' and utilizada_por is not null and utilizada_em is not null) or (situacao<>'utilizado' and utilizada_por is null and utilizada_em is null))
);
alter table radar.acessos_iniciais enable row level security;
revoke all on radar.acessos_iniciais from public,anon,authenticated,service_role;
create policy sem_acesso_direto on radar.acessos_iniciais for all to anon,authenticated using(false) with check(false);

create function radar_internal.evento_acesso(r uuid,acao text,u uuid,nota text,conteudo jsonb) returns void
language plpgsql set search_path='' as $$
declare anterior text; eid uuid:=gen_random_uuid(); instante timestamptz:=clock_timestamp();
begin
 perform pg_advisory_xact_lock(hashtextextended(r::text,13));
 select hash_evento into anterior from radar.eventos where redacao_id=r order by sequencia desc limit 1;
 insert into radar.eventos(id,redacao_id,acao,autor_tipo,autor_id,ocorrido_em,nota,snapshot,hash_anterior,hash_evento)
 values(eid,r,acao,case when u is null then 'sistema' else 'usuario' end,u,instante,nota,conteudo,anterior,
 radar_internal.hash_texto(jsonb_build_array(anterior,eid,r,null,acao,u,instante,null,nota,conteudo)::text));
end $$;

create function radar_internal.ativar_acesso() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); claims jsonb:=auth.jwt(); sid uuid; email_confirmado text; a radar.acessos_iniciais; r uuid;
begin
 if u is null then raise exception using errcode='28000',message='Sessão obrigatória.';end if;
 begin sid:=(claims->>'session_id')::uuid;exception when invalid_text_representation then raise exception using errcode='28000',message='Sessão inválida.';end;
 if sid is null or coalesce((claims->>'exp')::numeric,0)<=extract(epoch from now())
  or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=u and (s.not_after is null or s.not_after>now())) then
  raise exception using errcode='28000',message='Sessão expirada ou revogada.';end if;
 -- O e-mail vem do cadastro confirmado do Auth, nunca de user_metadata ou formulário.
 select lower(x.email) into email_confirmado from auth.users x where x.id=u and x.email_confirmed_at is not null
  and not coalesce(x.is_anonymous,false) and x.deleted_at is null and (x.banned_until is null or x.banned_until<=now());
 if email_confirmado is null then raise exception using errcode='42501',message='Confirme seu e-mail antes de acessar a redação.';end if;
 -- Associação existente nunca é promovida de novo por esta reserva inicial.
 if exists(select 1 from radar.membros_redacao where usuario_id=u) then return radar_internal.contexto();end if;
 for r in select redacao_id from radar.acessos_iniciais where email=email_confirmado and situacao='aguardando' order by redacao_id loop
  perform pg_advisory_xact_lock(hashtextextended(r::text,13));
  select * into a from radar.acessos_iniciais where redacao_id=r and email=email_confirmado and situacao='aguardando' for update;
  if not found then continue;end if;
  if exists(select 1 from radar.membros_redacao m join radar.usuarios x on x.id=m.usuario_id where m.redacao_id=r and m.papel='editor_chefe' and x.ativo) then
   raise exception using errcode='42501',message='O primeiro acesso já foi configurado. Solicite acesso ao editor-chefe.';end if;
  if exists(select 1 from radar.usuarios where id=u and not ativo) then raise exception using errcode='42501',message='Conta editorial desativada.';end if;
  insert into radar.usuarios(id,nome) values(u,email_confirmado) on conflict(id) do nothing;
  insert into radar.membros_redacao(redacao_id,usuario_id,papel) values(r,u,a.papel);
  update radar.acessos_iniciais set situacao='utilizado',utilizada_por=u,utilizada_em=now() where id=a.id returning * into a;
  perform radar_internal.evento_acesso(r,'primeiro_editor_chefe_ativado',u,a.nota_autorizacao,
   jsonb_build_object('autorizacao',to_jsonb(a),'usuario',(select to_jsonb(x) from radar.usuarios x where id=u),
    'associacao',(select to_jsonb(m) from radar.membros_redacao m where redacao_id=r and usuario_id=u)));
 end loop;
 return radar_internal.contexto();
end $$;
create function public.tn_ativar_acesso() returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.ativar_acesso() $$;
revoke execute on function radar_internal.evento_acesso(uuid,text,uuid,text,jsonb),radar_internal.ativar_acesso(),public.tn_ativar_acesso() from public,anon,authenticated,service_role;
grant execute on function radar_internal.ativar_acesso(),public.tn_ativar_acesso() to authenticated;
notify pgrst,'reload schema';
