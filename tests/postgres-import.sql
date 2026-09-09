create or replace function pg_temp.assert_error(stmt text,codigo text) returns void language plpgsql as $$
begin
 begin execute stmt;exception when others then if sqlstate=codigo then return;end if;raise;end;
 raise exception 'Era esperado o erro %',codigo;
end $$;
create or replace function pg_temp.testar_importacao(v jsonb) returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid(); redator uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid();
 limpo jsonb:=radar_internal.sanitizar(v); r uuid:=gen_random_uuid(); res jsonb:='[]'; previa jsonb; iid uuid; saida jsonb; p uuid; x jsonb;
begin
 begin
  insert into auth.users(id,aud,role,email) values(u,'authenticated','authenticated',u||'@teste.invalid'),(redator,'authenticated','authenticated',redator||'@teste.invalid');
  insert into auth.sessions(id,user_id,not_after) values(sid,u,now()+interval '1 hour'),(sid2,redator,now()+interval '1 hour');
  insert into radar.usuarios(id,nome) values(u,'Chefe de teste'),(redator,'Redator de teste');
  insert into radar.redacoes(id,slug,nome) values(r,'teste-import-'||r,'Redação de teste');
  insert into radar.membros_redacao(redacao_id,usuario_id,papel) values(r,u,'editor_chefe'),(r,redator,'redator');
  insert into radar.perfil_afinidade(redacao_id) values(r);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'exp',extract(epoch from now()+interval '1 hour'),'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.tn_contexto()#>>'{redacoes,0,papel}'<>'editor_chefe' then raise exception 'Contexto incorreto.';end if;
  res:=res||jsonb_build_array('Contexto identifica autor e papel pela sessão');
  previa:=public.tn_prever_importacao(r,v);iid:=(previa->>'id')::uuid;
  if (previa#>>'{resumo,pautas}')::int<>jsonb_array_length(v->'items') then raise exception 'Prévia perdeu registros.';end if;
  if (select count(*) from radar.pautas where redacao_id=r)<>0 then raise exception 'Prévia alterou a fila.';end if;
  res:=res||jsonb_build_array('Prévia conta registros sem inserir pautas');
  perform pg_temp.assert_error(format('select public.tn_confirmar_importacao(%L,%L,false,''Teste'')',r,iid),'22023');
  perform pg_temp.assert_error(format('select public.tn_confirmar_importacao(%L,%L,true,'' '')',r,iid),'22023');
  res:=res||jsonb_build_array('Aplicação exige confirmação e nota');
  perform public.tn_confirmar_importacao(r,iid,true,'Importação exclusivamente de teste.');
  saida:=public.tn_exportar(r);
  if jsonb_array_length(saida->'pautas')<>jsonb_array_length(v->'items') then raise exception 'Pautas perdidas.';end if;
  if saida#>'{importacoes,0,payload}' is distinct from limpo then raise exception 'Dados de negócio perderam conteúdo.';end if;
  res:=res||jsonb_build_array('Export preserva todo o JSON de negócio sanitizado, inclusive campos adicionais');
  for x in select value from jsonb_array_elements(v->'items') loop
   select id into p from radar.pautas where redacao_id=r and id_legado=x->>'id';
   if p is null or public.tn_consultar(r,'pauta',p)#>>'{pauta,versao}'<>x->>'version'
    or coalesce(public.tn_consultar(r,'pauta',p)#>>'{pauta,data_documento}','')<>x->>'docDate'
    or coalesce(public.tn_consultar(r,'pauta',p)#>>'{pauta,data_fato}','')<>x->>'factDate'
    or public.tn_consultar(r,'pauta',p)#>>'{rascunho,stories_legado}'<>x#>>'{draft,stories}' then raise exception 'Mapeamento incorreto.';end if;
  end loop;
  res:=res||jsonb_build_array('IDs, versões, duas datas e Stories livres são preservados');
  if exists(select 1 from radar.pautas where redacao_id=r and (conferida or status='aprovada' or conferida_por is not null)) then raise exception 'Autoria/conferência inventada.';end if;
  if exists(select 1 from radar.memorias_editoriais where redacao_id=r and autor_id is not null) then raise exception 'Autoria da memória inventada.';end if;
  res:=res||jsonb_build_array('Aprovação legada exige ratificação, sem inventar autor');
  if (select count(*) from radar.legado_registros where redacao_id=r and tipo='evento')<>jsonb_array_length(v->'events') then raise exception 'Evento perdido.';end if;
  if exists(select 1 from radar.eventos where redacao_id=r and origem='importada' and autor_id is not null) then raise exception 'Autor legado inventado.';end if;
  res:=res||jsonb_build_array('Eventos e snapshots completos mantêm autoria desconhecida');
  if saida::text like '%segredo-ficticio-123456%' or saida::text like '%sk-ant-testeabcdefghijklmnop%' then raise exception 'Segredo em export.';end if;
  res:=res||jsonb_build_array('Credenciais em chaves aninhadas e em texto são removidas');
  if (public.tn_confirmar_importacao(r,iid,true,'Repetição de teste.')->>'ja_importado')::boolean is not true then raise exception 'Idempotência incorreta.';end if;
  if (public.tn_prever_importacao(r,v)->>'id')::uuid<>iid then raise exception 'Prévia duplicada.';end if;
  res:=res||jsonb_build_array('Mesmo arquivo e confirmação repetida não duplicam registros');
  previa:=public.tn_prever_importacao(r,v||'{"campoExtra":"outro arquivo"}'::jsonb);
  perform pg_temp.assert_error(format('select public.tn_confirmar_importacao(%L,%L,true,''Colisão de teste'')',r,previa->>'id'),'23505');
  res:=res||jsonb_build_array('Colisão entre arquivos bloqueia sobrescrita de IDs');
  execute 'reset role';
  if (select payload from radar.importacoes where id=iid)::text like '%segredo-ficticio-123456%' then raise exception 'Credencial persistida.';end if;
  res:=res||jsonb_build_array('Credencial removida antes de gravar no banco');
  perform pg_temp.assert_error(format('update radar.legado_registros set original=''{}'' where redacao_id=%L',r),'55000');
  res:=res||jsonb_build_array('Registros originais importados são imutáveis');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',redator,'session_id',sid2,'exp',extract(epoch from now()+interval '1 hour'),'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform pg_temp.assert_error(format('select public.tn_prever_importacao(%L,%L)',r,v),'42501');
  perform pg_temp.assert_error(format('select public.tn_confirmar_importacao(%L,%L,true,''teste'')',r,iid),'42501');
  perform pg_temp.assert_error(format('select public.tn_exportar(%L)',r),'42501');
  res:=res||jsonb_build_array('Redator não importa nem exporta a base por RPC direta');
  execute 'reset role';
  raise exception using errcode='PT999',message='Reverter fixtures.';
 exception when sqlstate 'PT999' then null;
 end;
 if exists(select 1 from auth.users where id in (u,redator)) or exists(select 1 from radar.redacoes where id=r) then raise exception 'Fixtures não foram revertidas.';end if;
 return jsonb_build_object('status','PASS','total',jsonb_array_length(res),'testes',res,'fixtures_revertidas',true);
end $$;
