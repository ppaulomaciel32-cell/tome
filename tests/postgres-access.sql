create or replace function pg_temp.deve_recusar(stmt text,codigo text) returns void language plpgsql as $$
begin
 begin execute stmt;exception when others then if sqlstate=codigo then return;end if;raise;end;
 raise exception 'Era esperado o erro %',codigo;
end $$;
create or replace function pg_temp.testar_acesso_inicial() returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid(); intruso uuid:=gen_random_uuid(); sem_email uuid:=gen_random_uuid();
 sid uuid:=gen_random_uuid(); sid2 uuid:=gen_random_uuid(); sid3 uuid:=gen_random_uuid(); r uuid:=gen_random_uuid();
 email_autorizado text:=gen_random_uuid()||'@teste.invalid'; email_sem_confirmar text:=gen_random_uuid()||'@teste.invalid'; outra uuid:=gen_random_uuid();
 res jsonb:='[]'; c jsonb; qtd int;
begin
 begin
  insert into radar.redacoes(id,slug,nome) values(r,'acesso-teste-'||r,'Redação de teste'),(outra,'acesso-teste-'||outra,'Outra redação de teste');
  insert into radar.acessos_iniciais(redacao_id,email,nota_autorizacao) values(r,email_autorizado,'Autorização fictícia exclusivamente de teste.'),(outra,email_sem_confirmar,'Autorização fictícia exclusivamente de teste.');
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data) values
   (u,'authenticated','authenticated',email_autorizado,now(),'{}'),
   (intruso,'authenticated','authenticated',gen_random_uuid()||'@teste.invalid',now(),jsonb_build_object('email',email_autorizado,'papel','editor_chefe')),
   (sem_email,'authenticated','authenticated',email_sem_confirmar,null,'{}');
  insert into auth.sessions(id,user_id,not_after) values(sid,u,now()+interval '1 hour'),(sid2,intruso,now()+interval '1 hour'),(sid3,sem_email,now()+interval '1 hour');
  execute 'set local role anon';perform pg_temp.deve_recusar('select public.tn_ativar_acesso()','42501');execute 'reset role';
  res:=res||jsonb_build_array('Ativação anônima é bloqueada');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',intruso,'session_id',sid2,'exp',extract(epoch from now()+interval '1 hour'),'role','authenticated','email',email_autorizado,'user_metadata',jsonb_build_object('papel','editor_chefe','email',email_autorizado))::text,true);
  execute 'set local role authenticated';perform pg_temp.deve_recusar('select public.tn_ativar_acesso()','42501');execute 'reset role';
  if exists(select 1 from radar.usuarios where id=intruso) then raise exception 'Intruso recebeu acesso.';end if;
  res:=res||jsonb_build_array('Outro e-mail e user_metadata falsificado não obtêm papel');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',sem_email,'session_id',sid3,'exp',extract(epoch from now()+interval '1 hour'),'role','authenticated')::text,true);
  execute 'set local role authenticated';perform pg_temp.deve_recusar('select public.tn_ativar_acesso()','42501');execute 'reset role';
  res:=res||jsonb_build_array('E-mail sem confirmação não ativa a reserva');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'exp',extract(epoch from now()-interval '1 hour'),'role','authenticated')::text,true);
  execute 'set local role authenticated';perform pg_temp.deve_recusar('select public.tn_ativar_acesso()','28000');execute 'reset role';
  res:=res||jsonb_build_array('Token expirado não ativa a reserva');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'exp',extract(epoch from now()+interval '1 hour'),'role','authenticated')::text,true);
  update auth.sessions set not_after=now()-interval '1 minute' where id=sid;
  execute 'set local role authenticated';perform pg_temp.deve_recusar('select public.tn_ativar_acesso()','28000');execute 'reset role';
  update auth.sessions set not_after=now()+interval '1 hour' where id=sid;
  res:=res||jsonb_build_array('Sessão revogada ou vencida não ativa a reserva');
  execute 'set local role authenticated';c:=public.tn_ativar_acesso();execute 'reset role';
  if c#>>'{redacoes,0,papel}'<>'editor_chefe' or not exists(select 1 from radar.acessos_iniciais where redacao_id=r and situacao='utilizado' and utilizada_por=u) then raise exception 'Acesso confirmado não foi concedido.';end if;
  res:=res||jsonb_build_array('E-mail confirmado e reservado recebe editor-chefe');
  select count(*) into qtd from radar.eventos where redacao_id=r and acao='primeiro_editor_chefe_ativado';
  if qtd<>1 or not exists(select 1 from radar.eventos where redacao_id=r and autor_id=u and snapshot#>>'{associacao,papel}'='editor_chefe') then raise exception 'Auditoria ausente.';end if;
  res:=res||jsonb_build_array('Ativação guarda autor e snapshot completo da autorização');
  execute 'set local role authenticated';perform public.tn_ativar_acesso();execute 'reset role';
  if (select count(*) from radar.eventos where redacao_id=r and acao='primeiro_editor_chefe_ativado')<>qtd then raise exception 'Ativação repetida duplicou evento.';end if;
  res:=res||jsonb_build_array('Novo login não duplica ativação nem permissão');
  update radar.membros_redacao set papel='redator' where redacao_id=r and usuario_id=u;
  execute 'set local role authenticated';c:=public.tn_ativar_acesso();execute 'reset role';
  if c#>>'{redacoes,0,papel}'<>'redator' then raise exception 'Reserva restaurou privilégio removido.';end if;
  res:=res||jsonb_build_array('Reserva consumida não restaura privilégio posteriormente removido');
  execute 'set local role authenticated';perform pg_temp.deve_recusar('select * from radar.acessos_iniciais','42501');execute 'reset role';
  res:=res||jsonb_build_array('Lista de e-mails reservados não é consultável pelo cliente');
  if exists(select 1 from radar.eventos e where e.redacao_id=r and e.hash_evento<>radar_internal.hash_texto(jsonb_build_array(e.hash_anterior,e.id,e.redacao_id,e.pauta_id,e.acao,e.autor_id,e.ocorrido_em,e.versao,e.nota,e.snapshot)::text)) then raise exception 'Hash da auditoria inconsistente.';end if;
  res:=res||jsonb_build_array('Auditoria da ativação mantém a cadeia de hashes');
  raise exception using errcode='PT999',message='Reverter registros de teste.';
 exception when sqlstate 'PT999' then null;
 end;
 if exists(select 1 from auth.users where id in (u,intruso,sem_email)) or exists(select 1 from radar.redacoes where id in (r,outra)) then raise exception 'Fixtures não foram revertidas.';end if;
 return jsonb_build_object('status','PASS','total',jsonb_array_length(res),'testes',res,'fixtures_revertidas',true);
end $$;
select pg_temp.testar_acesso_inicial() as relatorio;
