-- Etapa 2: contexto autenticado, migração do HTML v1 e exportação auditável.
create table radar.importacoes (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 autor_id uuid not null references radar.usuarios(id), hash_arquivo text not null, payload jsonb not null,
 resumo jsonb not null, criada_em timestamptz not null default now(), concluida_em timestamptz,
 unique(redacao_id,hash_arquivo)
);
create table radar.legado_registros (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 importacao_id uuid not null references radar.importacoes(id), tipo text not null check(tipo in ('item','memoria','evento','perfil')),
 indice int not null, pauta_id uuid, original jsonb not null,
 foreign key(redacao_id,pauta_id) references radar.pautas(redacao_id,id), unique(importacao_id,tipo,indice)
);
create trigger impedir_alteracao before update or delete on radar.legado_registros for each row execute function radar_internal.imutavel();
create trigger impedir_truncate before truncate on radar.legado_registros for each statement execute function radar_internal.imutavel();
alter table radar.importacoes enable row level security;
alter table radar.legado_registros enable row level security;
revoke all on radar.importacoes,radar.legado_registros from public,anon,authenticated,service_role;
create policy sem_acesso_direto on radar.importacoes for all to anon,authenticated using(false) with check(false);
create policy leitura_da_redacao on radar.legado_registros for select to authenticated using(radar_internal.papel_atual(redacao_id) is not null);
grant select on radar.legado_registros to authenticated;

-- Defesa também na RPC direta: credenciais não são dados editoriais migráveis.
create function radar_internal.sanitizar(v jsonb, profundidade int default 0) returns jsonb language plpgsql immutable set search_path='' as $$
declare saida jsonb; k text; x jsonb; s text;
begin
 if profundidade>40 then raise exception using errcode='22023',message='JSON excede a profundidade permitida.';end if;
 if jsonb_typeof(v)='object' then
  saida:='{}';
  for k,x in select key,value from jsonb_each(v) loop
   if regexp_replace(lower(k),'[^a-z0-9]','','g') ~ '(apikey|authorization|password|senha|secret|credential|accesstoken|refreshtoken|servicerole|anthropickey|openai.?key)' or lower(k) in ('token','key','cookie','cookies') then continue;end if;
   saida:=saida||jsonb_build_object(k,radar_internal.sanitizar(x,profundidade+1));
  end loop;
  return saida;
 elsif jsonb_typeof(v)='array' then
  return coalesce((select jsonb_agg(radar_internal.sanitizar(value,profundidade+1) order by ordinality) from jsonb_array_elements(v) with ordinality),'[]');
 elsif jsonb_typeof(v)='string' then
  s:=v#>>'{}';
  s:=regexp_replace(s,'(sk-(ant-|proj-)?[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]+|Bearer[[:space:]]+[A-Za-z0-9._-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)','[CREDENCIAL REMOVIDA]','gi');
  return to_jsonb(s);
 end if;
 return v;
end $$;
create function radar_internal.data_legado(v text) returns date language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if coalesce(v,'')='' then return null;end if;
 if v !~ '^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='Data do legado inválida; corrija a cópia antes de importar.';end if;
 begin d:=v::date;exception when others then raise exception using errcode='22023',message='Data do legado inválida; corrija a cópia antes de importar.';end;
 return d;
end $$;
create function radar_internal.instante_legado(v text) returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if v is null or v !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' then return null;end if;
 begin return v::timestamptz;exception when others then return null;end;
end $$;
create function radar_internal.contexto() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare resultado jsonb;
begin
 if auth.uid() is null then raise exception using errcode='28000',message='Sessão obrigatória.';end if;
 select jsonb_build_object('id',u.id,'nome',u.nome,'redacoes',
   (select jsonb_agg(jsonb_build_object('id',r.id,'nome',r.nome,'papel',m.papel,'fuso',r.fuso) order by r.nome)
   from radar.membros_redacao m join radar.redacoes r on r.id=m.redacao_id
   where m.usuario_id=u.id and radar_internal.papel_atual(r.id) is not null)) into resultado
 from radar.usuarios u where u.id=auth.uid() and u.ativo;
 if resultado is null or resultado->'redacoes'='null'::jsonb then raise exception using errcode='42501',message='Conta sem acesso à redação. Solicite cadastro ao editor-chefe.';end if;
 return resultado;
end $$;
create function public.tn_contexto() returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.contexto() $$;

create function radar_internal.prever_importacao(r uuid,entrada jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; v jsonb; x jsonb; chave text; total int; iid uuid; resumo jsonb; avisos jsonb;
begin
 u:=radar_internal.exigir_papel(r,array['editor_chefe']::radar.papel[]);
 if octet_length(entrada::text)>10000000 then raise exception using errcode='22023',message='Arquivo excede 10 MB.';end if;
 v:=radar_internal.sanitizar(entrada);
 if v->>'format' is distinct from 'tome-nota-local-v1' or jsonb_typeof(v->'items') is distinct from 'array'
  or jsonb_typeof(v->'memories') is distinct from 'array' or jsonb_typeof(v->'events') is distinct from 'array' then
  raise exception using errcode='22023',message='Use um JSON exportado pelo Radar HTML v1.';end if;
 if jsonb_array_length(v->'items')>1000 or jsonb_array_length(v->'events')>20000 or jsonb_array_length(v->'memories')>2000 then
  raise exception using errcode='22023',message='Quantidade de registros excede o limite da importação.';end if;
 if exists(select 1 from jsonb_array_elements(v->'items') i group by i->>'id' having count(*)>1) then
  raise exception using errcode='22023',message='IDs repetidos no arquivo.';end if;
 for x in select value from jsonb_array_elements(v->'items') loop
  foreach chave in array array['id','title','locality','category','url','docDate','factDate','evidence','note','status'] loop
   if jsonb_typeof(x->chave) is distinct from 'string' then raise exception using errcode='22023',message='Pauta incompatível com o HTML v1.';end if;
  end loop;
  if btrim(x->>'id')='' or btrim(x->>'title')='' or x->>'status' not in ('apurar','revisar','aprovada','descartada')
   or jsonb_typeof(x->'checked') is distinct from 'boolean' or jsonb_typeof(x->'version') is distinct from 'number'
   or (x->>'version') !~ '^[1-9][0-9]{0,8}$' or jsonb_typeof(x->'draft') is distinct from 'object' then
   raise exception using errcode='22023',message='Versão, estado ou rascunho incompatível.';end if;
  foreach chave in array array['title','site','instagram','stories'] loop
   if jsonb_typeof(x->'draft'->chave) is distinct from 'string' then raise exception using errcode='22023',message='Rascunho incompatível com o HTML v1.';end if;
  end loop;
  perform radar_internal.data_legado(x->>'docDate');perform radar_internal.data_legado(x->>'factDate');
 end loop;
 for x in select value from jsonb_array_elements(v->'memories') loop
  if jsonb_typeof(x->'content') is distinct from 'string' then raise exception using errcode='22023',message='Memória incompatível.';end if;
 end loop;
 for x in select value from jsonb_array_elements(v->'events') loop
  if jsonb_typeof(x->'action') is distinct from 'string' or jsonb_typeof(x->'title') is distinct from 'string' then raise exception using errcode='22023',message='Evento incompatível.';end if;
 end loop;
 avisos:=jsonb_build_array('Conferências e aprovações do arquivo ficam preservadas no legado, sem atribuir autoria a quem importou. As pautas exigem nova conferência autenticada.',
  'Stories em texto livre são preservados integralmente; as três telas devem ser separadas pelo editor.',
  'Campos adicionais são preservados no arquivo de origem. Pesos legados não são usados como treinamento sem procedência auditável.');
 if entrada is distinct from v then avisos:=avisos||jsonb_build_array('Credenciais removidas da cópia antes do armazenamento.');end if;
 select count(*) into total from jsonb_array_elements(v->'items') i join radar.pautas existente on existente.redacao_id=r and (existente.id_legado=i->>'id' or existente.codigo=i->>'id');
 resumo:=jsonb_build_object('pautas',jsonb_array_length(v->'items'),'memorias',jsonb_array_length(v->'memories'),'eventos',jsonb_array_length(v->'events'),'conflitos_id',total,'avisos',avisos);
 insert into radar.importacoes(redacao_id,autor_id,hash_arquivo,payload,resumo) values(r,u,radar_internal.hash_texto(v::text),v,resumo)
 on conflict(redacao_id,hash_arquivo) do nothing returning id into iid;
 if iid is null then select id into iid from radar.importacoes where redacao_id=r and hash_arquivo=radar_internal.hash_texto(v::text);end if;
 return (select jsonb_build_object('id',i.id,'resumo',i.resumo,'concluida_em',i.concluida_em) from radar.importacoes i where i.id=iid);
end $$;
create function public.tn_prever_importacao(redacao_id uuid,arquivo jsonb) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.prever_importacao(redacao_id,arquivo) $$;

-- Eventos importados têm autor desconhecido explicitamente e snapshot original intacto.
create function radar_internal.evento_legado(r uuid,p uuid,iid uuid,indice int,x jsonb) returns void language plpgsql set search_path='' as $$
declare anterior text; eid uuid:=gen_random_uuid(); instante timestamptz:=radar_internal.instante_legado(x->>'at');
 acao text:=coalesce(nullif(x->>'action',''),'Evento do arquivo legado');nota text:=coalesce(nullif(btrim(x->>'note'),''),'[Nota ausente no legado]');v int;
begin
 if x->>'version' ~ '^[1-9][0-9]{0,8}$' then v:=(x->>'version')::int;end if;
 select hash_evento into anterior from radar.eventos where redacao_id=r order by sequencia desc limit 1;
 insert into radar.eventos(id,redacao_id,pauta_id,acao,autor_tipo,ocorrido_em,versao,nota,snapshot,origem,importacao_id,indice_legado,hash_anterior,hash_evento)
 values(eid,r,p,acao,'legado',instante,v,nota,x,'importada',iid,indice,anterior,
 radar_internal.hash_texto(jsonb_build_array(anterior,eid,r,p,acao,null,instante,v,nota,x)::text));
end $$;
create function radar_internal.confirmar_importacao(r uuid,iid uuid,confirmacao boolean,nota text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; imp radar.importacoes; x jsonb; n bigint; p radar.pautas; pid uuid;
begin
 u:=radar_internal.exigir_papel(r,array['editor_chefe']::radar.papel[]);
 if not coalesce(confirmacao,false) or btrim(coalesce(nota,''))='' then raise exception using errcode='22023',message='Confirme a prévia e registre o motivo da importação.';end if;
 perform pg_advisory_xact_lock(hashtextextended(r::text,13));
 select * into imp from radar.importacoes where id=iid and redacao_id=r for update;
 if not found then raise exception using errcode='P0002',message='Prévia não encontrada.';end if;
 if imp.concluida_em is not null then return jsonb_build_object('id',iid,'ja_importado',true,'resumo',imp.resumo);end if;
 if exists(select 1 from jsonb_array_elements(imp.payload->'items') i join radar.pautas existente on existente.redacao_id=r and (existente.id_legado=i->>'id' or existente.codigo=i->>'id')) then
  raise exception using errcode='23505',message='Há IDs já existentes. Nenhum registro foi substituído.';end if;
 for x,n in select value,ordinality from jsonb_array_elements(imp.payload->'items') with ordinality loop
  insert into radar.pautas(redacao_id,id_legado,titulo,localidade,categoria,url_fonte,data_documento,data_fato,evidencia,nota_apuracao,status,versao)
  values(r,x->>'id',x->>'title',x->>'locality',x->>'category',x->>'url',radar_internal.data_legado(x->>'docDate'),radar_internal.data_legado(x->>'factDate'),x->>'evidence',x->>'note',
   case when x->>'status'='aprovada' then case when btrim(x#>>'{draft,site}')<>'' then 'revisar'::radar.status_pauta else 'apurar'::radar.status_pauta end else (x->>'status')::radar.status_pauta end,(x->>'version')::int) returning * into p;
  insert into radar.rascunhos(redacao_id,pauta_id,versao,titulo_editorial,texto_site,instagram,stories_legado)
  values(r,p.id,p.versao,x#>>'{draft,title}',x#>>'{draft,site}',x#>>'{draft,instagram}',x#>>'{draft,stories}');
  update radar.pautas set hash_evidencia=radar_internal.hash_evidencia(p) where id=p.id;
  insert into radar.legado_registros(redacao_id,importacao_id,tipo,indice,pauta_id,original) values(r,iid,'item',n::int,p.id,x);
  perform radar_internal.registrar_evento(r,p.id,'importacao_v1',u,nota);
 end loop;
 for x,n in select value,ordinality from jsonb_array_elements(imp.payload->'memories') with ordinality loop
  -- Textos curtos continuam guardados integralmente no legado, sem criar orientação inválida.
  if length(btrim(x->>'content'))>=10 then
   insert into radar.memorias_editoriais(redacao_id,texto,importacao_id) values(r,x->>'content',iid);
  end if;
  insert into radar.legado_registros(redacao_id,importacao_id,tipo,indice,original) values(r,iid,'memoria',n::int,x);
 end loop;
 -- O HTML usa unshift: reconstituir ordem cronológica sem inventar data ausente.
 for x,n in select value,ordinality from jsonb_array_elements(imp.payload->'events') with ordinality order by ordinality desc loop
  select id into pid from radar.pautas where redacao_id=r and id_legado=x->>'id';
  insert into radar.legado_registros(redacao_id,importacao_id,tipo,indice,pauta_id,original) values(r,iid,'evento',n::int,pid,x);
  perform radar_internal.evento_legado(r,pid,iid,n::int,x);
 end loop;
 if imp.payload ? 'perfil_afinidade' or imp.payload ? 'affinity' or imp.payload ? 'profile' then
  insert into radar.legado_registros(redacao_id,importacao_id,tipo,indice,original) values(r,iid,'perfil',0,
   jsonb_build_object('perfil_afinidade',imp.payload->'perfil_afinidade','affinity',imp.payload->'affinity','profile',imp.payload->'profile'));
 end if;
 update radar.importacoes set concluida_em=now() where id=iid;
 return jsonb_build_object('id',iid,'ja_importado',false,'resumo',imp.resumo);
end $$;
create function public.tn_confirmar_importacao(redacao_id uuid,importacao_id uuid,confirmacao boolean,nota text) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.confirmar_importacao(redacao_id,importacao_id,confirmacao,nota) $$;

create function radar_internal.consultar(r uuid,recurso text,p uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform radar_internal.exigir_papel(r,array['editor_chefe','redator','leitor']::radar.papel[]);
 if recurso='pauta' then
  if not exists(select 1 from radar.pautas where id=p and redacao_id=r) then raise exception using errcode='P0002',message='Pauta não encontrada.';end if;
  return radar_internal.snapshot(p);
 elsif recurso='eventos' then
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.sequencia desc) from (select * from radar.eventos where redacao_id=r and (p is null or pauta_id=p) order by sequencia desc limit 200) e),'[]');
 elsif recurso='memorias' then
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.criada_em) from radar.memorias_editoriais m where m.redacao_id=r),'[]');
 end if;
 raise exception using errcode='22023',message='Recurso inválido.';
end $$;
create function public.tn_consultar(redacao_id uuid,recurso text,pauta_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.consultar(redacao_id,recurso,pauta_id) $$;

create function radar_internal.exportar(r uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare saida jsonb;
begin
 perform radar_internal.exigir_papel(r,array['editor_chefe']::radar.papel[]);
 saida:=jsonb_build_object('format','tome-nota-servidor-v1','exportado_em',now(),'pautas',
  coalesce((select jsonb_agg(radar_internal.snapshot(id) order by criada_em,id) from radar.pautas where redacao_id=r),'[]'),
  'rascunhos',coalesce((select jsonb_agg(to_jsonb(d)) from radar.rascunhos d where redacao_id=r),'[]'),
  'conferencias',coalesce((select jsonb_agg(to_jsonb(c)) from radar.conferencias c where redacao_id=r),'[]'),
  'aprovacoes',coalesce((select jsonb_agg(to_jsonb(a)) from radar.aprovacoes a where redacao_id=r),'[]'),
  'eventos',coalesce((select jsonb_agg(to_jsonb(e) order by sequencia) from radar.eventos e where redacao_id=r),'[]'),
  'memorias',coalesce((select jsonb_agg(to_jsonb(m)) from radar.memorias_editoriais m where redacao_id=r),'[]'),
  'perfil_afinidade',(select to_jsonb(f) from radar.perfil_afinidade f where redacao_id=r),
  'legado_registros',coalesce((select jsonb_agg(to_jsonb(l)) from radar.legado_registros l where redacao_id=r),'[]'),
  'importacoes',coalesce((select jsonb_agg(to_jsonb(i)) from radar.importacoes i where redacao_id=r and concluida_em is not null),'[]'));
 return radar_internal.sanitizar(saida);
end $$;
create function public.tn_exportar(redacao_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.exportar(redacao_id) $$;

revoke execute on all functions in schema radar_internal from public,anon,service_role;
revoke execute on function public.tn_contexto(),public.tn_prever_importacao(uuid,jsonb),public.tn_confirmar_importacao(uuid,uuid,boolean,text),public.tn_consultar(uuid,text,uuid),public.tn_exportar(uuid) from public,anon,service_role;
grant execute on function radar_internal.contexto(),radar_internal.prever_importacao(uuid,jsonb),radar_internal.confirmar_importacao(uuid,uuid,boolean,text),radar_internal.consultar(uuid,text,uuid),radar_internal.exportar(uuid) to authenticated;
grant execute on function public.tn_contexto(),public.tn_prever_importacao(uuid,jsonb),public.tn_confirmar_importacao(uuid,uuid,boolean,text),public.tn_consultar(uuid,text,uuid),public.tn_exportar(uuid) to authenticated;
notify pgrst,'reload schema';
