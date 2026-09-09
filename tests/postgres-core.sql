-- Teste real de Postgres, com dados fictícios revertidos por subtransação.
-- Funções auxiliares são temporárias e não fazem parte da aplicação.
create or replace function pg_temp.expect_error(stmt text, esperado text) returns text language plpgsql as $$
begin
 begin execute stmt;
 exception when others then
  if sqlstate=esperado then return sqlerrm; end if;
  raise;
 end;
 raise exception 'A operação deveria ter falhado com SQLSTATE %',esperado;
end $$;
create or replace function pg_temp.testar_core_radar() returns jsonb language plpgsql as $$
declare
 chefe uuid:=gen_random_uuid(); redator uuid:=gen_random_uuid(); leitor uuid:=gen_random_uuid();
 sch uuid:=gen_random_uuid(); sre uuid:=gen_random_uuid(); sle uuid:=gen_random_uuid();
 redacao uuid:=gen_random_uuid(); outra uuid:=gen_random_uuid(); pid uuid;
 resultado jsonb:='[]'; resposta jsonb; snapshot_aprovado jsonb; rev bigint; ver int; total int; msg text; i int;
 doc uuid; fonte uuid; hash text; lista jsonb; dados jsonb;
begin
 begin
  insert into auth.users(id,aud,role,email) values
   (chefe,'authenticated','authenticated',chefe::text||'@teste.invalid'),
   (redator,'authenticated','authenticated',redator::text||'@teste.invalid'),
   (leitor,'authenticated','authenticated',leitor::text||'@teste.invalid');
  insert into auth.sessions(id,user_id,not_after) values(sch,chefe,now()+interval '1 hour'),(sre,redator,now()+interval '1 hour'),(sle,leitor,now()+interval '1 hour');
  insert into radar.usuarios(id,nome) values(chefe,'Chefe de teste'),(redator,'Redator de teste'),(leitor,'Leitor de teste');
  insert into radar.redacoes(id,slug,nome) values(redacao,'teste-'||redacao,'Redação temporária'),(outra,'teste-'||outra,'Outra redação temporária');
  insert into radar.membros_redacao(redacao_id,usuario_id,papel) values(redacao,chefe,'editor_chefe'),(redacao,redator,'redator'),(redacao,leitor,'leitor');
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',chefe,'session_id',sch,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
  execute 'set local role authenticated';
  resposta:=public.tn_comando(redacao,null,'criar',null,'{"titulo":"Pauta temporária de teste","localidade":"Pecém","categoria":"Serviço"}','Criar registro exclusivamente para teste.');
  pid:=(resposta#>>'{pauta,id}')::uuid;rev:=(resposta#>>'{pauta,revisao_registro}')::bigint;
  if resposta#>>'{pauta,status}'<>'apurar' or resposta#>>'{rascunho,texto_site}'<>'' then raise exception 'Criação indevida de rascunho ou status.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Criação nasce em apurar e sem texto','resultado','PASS'));

  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''aprovar'',%s,''{}'',''Revisão de teste.'')',redacao,pid,rev),'22023');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Aprovação sem conferência é rejeitada','resultado','PASS','evidencia',msg));
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''descartar'',%s,''{}'',''   '')',redacao,pid,rev),'22023');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Descarte sem nota é rejeitado','resultado','PASS','evidencia',msg));
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''conferir_pacote'',%s,%L,''Conferência de teste.'')',redacao,pid,rev,'{"confirmacao_humana":true}'),'22023');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Conferência sem evidência e fonte é rejeitada','resultado','PASS','evidencia',msg));

  dados:='{"evidencia":"Texto fictício lido apenas pelo teste; não é notícia.","url_fonte":"https://example.org/documento","data_documento":"2026-09-04","data_fato":"2026-09-03","rascunho":{"titulo_editorial":"Título de teste","texto_site":"Texto de teste.","instagram":"Legenda de teste.","stories":["Tela 1","Tela 2","Tela 3"]}}';
  resposta:=public.tn_comando(redacao,pid,'editar',rev,dados,'Preparar pacote fictício para teste.');
  rev:=(resposta#>>'{pauta,revisao_registro}')::bigint;
  if resposta#>>'{pauta,data_documento}'<>'2026-09-04' or resposta#>>'{pauta,data_fato}'<>'2026-09-03' then raise exception 'Datas misturadas.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Data do documento e data do fato permanecem distintas','resultado','PASS'));
  resposta:=public.tn_comando(redacao,pid,'conferir_evidencia',rev,'{"confirmacao_humana":true}','Evidência fictícia conferida no teste.');
  rev:=(resposta#>>'{pauta,revisao_registro}')::bigint;
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''aprovar'',%s,''{}'',''Apenas evidência conferida.'')',redacao,pid,rev),'22023');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Conferir evidência não libera aprovação do pacote','resultado','PASS','evidencia',msg));
  resposta:=public.tn_comando(redacao,pid,'conferir_pacote',rev,'{"confirmacao_humana":true}','Pacote completo conferido no teste.');rev:=(resposta#>>'{pauta,revisao_registro}')::bigint;
  if (resposta#>>'{pauta,versao}')::int<>2 then raise exception 'Conferir não pode alterar a versão editorial.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Conferência fica vinculada à versão e ao autor','resultado','PASS'));

  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',redator,'session_id',sre,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
  execute 'set local role authenticated';
  lista:=public.tn_listar_pautas(redacao,100);
  if jsonb_array_length(lista)<>1 or lista#>>'{0,pauta,id}'<>pid::text then raise exception 'Fila diferente para redator.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Outra sessão autenticada consulta a mesma pauta','resultado','PASS','limite','Teste SQL; dois navegadores e Realtime ainda pendentes.'));
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''aprovar'',%s,''{}'',''Tentativa como redator.'')',redacao,pid,rev),'42501');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Redator não aprova em chamada direta à função da API','resultado','PASS','evidencia',msg));
  msg:=pg_temp.expect_error(format('update radar.pautas set titulo=''Alteração direta'' where id=%L',pid),'42501');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Escrita direta em tabela é bloqueada','resultado','PASS','evidencia',msg));
  msg:=pg_temp.expect_error(format('select public.tn_listar_pautas(%L,100)',outra),'42501');
  select count(*) into total from radar.pautas where redacao_id=outra;
  if total<>0 then raise exception 'RLS vazou outra redação.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Isolamento de redações na função e na leitura com RLS','resultado','PASS','evidencia',msg));

  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',chefe,'session_id',sch,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
  execute 'set local role authenticated';
  snapshot_aprovado:=public.tn_comando(redacao,pid,'aprovar',rev,'{}','Decisão editorial fictícia para teste.');
  rev:=(snapshot_aprovado#>>'{pauta,revisao_registro}')::bigint;ver:=(snapshot_aprovado#>>'{pauta,versao}')::int;
  if snapshot_aprovado#>>'{pauta,status}'<>'aprovada' then raise exception 'Fluxo válido não aprovou.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Chefe aprova pacote completo após conferência humana','resultado','PASS'));
  resposta:=public.tn_comando(redacao,pid,'editar',rev,'{"rascunho":{"texto_site":"Texto alterado para testar nova revisão."}}','Texto corrigido no teste.');
  if (resposta#>>'{pauta,versao}')::int<>ver+1 or resposta#>>'{pauta,status}'<>'revisar' or (resposta#>>'{pauta,conferida}')::boolean or resposta#>'{pauta,aprovacao_atual_id}'<>'null'::jsonb then raise exception 'Edição não invalidou aprovação.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Edição sobe versão, retira conferência e aprovação e devolve a revisar','resultado','PASS'));
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''nota'',%s,''{}'',''Revisão antiga.'')',redacao,pid,rev),'40001');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Revisão concorrente desatualizada é rejeitada','resultado','PASS','evidencia',msg));
  rev:=(resposta#>>'{pauta,revisao_registro}')::bigint;
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''aprovar'',%s,''{}'',''Conferência anterior não vale.'')',redacao,pid,rev),'22023');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Conferência da versão anterior não aprova a nova','resultado','PASS','evidencia',msg));

  execute 'reset role';
  if not exists(select 1 from radar.eventos e where e.pauta_id=pid and e.acao='aprovar' and e.snapshot=snapshot_aprovado) then raise exception 'Snapshot aprovado foi perdido.';end if;
  msg:=pg_temp.expect_error(format('update radar.eventos set nota=''reescrever passado'' where pauta_id=%L',pid),'55000');
  perform pg_temp.expect_error(format('delete from radar.eventos where pauta_id=%L',pid),'55000');
  perform pg_temp.expect_error('truncate radar.eventos','55000');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Histórico preserva snapshot completo e bloqueia UPDATE/DELETE/TRUNCATE','resultado','PASS','evidencia',msg));
  perform pg_temp.expect_error(format('update radar.rascunhos set texto_site=''reescrever'' where pauta_id=%L',pid),'55000');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Rascunhos de versões anteriores são imutáveis','resultado','PASS'));
  if exists(select 1 from radar.eventos e where e.redacao_id=redacao and e.hash_evento<>radar_internal.hash_texto(jsonb_build_array(e.hash_anterior,e.id,e.redacao_id,e.pauta_id,e.acao,e.autor_id,e.ocorrido_em,e.versao,e.nota,e.snapshot)::text)) then raise exception 'Hash de auditoria inconsistente.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Hashes de auditoria correspondem aos eventos completos','resultado','PASS'));

  for i in 0..4 loop
   if radar_internal.score_regularizado(i,1)>65 or radar_internal.score_regularizado(i,-1)<35 then raise exception 'Confiança prematura.';end if;
  end loop;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Fórmula de score com 0 a 4 decisões permanece entre 35 e 65','resultado','PASS','limite','Fórmula testada; treinamento da fila ainda não conectado.'));
  if radar_internal.url_valida('javascript:alert(1)') or radar_internal.url_valida('https://') or not radar_internal.url_valida('https://example.org/documento') then raise exception 'Validação de URL falhou.';end if;
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Validador rejeita esquemas perigosos e URL incompleta','resultado','PASS'));

  hash:=radar_internal.hash_texto('Conteúdo idêntico de documento fictício.');
  insert into radar.fontes(redacao_id,nome,url,tipo) values(redacao,'Fonte fictícia','https://example.org','html') returning id into fonte;
  insert into radar.documentos(redacao_id,hash_conteudo,titulo,texto_extraido) values(redacao,hash,'Documento fictício','Conteúdo idêntico de documento fictício.') returning id into doc;
  insert into radar.documentos(redacao_id,hash_conteudo,titulo,texto_extraido) values(redacao,hash,'Documento fictício','Conteúdo idêntico de documento fictício.') on conflict(redacao_id,versao_normalizacao,hash_conteudo) do nothing;
  insert into radar.documento_ocorrencias(redacao_id,documento_id,fonte_id,url) values(redacao,doc,fonte,'https://example.org/primeira'),(redacao,doc,fonte,'https://example.org/republicacao');
  select count(*) into total from radar.documentos where redacao_id=redacao and hash_conteudo=hash;
  if total<>1 then raise exception 'Hash duplicado.';end if;
  insert into radar.pautas(redacao_id,titulo,localidade,categoria,documento_id,origem) values(redacao,'Documento candidato','Pecém','Serviço',doc,'coleta_automatica');
  perform pg_temp.expect_error(format('insert into radar.pautas(redacao_id,titulo,localidade,categoria,documento_id) values(%L,''Duplicada'',''Pecém'',''Serviço'',%L)',redacao,doc),'23505');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Hash único e vínculo único impedem dois documentos/pautas para duas URLs','resultado','PASS','limite','Restrições do banco; coletor HTTP ainda pendente.'));

  perform set_config('request.jwt.claims',jsonb_build_object('sub',leitor,'session_id',sle,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
  execute 'set local role authenticated';
  perform public.tn_listar_pautas(redacao,100);
  msg:=pg_temp.expect_error(format('select public.tn_comando(%L,%L,''nota'',%s,''{}'',''Leitor tenta escrever.'')',redacao,pid,rev),'42501');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Leitor pode consultar e não pode alterar','resultado','PASS','evidencia',msg));
  execute 'reset role';
  update auth.sessions set not_after=now()-interval '1 minute' where id=sle;
  execute 'set local role authenticated';
  msg:=pg_temp.expect_error(format('select public.tn_listar_pautas(%L,100)',redacao),'42501');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Sessão expirada perde acesso','resultado','PASS','evidencia',msg));
  execute 'reset role';execute 'set local role anon';
  msg:=pg_temp.expect_error(format('select public.tn_listar_pautas(%L,100)',redacao),'42501');
  resultado:=resultado||jsonb_build_array(jsonb_build_object('teste','Acesso anônimo é bloqueado','resultado','PASS','evidencia',msg));
  execute 'reset role';
  raise exception using errcode='PT999',message='Reverter todos os registros de teste.';
 exception when sqlstate 'PT999' then null;
 end;
 if exists(select 1 from radar.redacoes where id in (redacao,outra)) or exists(select 1 from auth.users where id in (chefe,redator,leitor)) then raise exception 'Limpeza dos testes falhou.';end if;
 return jsonb_build_object('status','PASS','total',jsonb_array_length(resultado),'testes',resultado,'fixtures_revertidas',true,'banco','PostgreSQL real no Supabase');
end $$;
select pg_temp.testar_core_radar() as relatorio;
