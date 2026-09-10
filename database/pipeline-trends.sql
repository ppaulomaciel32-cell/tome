-- Radar Tome Nota v1 / pipeline automático e assuntos em crescimento.
-- `publicado` aqui significa visível no painel; não é publicação editorial.

create type radar.estado_item as enum ('pendente','coletando','normalizado','classificado','deduplicado','revisao','publicado','descartado');
create type radar.origem_transicao as enum ('sistema','manual');
create type radar.motivo_transicao as enum (
  'item_recebido','coleta_iniciada','coleta_concluida','normalizacao_concluida','classificacao_concluida',
  'deduplicacao_concluida','publicacao_no_painel','cidade_ausente','confianca_baixa','assunto_novo',
  'duplicado_exato','duplicado_conteudo','irrelevante','falha_temporaria','falha_definitiva',
  'limite_tentativas','reprocessamento_manual','revisao_concluida'
);
create type radar.estado_circuito as enum ('fechado','aberto','meio_aberto');
create type radar.estado_dlq as enum ('pendente','reprocessado');
create type radar.tipo_assunto as enum ('tema','evento');
create type radar.rotulo_assunto as enum ('sinal_fraco','emergindo','tendencia');
create type radar.ciclo_assunto as enum ('emergindo','crescendo','pico','esfriando','encerrado');

alter table radar.fontes
  add column estado_circuito radar.estado_circuito not null default 'fechado',
  add column falhas_consecutivas int not null default 0 check(falhas_consecutivas>=0),
  add column circuito_aberto_em timestamptz,
  add column cooldown_ate timestamptz,
  add column tentativas_backoff int not null default 0 check(tentativas_backoff>=0),
  add column ultima_latencia_ms int check(ultima_latencia_ms>=0),
  add column ultima_falha_em timestamptz;

create table radar.itens_coleta (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), fonte_id uuid not null,
 url_original text not null, url_normalizada text not null, titulo_original text not null, titulo_normalizado text not null,
 data_item date, chave_canonica text not null check(length(chave_canonica)=64), hash_conteudo text check(hash_conteudo is null or length(hash_conteudo)=64),
 estado radar.estado_item not null default 'pendente', motivo_descarte radar.motivo_transicao,
 resumo text, autor text, cidade text, uf char(2), categoria text, assunto text, entidades jsonb not null default '[]',
 confianca_item numeric(5,2) not null default 0 check(confianca_item between 0 and 100), confianca_detalhes jsonb not null default '{}',
 tentativas int not null default 0 check(tentativas>=0), proxima_tentativa timestamptz,
 duplicado_de uuid, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), publicado_painel_em timestamptz,
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id),
 foreign key(redacao_id,duplicado_de) references radar.itens_coleta(redacao_id,id),
 unique(redacao_id,id), unique(redacao_id,chave_canonica)
);
create index itens_fila on radar.itens_coleta(redacao_id,estado,proxima_tentativa,criado_em);
create index itens_fonte on radar.itens_coleta(fonte_id,criado_em desc);
create unique index itens_conteudo on radar.itens_coleta(redacao_id,hash_conteudo) where hash_conteudo is not null and duplicado_de is null;
create index itens_cidade_data on radar.itens_coleta(redacao_id,cidade,data_item desc) where estado='publicado';

create table radar.item_transitions (
 id bigint generated always as identity primary key, redacao_id uuid not null references radar.redacoes(id), item_id uuid not null,
 estado_anterior radar.estado_item, estado_novo radar.estado_item not null, ocorrido_em timestamptz not null default now(),
 motivo radar.motivo_transicao not null, origem radar.origem_transicao not null, autor_id uuid references radar.usuarios(id), detalhes jsonb not null default '{}',
 foreign key(redacao_id,item_id) references radar.itens_coleta(redacao_id,id)
);
create index transicoes_item on radar.item_transitions(redacao_id,item_id,id);

create table radar.item_duplicatas (
 id bigint generated always as identity primary key, redacao_id uuid not null references radar.redacoes(id), item_original_id uuid not null,
 fonte_id uuid not null, chave_canonica text not null, url text not null, detectada_em timestamptz not null default now(),
 motivo radar.motivo_transicao not null check(motivo in ('duplicado_exato','duplicado_conteudo')),
 foreign key(redacao_id,item_original_id) references radar.itens_coleta(redacao_id,id),
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id)
);

create table radar.fila_falhas (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), item_id uuid not null,
 estado radar.estado_dlq not null default 'pendente', etapa text not null, tentativas int not null check(tentativas>=3),
 erro_codigo text, erro_resumo text not null, criado_em timestamptz not null default now(), reprocessado_em timestamptz, reprocessado_por uuid references radar.usuarios(id),
 foreign key(redacao_id,item_id) references radar.itens_coleta(redacao_id,id), unique(redacao_id,item_id,estado)
);

create table radar.alertas_coleta (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), fonte_id uuid,
 tipo text not null check(tipo in ('circuito_aberto','coletor_atrasado','ia_indisponivel','volume_anormal')),
 mensagem text not null, criado_em timestamptz not null default now(), resolvido_em timestamptz,
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id)
);

alter table radar.coletas
  add column itens_brutos int not null default 0,
  add column itens_novos int not null default 0,
  add column erros int not null default 0,
  add column latencia_ms int check(latencia_ms>=0);

create table radar.chamadas_ia (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), item_id uuid,
 etapa text not null, provedor text, modelo_solicitado text, modelo_usado text, estrategia text,
 status_http int, custo_usd numeric(14,8), prompt_tokens int, completion_tokens int, total_tokens int,
 latencia_ms int not null check(latencia_ms>=0), sucesso boolean not null, erro_codigo text, criada_em timestamptz not null default now(),
 foreign key(redacao_id,item_id) references radar.itens_coleta(redacao_id,id)
);

create table radar.assuntos (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 nome text not null, tipo radar.tipo_assunto not null, cidade text, uf char(2), entidades jsonb not null default '[]',
 rotulo radar.rotulo_assunto not null default 'sinal_fraco', ciclo radar.ciclo_assunto not null default 'emergindo',
 janela_horas int not null default 24 check(janela_horas in (24,48)), limiar_similaridade numeric(4,3) not null default .850,
 ocorrencias_24h int not null default 0, ocorrencias_total int not null default 0, fontes_24h int not null default 0, autores_24h int not null default 0,
 baseline_24h numeric(10,3) not null default 0, crescimento numeric(12,4) not null default 0,
 confianca numeric(5,2) not null default 0 check(confianca between 0 and 100), explicacao text not null default '', sinais jsonb not null default '{}',
 primeira_ocorrencia timestamptz, ultima_ocorrencia timestamptz, pico_crescimento numeric(12,4),
 janelas_queda int not null default 0 check(janelas_queda>=0), encerrado_em timestamptz, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
 unique(redacao_id,id)
);
create index assuntos_painel on radar.assuntos(redacao_id,ciclo,rotulo,ultima_ocorrencia desc);

create table radar.assuntos_itens (
 redacao_id uuid not null, assunto_id uuid not null, item_id uuid not null, similaridade numeric(4,3), metodo text not null check(metodo in ('embedding','lexical')),
 anexado_em timestamptz not null default now(), primary key(redacao_id,assunto_id,item_id),
 foreign key(redacao_id,assunto_id) references radar.assuntos(redacao_id,id),
 foreign key(redacao_id,item_id) references radar.itens_coleta(redacao_id,id)
);
create index assuntos_por_item on radar.assuntos_itens(redacao_id,item_id);

create table radar.assunto_ciclo_transitions (
 id bigint generated always as identity primary key, redacao_id uuid not null, assunto_id uuid not null,
 ciclo_anterior radar.ciclo_assunto, ciclo_novo radar.ciclo_assunto not null, ocorrido_em timestamptz not null default now(),
 motivo text not null, metricas jsonb not null default '{}',
 foreign key(redacao_id,assunto_id) references radar.assuntos(redacao_id,id)
);
create index ciclo_assunto_historia on radar.assunto_ciclo_transitions(redacao_id,assunto_id,id);

create function radar_internal.transicao_valida(a radar.estado_item,n radar.estado_item,m radar.motivo_transicao,o radar.origem_transicao)
returns boolean language sql immutable set search_path='' as $$
 select case
  when a is null then n='pendente' and m='item_recebido'
  when a='pendente' then n in ('coletando','descartado')
  when a='coletando' then n in ('normalizado','pendente','descartado')
  when a='normalizado' then n in ('classificado','revisao','descartado')
  when a='classificado' then n in ('deduplicado','revisao','descartado')
  when a='deduplicado' then n in ('publicado','revisao','descartado')
  when a='revisao' then n in ('pendente','normalizado','classificado','deduplicado','publicado','descartado') and o='manual'
  when a='descartado' then n='pendente' and o='manual' and m='reprocessamento_manual'
  else false end
$$;

create function radar_internal.item_transicao_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='Histórico de transições é append-only.';end $$;
create trigger item_transitions_immutable before update or delete on radar.item_transitions for each row execute function radar_internal.item_transicao_append_only();
create trigger assunto_ciclo_immutable before update or delete on radar.assunto_ciclo_transitions for each row execute function radar_internal.item_transicao_append_only();

create function radar_internal.registrar_item(r uuid,f uuid,url_o text,url_n text,titulo_o text,titulo_n text,d date,chave text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existente radar.itens_coleta; novo radar.itens_coleta;
begin
 select * into existente from radar.itens_coleta where redacao_id=r and chave_canonica=chave;
 if found then
  insert into radar.item_duplicatas(redacao_id,item_original_id,fonte_id,chave_canonica,url,motivo) values(r,existente.id,f,chave,url_o,'duplicado_exato');
  return jsonb_build_object('novo',false,'item_id',existente.id,'motivo','duplicado_exato');
 end if;
 insert into radar.itens_coleta(redacao_id,fonte_id,url_original,url_normalizada,titulo_original,titulo_normalizado,data_item,chave_canonica)
 values(r,f,url_o,url_n,titulo_o,titulo_n,d,chave) returning * into novo;
 insert into radar.item_transitions(redacao_id,item_id,estado_anterior,estado_novo,motivo,origem) values(r,novo.id,null,'pendente','item_recebido','sistema');
 return jsonb_build_object('novo',true,'item_id',novo.id,'estado',novo.estado);
end $$;

create function radar_internal.transicionar_item(r uuid,i uuid,n radar.estado_item,m radar.motivo_transicao,o radar.origem_transicao,det jsonb default '{}')
returns radar.itens_coleta language plpgsql security definer set search_path='' as $$
declare atual radar.itens_coleta; anterior radar.estado_item;
begin
 if o='manual' then
  if length(btrim(coalesce(det->>'nota','')))=0 then raise exception using errcode='22023',message='Justificativa obrigatória.';end if;
  perform radar_internal.exigir_papel(r,array['editor_chefe','redator']::radar.papel[]);
 elsif coalesce(auth.jwt()->>'role','')<>'service_role' and session_user<>'postgres' then
  raise exception using errcode='42501',message='Transição automática exige identidade interna do coletor.';
 end if;
 select * into atual from radar.itens_coleta where redacao_id=r and id=i for update;
 if not found then raise exception using errcode='P0002',message='Item não encontrado.';end if;
 anterior:=atual.estado;
 if not radar_internal.transicao_valida(anterior,n,m,o) then raise exception using errcode='22023',message='Transição de estado inválida.';end if;
 update radar.itens_coleta set estado=n,motivo_descarte=case when n='descartado' then m else null end,
  publicado_painel_em=case when n='publicado' then now() else publicado_painel_em end, atualizado_em=now()
 where id=i returning * into atual;
 insert into radar.item_transitions(redacao_id,item_id,estado_anterior,estado_novo,motivo,origem,autor_id,detalhes)
 values(r,i,anterior,n,m,o,case when o='manual' then auth.uid() else null end,coalesce(det,'{}'));
 if anterior='descartado' and n='pendente' and m='reprocessamento_manual' then
  update radar.fila_falhas set estado='reprocessado',reprocessado_em=now(),reprocessado_por=auth.uid()
  where redacao_id=r and item_id=i and estado='pendente';
 end if;
 return atual;
end $$;

create function public.tn_reprocessar_item(redacao_id uuid,item_id uuid,nota text) returns jsonb language sql security invoker set search_path='' as $$
 select to_jsonb(radar_internal.transicionar_item(redacao_id,item_id,'pendente','reprocessamento_manual','manual',jsonb_build_object('nota',nota)))
$$;

-- Acesso humano somente por RPC. A alteração é limitada às tabelas novas;
-- permissões das tabelas editoriais existentes não são tocadas.
revoke all on radar.itens_coleta,radar.item_transitions,radar.item_duplicatas,radar.fila_falhas,
 radar.alertas_coleta,radar.chamadas_ia,radar.assuntos,radar.assuntos_itens,radar.assunto_ciclo_transitions
 from public,anon,authenticated;
grant select,insert,update on radar.itens_coleta,radar.fila_falhas,radar.alertas_coleta,radar.assuntos,radar.assuntos_itens to service_role;
grant select,insert on radar.item_transitions,radar.item_duplicatas,radar.chamadas_ia,radar.assunto_ciclo_transitions to service_role;
grant usage,select on sequence radar.item_transitions_id_seq,radar.item_duplicatas_id_seq,radar.assunto_ciclo_transitions_id_seq to service_role;
grant execute on function radar_internal.registrar_item(uuid,uuid,text,text,text,text,date,text),
 radar_internal.transicionar_item(uuid,uuid,radar.estado_item,radar.motivo_transicao,radar.origem_transicao,jsonb) to service_role;
grant execute on function radar_internal.transicionar_item(uuid,uuid,radar.estado_item,radar.motivo_transicao,radar.origem_transicao,jsonb) to authenticated;
revoke execute on function public.tn_reprocessar_item(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.tn_reprocessar_item(uuid,uuid,text) to authenticated;
grant usage on type radar.estado_item,radar.origem_transicao,radar.motivo_transicao to authenticated;
alter table radar.itens_coleta enable row level security;
alter table radar.item_transitions enable row level security;
alter table radar.item_duplicatas enable row level security;
alter table radar.fila_falhas enable row level security;
alter table radar.alertas_coleta enable row level security;
alter table radar.chamadas_ia enable row level security;
alter table radar.assuntos enable row level security;
alter table radar.assuntos_itens enable row level security;
alter table radar.assunto_ciclo_transitions enable row level security;
do $$ declare t text; begin foreach t in array array['itens_coleta','item_transitions','item_duplicatas','fila_falhas','alertas_coleta','chamadas_ia','assuntos','assuntos_itens','assunto_ciclo_transitions'] loop
 execute format('create policy leitura_da_redacao on radar.%I for select to authenticated using (radar_internal.papel_atual(redacao_id) is not null)',t); end loop; end $$;

create index itens_redacao_fonte_fk on radar.itens_coleta(redacao_id,fonte_id);
create index itens_duplicado_fk on radar.itens_coleta(redacao_id,duplicado_de) where duplicado_de is not null;
create index duplicatas_original_fk on radar.item_duplicatas(redacao_id,item_original_id);
create index duplicatas_fonte_fk on radar.item_duplicatas(redacao_id,fonte_id);
create index alertas_fonte_fk on radar.alertas_coleta(redacao_id,fonte_id);
create index chamadas_item_fk on radar.chamadas_ia(redacao_id,item_id);
create index dlq_reprocessado_por_fk on radar.fila_falhas(reprocessado_por) where reprocessado_por is not null;
create index transicoes_autor_fk on radar.item_transitions(autor_id) where autor_id is not null;
