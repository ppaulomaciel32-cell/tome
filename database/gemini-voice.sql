-- Radar Tome Nota v1: auditoria de comandos de voz interpretados pelo Gemini.
-- O áudio bruto não é persistido; somente transcrição, intenção e argumentos sanitizados.

create table radar.comandos_voz (
  id uuid primary key default gen_random_uuid(),
  redacao_id uuid not null references radar.redacoes(id),
  usuario_id uuid not null references radar.usuarios(id),
  transcricao text not null check(length(btrim(transcricao)) between 1 and 10000),
  intencao text not null check(intencao in ('abrir_dashboard','abrir_radar','abrir_historico','atualizar','buscar','filtrar','criar_pauta','desconhecido')),
  argumentos jsonb not null default '{}',
  modelo text,
  criado_em timestamptz not null default now()
);
create index comandos_voz_redacao_data on radar.comandos_voz(redacao_id,criado_em desc);
create index comandos_voz_usuario on radar.comandos_voz(usuario_id,criado_em desc);

alter table radar.comandos_voz enable row level security;
create policy leitura_comandos_da_redacao on radar.comandos_voz for select to authenticated
using (radar_internal.papel_atual(redacao_id) is not null);
create policy registrar_proprio_comando on radar.comandos_voz for insert to authenticated
with check (usuario_id=auth.uid() and radar_internal.papel_atual(redacao_id) is not null);

grant select,insert on radar.comandos_voz to authenticated;
revoke all on radar.comandos_voz from public,anon;

create function public.tn_registrar_comando_voz(redacao_id uuid,transcricao text,intencao text,argumentos jsonb,modelo text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u uuid; novo radar.comandos_voz;
begin
 u:=radar_internal.exigir_papel(redacao_id,array['editor_chefe','redator','leitor']::radar.papel[]);
 insert into radar.comandos_voz(redacao_id,usuario_id,transcricao,intencao,argumentos,modelo)
 values(redacao_id,u,btrim(transcricao),intencao,coalesce(argumentos,'{}'),modelo) returning * into novo;
 return jsonb_build_object('id',novo.id,'criado_em',novo.criado_em);
end $$;

revoke execute on function public.tn_registrar_comando_voz(uuid,text,text,jsonb,text) from public,anon;
grant execute on function public.tn_registrar_comando_voz(uuid,text,text,jsonb,text) to authenticated;

