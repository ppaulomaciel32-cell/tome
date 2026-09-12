-- Isolated fixtures; no real user session is read or impersonated. Everything rolls back.
begin;
create function pg_temp.check_gestao_draft() returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); p uuid; t uuid; result jsonb; checks jsonb:='[]';
begin
 insert into auth.users(id,aud,role,email) values(u,'authenticated','authenticated',u||'@teste.invalid');
 insert into auth.sessions(id,user_id,not_after) values(sid,u,now()+interval '1 hour');
 insert into radar.usuarios(id,nome) values(u,'Fixture diagnóstico');
 insert into radar.redacoes(id,slug,nome) values(r,'teste-'||r,'Fixture temporária');
 insert into radar.membros_redacao(redacao_id,usuario_id,papel) values(r,u,'redator');
 insert into radar.pautas(redacao_id,titulo,localidade,categoria,origem) values(r,'Candidato sem rascunho','Pecém','Serviço','coleta_automatica') returning id into p;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'role','authenticated','exp',extract(epoch from now()+interval '1 hour'))::text,true);
 execute 'set local role authenticated';
 result:=public.tn_comando(r,p,'editar',1,'{"rascunho":{"titulo_editorial":"Título de teste","texto_site":"Texto de teste"}}','Edição humana de candidato sem texto.');
 if result#>>'{rascunho,texto_site}'<>'Texto de teste' or result#>>'{pauta,status}'<>'revisar' or (result#>>'{pauta,versao}')::int<>2 then raise exception 'Edição do candidato falhou';end if;
 checks:=checks||'"Candidato sem rascunho pode ser editado, sobe versão e não aprova"'::jsonb;
 result:=public.tn_comando_gestao(r,null,'criar','{"titulo":"Fixture tarefa","categoria":"Rotina","frente":"grupo"}','Criar fixture temporária.');
 t:=(result->>'id')::uuid;
 result:=public.tn_comando_gestao(r,t,'concluir','{}','Concluir fixture temporária.');
 if result->>'status'<>'concluida' then raise exception 'Conclusão falhou'; end if;
 result:=public.tn_painel_gestao(r);
 if jsonb_array_length(result->'tarefas')<>1 or jsonb_array_length(result->'eventos')<>2 then raise exception 'Consulta ou auditoria falhou'; end if;
 checks:=checks||'"Redator cria, conclui e consulta tarefa e dois eventos pelo banco"'::jsonb;
 begin perform public.tn_comando_gestao(r,t,'adiar','{}',' ');raise exception 'Aceitou nota vazia';exception when sqlstate '22023' then null;end;
 execute 'reset role';
 update radar.membros_redacao set papel='leitor' where redacao_id=r and usuario_id=u;
 execute 'set local role authenticated';
 perform public.tn_painel_gestao(r);
 begin perform public.tn_comando_gestao(r,t,'reabrir','{}','Tentativa não autorizada.');raise exception 'Leitor escreveu';exception when sqlstate '42501' then null;end;
 execute 'reset role';
 return checks||'"Nota vazia recusada; leitor consulta mas não escreve"'::jsonb;
end $$;
select pg_temp.check_gestao_draft() as testes;
rollback;
