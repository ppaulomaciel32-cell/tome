-- Modo Gestão v1: tarefas compartilhadas e auditoria sem dados simulados.
create type radar.status_tarefa_gestao as enum ('pendente','concluida','adiada');

create table radar.tarefas_gestao (
 id uuid primary key default gen_random_uuid(),
 redacao_id uuid not null references radar.redacoes(id),
 titulo text not null check (length(btrim(titulo)) between 3 and 300),
 categoria text not null check (categoria in ('Prioridade','Faculdade','Adapta','Rotina','Organização e Extras','Compromissos','Saúde')),
 frente text not null default 'grupo' check (frente in ('grupo','agencia','jornal','marca_pessoal')),
 cliente text,
 prazo date,
 prioridade boolean not null default false,
 status radar.status_tarefa_gestao not null default 'pendente',
 nota text not null check (length(btrim(nota)) between 3 and 20000),
 criada_por uuid not null references radar.usuarios(id),
 atualizada_por uuid not null references radar.usuarios(id),
 criada_em timestamptz not null default now(),
 atualizada_em timestamptz not null default now(),
 concluida_em timestamptz,
 unique (redacao_id,id),
 check ((status='concluida' and concluida_em is not null) or (status<>'concluida' and concluida_em is null))
);
create index tarefas_gestao_fila on radar.tarefas_gestao(redacao_id,status,prioridade desc,prazo nulls last,criada_em desc);

create table radar.eventos_gestao (
 id bigint generated always as identity primary key,
 redacao_id uuid not null references radar.redacoes(id),
 tarefa_id uuid,
 acao text not null check (acao in ('criar','concluir','reabrir','adiar')),
 autor_id uuid not null references radar.usuarios(id),
 nota text not null check (length(btrim(nota)) between 3 and 20000),
 snapshot jsonb not null,
 ocorrido_em timestamptz not null default now(),
 foreign key (redacao_id,tarefa_id) references radar.tarefas_gestao(redacao_id,id)
);
create index eventos_gestao_redacao on radar.eventos_gestao(redacao_id,id desc);

alter table radar.tarefas_gestao enable row level security;
alter table radar.tarefas_gestao force row level security;
alter table radar.eventos_gestao enable row level security;
alter table radar.eventos_gestao force row level security;
revoke all on radar.tarefas_gestao,radar.eventos_gestao from public,anon,authenticated,service_role;
create policy sem_acesso_direto on radar.tarefas_gestao for all to anon,authenticated using(false) with check(false);
create policy sem_acesso_direto on radar.eventos_gestao for all to anon,authenticated using(false) with check(false);
create index tarefas_gestao_criada_por_fk on radar.tarefas_gestao(criada_por);
create index tarefas_gestao_atualizada_por_fk on radar.tarefas_gestao(atualizada_por);
create index eventos_gestao_tarefa_fk on radar.eventos_gestao(redacao_id,tarefa_id);
create index eventos_gestao_autor_fk on radar.eventos_gestao(autor_id);

create function radar_internal.painel_gestao(r uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid; papel radar.papel; resultado jsonb;
begin
 u:=radar_internal.exigir_papel(r,array['editor_chefe','redator','leitor']::radar.papel[]);
 select m.papel into papel from radar.membros_redacao m where m.redacao_id=r and m.usuario_id=u;
 select jsonb_build_object(
  'agente',coalesce((select jsonb_build_object('nome',a.nome,'slug',a.slug,'versao',a.versao,'ativo',a.ativo,'configuracao',a.configuracao,'atualizado_em',a.atualizado_em) from radar.agentes_gestao a where a.redacao_id=r and a.slug='executor-autonomo-gestao' limit 1),'null'::jsonb),
  'papel',papel,
  'tarefas',coalesce((select jsonb_agg(to_jsonb(t) order by t.prioridade desc,t.prazo nulls last,t.criada_em desc) from (select id,titulo,categoria,frente,cliente,prazo,prioridade,status,nota,criada_em,atualizada_em,concluida_em from radar.tarefas_gestao where redacao_id=r) t),'[]'::jsonb),
  'eventos',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id,tarefa_id,acao,autor_id,nota,ocorrido_em from radar.eventos_gestao where redacao_id=r order by id desc limit 50) e),'[]'::jsonb),
  'servidor_em',now()
 ) into resultado;
 return resultado;
end $$;

create function radar_internal.comando_gestao(r uuid,tarefa uuid,acao text,dados jsonb,justificativa text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; registro radar.tarefas_gestao; novo_status radar.status_tarefa_gestao;
begin
 u:=radar_internal.exigir_papel(r,array['editor_chefe','redator']::radar.papel[]);
 if length(btrim(coalesce(justificativa,'')))<3 then raise exception using errcode='22023',message='Explique o motivo da ação.';end if;
 if acao='criar' then
  if length(btrim(coalesce(dados->>'titulo','')))<3 then raise exception using errcode='22023',message='Informe uma tarefa válida.';end if;
  insert into radar.tarefas_gestao(redacao_id,titulo,categoria,frente,cliente,prazo,prioridade,nota,criada_por,atualizada_por)
  values(r,btrim(dados->>'titulo'),coalesce(nullif(dados->>'categoria',''),'Prioridade'),coalesce(nullif(dados->>'frente',''),'grupo'),nullif(btrim(dados->>'cliente'),''),nullif(dados->>'prazo','')::date,coalesce((dados->>'prioridade')::boolean,false),btrim(justificativa),u,u)
  returning * into registro;
 else
  select * into registro from radar.tarefas_gestao where redacao_id=r and id=tarefa for update;
  if not found then raise exception using errcode='P0002',message='Tarefa não encontrada.';end if;
  novo_status:=case acao when 'concluir' then 'concluida' when 'adiar' then 'adiada' when 'reabrir' then 'pendente' else null end;
  if novo_status is null then raise exception using errcode='22023',message='Ação de gestão inválida.';end if;
  update radar.tarefas_gestao set status=novo_status,nota=btrim(justificativa),atualizada_por=u,atualizada_em=now(),concluida_em=case when novo_status='concluida' then now() else null end where redacao_id=r and id=tarefa returning * into registro;
 end if;
 insert into radar.eventos_gestao(redacao_id,tarefa_id,acao,autor_id,nota,snapshot) values(r,registro.id,acao,u,btrim(justificativa),to_jsonb(registro));
 return to_jsonb(registro);
end $$;

create function public.tn_painel_gestao(redacao_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.painel_gestao(redacao_id) $$;
create function public.tn_comando_gestao(redacao_id uuid,tarefa_id uuid,acao text,dados jsonb,nota text) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.comando_gestao(redacao_id,tarefa_id,acao,dados,nota) $$;
revoke execute on function public.tn_painel_gestao(uuid),public.tn_comando_gestao(uuid,uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.tn_painel_gestao(uuid),public.tn_comando_gestao(uuid,uuid,text,jsonb,text) to authenticated;
