create or replace function radar_internal.confirmar_importacao(r uuid,iid uuid,confirmacao boolean,nota text) returns jsonb language plpgsql security definer set search_path='' as $$
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
