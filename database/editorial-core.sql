-- Radar Tome Nota / etapa 1. Aplicação remota via Supabase apply_migration.
-- Não cria usuários, não envia mensagens e não publica notícias.
create schema radar;
create schema radar_internal;
revoke all on schema radar, radar_internal from public, anon, authenticated, service_role;
alter default privileges in schema radar revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema radar_internal revoke execute on functions from public, anon, authenticated, service_role;

create type radar.papel as enum ('editor_chefe','redator','leitor');
create type radar.status_pauta as enum ('apurar','revisar','aprovada','descartada');
create type radar.origem_pauta as enum ('coleta_automatica','manual');
create type radar.tipo_conferencia as enum ('evidencia','pacote');

create table radar.redacoes (
 id uuid primary key default gen_random_uuid(), slug text not null unique, nome text not null,
 fuso text not null default 'America/Fortaleza', criada_em timestamptz not null default now()
);
create table radar.usuarios (
 id uuid primary key references auth.users(id), nome text not null,
 ativo boolean not null default true, criado_em timestamptz not null default now()
);
create table radar.membros_redacao (
 redacao_id uuid not null references radar.redacoes(id), usuario_id uuid not null references radar.usuarios(id),
 papel radar.papel not null, criado_em timestamptz not null default now(), alterado_por uuid references radar.usuarios(id),
 primary key (redacao_id,usuario_id)
);
create index membros_por_usuario on radar.membros_redacao(usuario_id,redacao_id);
create table radar.fontes (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 nome text not null, url text not null, tipo text not null check(tipo in ('html','rss','json')),
 regra_extracao jsonb not null default '{}', versao_regra int not null default 1,
 ativa boolean not null default false, intervalo_segundos int not null default 900 check(intervalo_segundos>=300),
 proxima_varredura timestamptz, ultima_varredura timestamptz, ultimo_sucesso timestamptz,
 ultimo_erro_codigo text, ultimo_erro_texto text, criada_por uuid references radar.usuarios(id),
 atualizada_por uuid references radar.usuarios(id), criada_em timestamptz not null default now(), atualizada_em timestamptz not null default now(),
 unique(redacao_id,id),unique(redacao_id,url)
);
create index fontes_agendadas on radar.fontes(proxima_varredura) where ativa;
create table radar.documentos (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 hash_conteudo text not null check(length(hash_conteudo)=64), versao_normalizacao int not null default 1,
 titulo text not null, texto_extraido text not null check(length(btrim(texto_extraido))>0),
 data_documento date, horario_documento timestamptz, data_literal text,
 coletado_em timestamptz not null default now(), tipo_conteudo text not null default 'text/html',
 unique(redacao_id,id), unique(redacao_id,versao_normalizacao,hash_conteudo)
);
create table radar.documento_ocorrencias (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 documento_id uuid not null, fonte_id uuid not null, url text not null,
 primeira_deteccao timestamptz not null default now(), ultima_deteccao timestamptz not null default now(),
 status_http int, etag text, last_modified text, documento_anterior_id uuid,
 foreign key(redacao_id,documento_id) references radar.documentos(redacao_id,id),
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id),
 foreign key(redacao_id,documento_anterior_id) references radar.documentos(redacao_id,id),
 unique(redacao_id,documento_id,fonte_id,url)
);
create table radar.coletas (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), fonte_id uuid not null,
 inicio timestamptz not null default now(), fim timestamptz, status text not null check(status in ('executando','concluida','falhou')),
 documentos_lidos int not null default 0, candidatos_criados int not null default 0, duplicados int not null default 0,
 erro_codigo text, erro_resumo text, foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id)
);
create index coletas_fonte_data on radar.coletas(fonte_id,inicio desc);
create sequence radar.codigo_pauta;
create table radar.pautas (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 codigo text not null default ('TN-'||to_char(now() at time zone 'America/Fortaleza','YYYYMMDD')||'-'||lpad(nextval('radar.codigo_pauta')::text,6,'0')),
 id_legado text, titulo text not null check(length(btrim(titulo))>0), localidade text not null, categoria text not null,
 fonte_id uuid, documento_id uuid, url_fonte text not null default '', data_documento date, horario_documento timestamptz,
 data_fato date, evidencia text not null default '', nota_apuracao text not null default '',
 status radar.status_pauta not null default 'apurar', versao int not null default 1 check(versao>=1),
 revisao_registro bigint not null default 1 check(revisao_registro>=1), conferida boolean not null default false,
 versao_conferida int, conferida_por uuid references radar.usuarios(id), conferida_em timestamptz,
 conferencia_atual_id uuid, conferencia_evidencia_id uuid, aprovacao_atual_id uuid,
 hash_conteudo_documento text, hash_evidencia text not null default '', origem radar.origem_pauta not null default 'manual',
 score_afinidade numeric not null default 50 check(score_afinidade between 0 and 100), explicacao_score jsonb not null default '{"decisoes":0,"confianca":0,"sinais":[]}', perfil_revisao bigint not null default 0,
 criada_por uuid references radar.usuarios(id), criada_em timestamptz not null default now(), atualizada_em timestamptz not null default now(),
 unique(redacao_id,id),unique(redacao_id,codigo),unique(redacao_id,id_legado),unique(redacao_id,documento_id),
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id),
 foreign key(redacao_id,documento_id) references radar.documentos(redacao_id,id),
 check((conferida and versao_conferida=versao and conferida_por is not null and conferida_em is not null and conferencia_atual_id is not null)
    or (not conferida and versao_conferida is null and conferida_por is null and conferida_em is null and conferencia_atual_id is null)),
 check((status='aprovada' and conferida and aprovacao_atual_id is not null) or (status<>'aprovada' and aprovacao_atual_id is null))
);
create index pautas_fila on radar.pautas(redacao_id,status,score_afinidade desc,criada_em desc);
create index pautas_fonte on radar.pautas(fonte_id,criada_em desc);
create table radar.rascunhos (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null, pauta_id uuid not null, versao int not null check(versao>=1),
 titulo_editorial text not null default '', texto_site text not null default '', instagram text not null default '',
 stories jsonb not null default '["","",""]', stories_legado text,
 gerado_por_ia boolean not null default false, modelo text, geracao_id uuid, criado_por uuid references radar.usuarios(id), criado_em timestamptz not null default now(),
 foreign key(redacao_id,pauta_id) references radar.pautas(redacao_id,id), unique(redacao_id,pauta_id,versao),
 check(jsonb_typeof(stories)='array' and jsonb_array_length(stories)=3
 and jsonb_typeof(stories->0)='string' and jsonb_typeof(stories->1)='string' and jsonb_typeof(stories->2)='string'),
 check(not gerado_por_ia or modelo is not null)
);
create table radar.conferencias (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null, pauta_id uuid not null, versao int not null,
 tipo radar.tipo_conferencia not null, hash_verificado text not null, autor_id uuid not null references radar.usuarios(id),
 nota text not null check(length(btrim(nota))>0), revisao_sensivel boolean not null default false,
 criada_em timestamptz not null default now(), origem text not null default 'nativa' check(origem in ('nativa','legado_atestado')),
 foreign key(redacao_id,pauta_id,versao) references radar.rascunhos(redacao_id,pauta_id,versao), unique(redacao_id,pauta_id,id)
);
create table radar.aprovacoes (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null, pauta_id uuid not null, versao int not null,
 conferencia_id uuid not null, autor_id uuid not null references radar.usuarios(id), nota text not null check(length(btrim(nota))>0),
 criada_em timestamptz not null default now(), foreign key(redacao_id,pauta_id,versao) references radar.rascunhos(redacao_id,pauta_id,versao),
 foreign key(redacao_id,pauta_id,conferencia_id) references radar.conferencias(redacao_id,pauta_id,id), unique(redacao_id,pauta_id,id)
);
alter table radar.pautas add foreign key(redacao_id,id,conferencia_atual_id) references radar.conferencias(redacao_id,pauta_id,id);
alter table radar.pautas add foreign key(redacao_id,id,conferencia_evidencia_id) references radar.conferencias(redacao_id,pauta_id,id);
alter table radar.pautas add foreign key(redacao_id,id,aprovacao_atual_id) references radar.aprovacoes(redacao_id,pauta_id,id);
create table radar.eventos (
 id uuid primary key default gen_random_uuid(), sequencia bigint generated always as identity unique,
 redacao_id uuid not null references radar.redacoes(id), pauta_id uuid, acao text not null,
 autor_tipo text not null check(autor_tipo in ('usuario','sistema','legado')), autor_id uuid references radar.usuarios(id),
 ocorrido_em timestamptz, registrado_em timestamptz not null default now(), versao int,
 nota text not null check(length(btrim(nota))>0), snapshot jsonb not null, origem text not null default 'nativa' check(origem in ('nativa','importada')),
 importacao_id uuid, indice_legado int, hash_anterior text, hash_evento text not null,
 foreign key(redacao_id,pauta_id) references radar.pautas(redacao_id,id)
);
create index eventos_pauta on radar.eventos(redacao_id,pauta_id,sequencia desc);
create index eventos_redacao on radar.eventos(redacao_id,sequencia desc);
create table radar.memorias_editoriais (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id), texto text not null check(length(btrim(texto))>=10),
 ativa boolean not null default true, revisao int not null default 1, autor_id uuid references radar.usuarios(id),
 criada_em timestamptz not null default now(), atualizada_em timestamptz not null default now(), importacao_id uuid
);
create index memorias_ativas on radar.memorias_editoriais(redacao_id,criada_em) where ativa;
create table radar.perfil_afinidade (
 redacao_id uuid primary key references radar.redacoes(id), epoca int not null default 1, revisao bigint not null default 0,
 decisoes_efetivas int not null default 0, aprovacoes int not null default 0, descartes int not null default 0,
 versao_algoritmo text not null default 'regularizado-v1', zerado_por uuid references radar.usuarios(id), zerado_em timestamptz, atualizado_em timestamptz not null default now(),
 check(decisoes_efetivas>=0 and aprovacoes>=0 and descartes>=0 and decisoes_efetivas=aprovacoes+descartes)
);
-- O treinamento será ligado na etapa de afinidade. Nenhuma decisão é consumida silenciosamente nesta etapa.

create function radar_internal.url_valida(v text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(v ~* '^https?://([[:alnum:]]([[:alnum:].-]*[[:alnum:]])?|\[[0-9a-f:]+\])(:[0-9]{1,5})?([/?#][^[:space:]<>]*)?$',false)
$$;
create function radar_internal.hash_texto(v text) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(coalesce(v,''),'UTF8')),'hex')
$$;
create function radar_internal.hash_evidencia(p radar.pautas) returns text language sql immutable set search_path='' as $$
 select radar_internal.hash_texto(jsonb_build_array(p.titulo,p.url_fonte,p.data_documento,p.data_fato,p.evidencia)::text)
$$;
create function radar_internal.score_regularizado(n integer,s numeric) returns numeric language sql immutable set search_path='' as $$
 select round(50+50*(greatest(n,0)::numeric/(greatest(n,0)+20))*greatest(-1,least(1,coalesce(s,0))),2)
$$;
create function radar_internal.papel_atual(r uuid) returns radar.papel
language plpgsql stable security definer set search_path='' as $$
declare u uuid := auth.uid(); sid uuid; papel radar.papel; claims jsonb := auth.jwt();
begin
 if u is null then return null; end if;
 begin sid:=(claims->>'session_id')::uuid; exception when invalid_text_representation then return null; end;
 if sid is null or coalesce((claims->>'exp')::numeric,0)<=extract(epoch from now()) then return null; end if;
 if not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=u and (s.not_after is null or s.not_after>now())) then return null; end if;
 select m.papel into papel from radar.membros_redacao m join radar.usuarios x on x.id=m.usuario_id and x.ativo
 where m.redacao_id=r and m.usuario_id=u;
 return papel;
end $$;
create function radar_internal.exigir_papel(r uuid, permitidos radar.papel[]) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sessão obrigatória.'; end if;
 if not coalesce(radar_internal.papel_atual(r)=any(permitidos),false) then raise exception using errcode='42501',message='Acesso não autorizado para esta ação.'; end if;
 return auth.uid();
end $$;
create function radar_internal.imutavel() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='Registro histórico imutável: alteração ou exclusão proibida.'; end $$;

do $$ declare t text; begin
 foreach t in array array['eventos','aprovacoes','conferencias','rascunhos','documentos'] loop
  execute format('create trigger impedir_alteracao before update or delete on radar.%I for each row execute function radar_internal.imutavel()',t);
  execute format('create trigger impedir_truncate before truncate on radar.%I for each statement execute function radar_internal.imutavel()',t);
 end loop;
end $$;
create function radar_internal.snapshot(p uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('pauta',to_jsonb(x),'rascunho',to_jsonb(d),'conferencia',to_jsonb(c),'conferencia_evidencia',to_jsonb(e),'aprovacao',to_jsonb(a))
 from radar.pautas x join radar.rascunhos d on d.pauta_id=x.id and d.versao=x.versao
 left join radar.conferencias c on c.id=x.conferencia_atual_id
 left join radar.conferencias e on e.id=x.conferencia_evidencia_id
 left join radar.aprovacoes a on a.id=x.aprovacao_atual_id where x.id=p
$$;
create function radar_internal.registrar_evento(r uuid,p uuid,acao text,u uuid,nota text) returns void language plpgsql set search_path='' as $$
declare anterior text; conteudo jsonb; id_evento uuid:=gen_random_uuid(); instante timestamptz:=clock_timestamp(); versao int;
begin
 perform pg_advisory_xact_lock(hashtextextended(r::text,13));
 select hash_evento into anterior from radar.eventos where redacao_id=r order by sequencia desc limit 1;
 conteudo:=radar_internal.snapshot(p);
 select x.versao into versao from radar.pautas x where x.id=p;
 insert into radar.eventos(id,redacao_id,pauta_id,acao,autor_tipo,autor_id,ocorrido_em,versao,nota,snapshot,hash_anterior,hash_evento)
 values(id_evento,r,p,acao,case when u is null then 'sistema' else 'usuario' end,u,instante,versao,nota,conteudo,anterior,
 radar_internal.hash_texto(jsonb_build_array(anterior,id_evento,r,p,acao,u,instante,versao,nota,conteudo)::text));
end $$;

create function radar_internal.comando(r uuid,p_id uuid,acao text,revisao bigint,dados jsonb,nota text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; p radar.pautas; d radar.rascunhos; anterior jsonb; cid uuid; aid uuid; candidato jsonb; atual jsonb;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sessão obrigatória.'; end if;
 if acao not in ('criar','editar','nota','conferir_evidencia','conferir_pacote','aprovar','descartar','apurar') then raise exception using errcode='22023',message='Ação inválida.'; end if;
 u:=radar_internal.exigir_papel(r,case when acao in ('aprovar','descartar') then array['editor_chefe']::radar.papel[] else array['editor_chefe','redator']::radar.papel[] end);
 if length(btrim(coalesce(nota,'')))=0 then raise exception using errcode='22023',message='Justificativa obrigatória.'; end if;
 if dados is null or jsonb_typeof(dados)<>'object' then raise exception using errcode='22023',message='Dados devem ser um objeto.'; end if;
 if exists(select 1 from jsonb_object_keys(dados) k where k not in ('titulo','localidade','categoria','url_fonte','data_documento','data_fato','evidencia','rascunho','confirmacao_humana','revisao_sensivel')) then
  raise exception using errcode='22023',message='Campo não permitido.'; end if;
 if dados ? 'rascunho' and (jsonb_typeof(dados->'rascunho')<>'object' or exists(select 1 from jsonb_object_keys(dados->'rascunho') k where k not in ('titulo_editorial','texto_site','instagram','stories'))) then
  raise exception using errcode='22023',message='Rascunho inválido.'; end if;
 -- Sempre serializar pela redação antes do lock de pauta para evitar inversão de locks com auditoria/recalculo.
 perform pg_advisory_xact_lock(hashtextextended(r::text,13));
 if acao='criar' then
  if p_id is not null then raise exception using errcode='22023',message='ID é gerado pelo servidor.'; end if;
  insert into radar.pautas(redacao_id,titulo,localidade,categoria,url_fonte,data_documento,data_fato,evidencia,nota_apuracao,criada_por)
  values(r,coalesce(dados->>'titulo',''),coalesce(dados->>'localidade',''),coalesce(dados->>'categoria','Serviço'),coalesce(dados->>'url_fonte',''),nullif(dados->>'data_documento','')::date,nullif(dados->>'data_fato','')::date,coalesce(dados->>'evidencia',''),nota,u) returning * into p;
  -- Criação sempre sem rascunho; edição é uma ação separada e auditada.
  if dados ? 'rascunho' then raise exception using errcode='22023',message='Crie a pauta antes de redigir.'; end if;
  insert into radar.rascunhos(redacao_id,pauta_id,versao,criado_por) values(r,p.id,1,u);
  update radar.pautas set hash_evidencia=radar_internal.hash_evidencia(p) where id=p.id;
 else
  select * into p from radar.pautas where id=p_id and redacao_id=r for update;
  if not found then raise exception using errcode='P0002',message='Pauta não encontrada.'; end if;
  if revisao is distinct from p.revisao_registro then raise exception using errcode='40001',message='A pauta mudou. Atualize antes de continuar.'; end if;
  select * into strict d from radar.rascunhos where pauta_id=p.id and versao=p.versao;
  if acao='editar' then
   anterior:=jsonb_build_array(p.titulo,p.localidade,p.categoria,p.url_fonte,p.data_documento,p.data_fato,p.evidencia,d.titulo_editorial,d.texto_site,d.instagram,d.stories);
   if dados ? 'titulo' then p.titulo:=dados->>'titulo'; end if;
   if dados ? 'localidade' then p.localidade:=dados->>'localidade'; end if;
   if dados ? 'categoria' then p.categoria:=dados->>'categoria'; end if;
   if dados ? 'url_fonte' then p.url_fonte:=dados->>'url_fonte'; end if;
   if dados ? 'data_documento' then p.data_documento:=nullif(dados->>'data_documento','')::date; end if;
   if dados ? 'data_fato' then p.data_fato:=nullif(dados->>'data_fato','')::date; end if;
   if dados ? 'evidencia' then p.evidencia:=dados->>'evidencia'; end if;
   candidato:=dados->'rascunho';
   if candidato ? 'titulo_editorial' then d.titulo_editorial:=candidato->>'titulo_editorial'; end if;
   if candidato ? 'texto_site' then d.texto_site:=candidato->>'texto_site'; end if;
   if candidato ? 'instagram' then d.instagram:=candidato->>'instagram'; end if;
   if candidato ? 'stories' then d.stories:=candidato->'stories'; end if;
   atual:=jsonb_build_array(p.titulo,p.localidade,p.categoria,p.url_fonte,p.data_documento,p.data_fato,p.evidencia,d.titulo_editorial,d.texto_site,d.instagram,d.stories);
   if atual is distinct from anterior then
    p.versao:=p.versao+1;
    p.status:=case when length(btrim(coalesce(d.texto_site,'')))>0 then 'revisar'::radar.status_pauta else 'apurar'::radar.status_pauta end;
    p.conferida:=false;p.versao_conferida:=null;p.conferida_por:=null;p.conferida_em:=null;p.conferencia_atual_id:=null;p.conferencia_evidencia_id:=null;p.aprovacao_atual_id:=null;
    insert into radar.rascunhos(redacao_id,pauta_id,versao,titulo_editorial,texto_site,instagram,stories,stories_legado,gerado_por_ia,modelo,geracao_id,criado_por)
    values(r,p.id,p.versao,d.titulo_editorial,d.texto_site,d.instagram,d.stories,d.stories_legado,d.gerado_por_ia,d.modelo,d.geracao_id,u);
    p.hash_evidencia:=radar_internal.hash_evidencia(p);
   end if;
  elsif acao in ('conferir_evidencia','conferir_pacote') then
   if not coalesce((dados->>'confirmacao_humana')::boolean,false) then raise exception using errcode='22023',message='Confirmação humana explícita obrigatória.'; end if;
   if length(btrim(p.evidencia))=0 or not radar_internal.url_valida(p.url_fonte) then raise exception using errcode='22023',message='Conferência exige evidência textual e fonte HTTP/HTTPS válida.'; end if;
   if p.categoria ~* '(pol[ií]cia|sa[uú]de|pol[ií]tica|acidente|morte|den[uú]ncia|acusa[cç][aã]o)' and not coalesce((dados->>'revisao_sensivel')::boolean,false) then raise exception using errcode='22023',message='Assunto sensível exige revisão humana específica.'; end if;
   cid:=gen_random_uuid();
   insert into radar.conferencias(id,redacao_id,pauta_id,versao,tipo,hash_verificado,autor_id,nota,revisao_sensivel)
   values(cid,r,p.id,p.versao,case when acao='conferir_evidencia' then 'evidencia'::radar.tipo_conferencia else 'pacote'::radar.tipo_conferencia end,
   case when acao='conferir_evidencia' then p.hash_evidencia else radar_internal.hash_texto(jsonb_build_array(p.hash_evidencia,to_jsonb(d))::text) end,u,nota,coalesce((dados->>'revisao_sensivel')::boolean,false));
   p.conferencia_evidencia_id:=cid;
   if acao='conferir_pacote' then p.conferida:=true;p.versao_conferida:=p.versao;p.conferida_por:=u;p.conferida_em:=now();p.conferencia_atual_id:=cid;end if;
  elsif acao='aprovar' then
   if not p.conferida or p.versao_conferida is distinct from p.versao or not exists(select 1 from radar.conferencias c where c.id=p.conferencia_atual_id and c.pauta_id=p.id and c.versao=p.versao and c.tipo='pacote' and c.hash_verificado=radar_internal.hash_texto(jsonb_build_array(p.hash_evidencia,to_jsonb(d))::text)) then raise exception using errcode='22023',message='Aprovação exige conferência humana do pacote desta versão.'; end if;
   if length(btrim(p.evidencia))=0 or not radar_internal.url_valida(p.url_fonte) then raise exception using errcode='22023',message='Evidência e fonte válidas obrigatórias.'; end if;
   if length(btrim(d.titulo_editorial))=0 or length(btrim(d.texto_site))=0 or length(btrim(d.instagram))=0 or exists(select 1 from jsonb_array_elements_text(d.stories) t where length(btrim(t))=0) then raise exception using errcode='22023',message='Complete título, site, Instagram e as três telas de Stories.'; end if;
   if p.status='aprovada' then raise exception using errcode='22023',message='Esta versão já está aprovada.'; end if;
   aid:=gen_random_uuid();
   insert into radar.aprovacoes(id,redacao_id,pauta_id,versao,conferencia_id,autor_id,nota) values(aid,r,p.id,p.versao,p.conferencia_atual_id,u,nota);
   p.aprovacao_atual_id:=aid;p.status:='aprovada';
  elsif acao in ('descartar','apurar') then
   p.status:=case when acao='descartar' then 'descartada'::radar.status_pauta else 'apurar'::radar.status_pauta end;
   p.conferida:=false;p.versao_conferida:=null;p.conferida_por:=null;p.conferida_em:=null;p.conferencia_atual_id:=null;p.conferencia_evidencia_id:=null;p.aprovacao_atual_id:=null;
  end if;
  update radar.pautas set titulo=p.titulo,localidade=p.localidade,categoria=p.categoria,url_fonte=p.url_fonte,data_documento=p.data_documento,data_fato=p.data_fato,evidencia=p.evidencia,
   status=p.status,versao=p.versao,conferida=p.conferida,versao_conferida=p.versao_conferida,conferida_por=p.conferida_por,conferida_em=p.conferida_em,
   conferencia_atual_id=p.conferencia_atual_id,conferencia_evidencia_id=p.conferencia_evidencia_id,aprovacao_atual_id=p.aprovacao_atual_id,hash_evidencia=p.hash_evidencia,
   nota_apuracao=nota,revisao_registro=revisao_registro+1,atualizada_em=now() where id=p.id;
 end if;
 perform radar_internal.registrar_evento(r,p.id,acao,u,nota);
 return radar_internal.snapshot(p.id);
end $$;

create function public.tn_comando(redacao_id uuid,pauta_id uuid,acao text,revisao_esperada bigint,dados jsonb,nota text)
returns jsonb language sql security invoker set search_path='' as $$
 select radar_internal.comando(redacao_id,pauta_id,acao,revisao_esperada,dados,nota)
$$;
create function radar_internal.listar(r uuid,limite int) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sessão obrigatória.';end if;
 perform radar_internal.exigir_papel(r,array['editor_chefe','redator','leitor']::radar.papel[]);
 return coalesce((select jsonb_agg(z.conteudo) from (select radar_internal.snapshot(p.id) as conteudo from radar.pautas p where p.redacao_id=r order by p.score_afinidade desc,p.criada_em desc limit greatest(1,least(coalesce(limite,100),250))) z),'[]');
end $$;
create function public.tn_listar_pautas(redacao_id uuid,limite int default 100) returns jsonb language sql security invoker set search_path='' as $$
 select radar_internal.listar(redacao_id,limite)
$$;
-- Nenhuma tabela de negócio é editável diretamente por anon/authenticated/service_role.
-- Funções privadas de comando validam sessão e papel; wrappers públicos são invoker.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='radar' loop
  execute format('alter table radar.%I enable row level security',t.tablename);
  execute format('revoke all on table radar.%I from public,anon,authenticated,service_role',t.tablename);
 end loop;
end $$;
revoke all on all sequences in schema radar from public,anon,authenticated,service_role;
revoke execute on all functions in schema radar_internal from public,anon,authenticated,service_role;
revoke execute on function public.tn_comando(uuid,uuid,text,bigint,jsonb,text), public.tn_listar_pautas(uuid,int) from public,anon,authenticated,service_role;
grant usage on schema radar,radar_internal to authenticated;
grant execute on function radar_internal.comando(uuid,uuid,text,bigint,jsonb,text),radar_internal.listar(uuid,int),radar_internal.papel_atual(uuid) to authenticated;
grant execute on function public.tn_comando(uuid,uuid,text,bigint,jsonb,text),public.tn_listar_pautas(uuid,int) to authenticated;
-- Leitura direta necessária ao futuro Realtime, sempre limitada por associação ativa.
do $$ declare t text; begin
 foreach t in array array['pautas','rascunhos','conferencias','aprovacoes','eventos','fontes','documentos','documento_ocorrencias','coletas','memorias_editoriais','perfil_afinidade'] loop
  execute format('grant select on radar.%I to authenticated',t);
  execute format('create policy leitura_da_redacao on radar.%I for select to authenticated using (radar_internal.papel_atual(redacao_id) is not null)',t);
 end loop;
end $$;
-- Configuração inicial real; sem matérias fictícias nem usuários artificiais.
with r as (insert into radar.redacoes(slug,nome) values('tome-nota','Tome Nota News') returning id)
insert into radar.perfil_afinidade(redacao_id) select id from r;
