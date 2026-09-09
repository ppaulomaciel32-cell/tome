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

select pg_temp.testar_importacao($fixture${"format":"tome-nota-local-v1","items":[{"id":"TN-ARQUIVO-01","title":"Boletim de vagas do IDT — 04/09/2026","locality":"Ceará / Pecém","category":"Emprego","url":"https://www.idt.org.br/vagas-disponiveis/7395","docDate":"2026-09-04","factDate":"2026-09-04","evidence":"Boletim identificado no teste com data de 04/09/2026, às 16h33. A existência deste boletim não comprova vagas abertas hoje. A unidade de atendimento não determina o local do emprego.","note":"Consultar um boletim atualizado antes de redigir.","status":"aprovada","version":7,"checked":true,"draft":{"title":"Teste de migração, sem valor jornalístico","site":"Conteúdo fictício de teste.","instagram":"Legenda fictícia","stories":"Tela livre 1\n\nTela livre 2\nTela livre 3"}},{"id":"TN-ARQUIVO-02","title":"Lista de presença e ausência da 26ª convocação","locality":"São Gonçalo do Amarante/CE","category":"Serviço","url":"https://saogoncalodoamarante.ce.gov.br/processoseletivo.php?grup=39","docDate":"2026-09-04","factDate":"","evidence":"A tabela consultada no teste mostra uma lista de presença e ausência da 26ª convocação em 04/09/2026. Há divergência entre o número informado na descrição (030) e na coluna do documento (039/2026).","note":"Ler o documento integral e esclarecer a numeração antes de afirmar prazos ou nomes.","status":"apurar","version":1,"checked":false,"draft":{"title":"","site":"","instagram":"","stories":""}},{"id":"TN-ARQUIVO-03","title":"V Prêmio de Comunicação AECIPP — anúncio anterior","locality":"Complexo do Pecém","category":"Comunicação","url":"https://aecipp.com.br/aecipp-lanca-v-premio-de-comunicacao-com-foco-no-papel-do-cipp-na-nova-economia-do-ceara/","docDate":"","factDate":"","evidence":"Anúncio de agosto identificado no teste. O prazo informado no material anterior era 27/10/2026; conferir regulamento e eventuais alterações. Este registro não constitui novidade.","note":"Verificar regras e prazo no documento vigente.","status":"apurar","version":1,"checked":false,"draft":{"title":"","site":"","instagram":"","stories":""}}],"memories":[{"content":"Priorizar São Gonçalo do Amarante/CE, Pecém, Taíba, Siupé, Paracuru, Paraipaba e Caucaia. Grande Fortaleza quando houver impacto regional.","at":null},{"content":"Não reciclar notícia antiga como novidade. Conferir documento, data do fato e prazos. Polícia, morte, acidente, denúncia, política e saúde exigem revisão humana explícita.","at":null},{"content":"Curta","at":null}],"events":[{"at":"2026-09-07T12:30:00Z","action":"Aprovação editorial local","id":"TN-ARQUIVO-01","title":"Boletim de vagas do IDT — 04/09/2026","version":7,"note":"Nota de teste","snapshot":{"id":"TN-ARQUIVO-01","title":"Boletim de vagas do IDT — 04/09/2026","locality":"Ceará / Pecém","category":"Emprego","url":"https://www.idt.org.br/vagas-disponiveis/7395","docDate":"2026-09-04","factDate":"2026-09-04","evidence":"Boletim identificado no teste com data de 04/09/2026, às 16h33. A existência deste boletim não comprova vagas abertas hoje. A unidade de atendimento não determina o local do emprego.","note":"Consultar um boletim atualizado antes de redigir.","status":"aprovada","version":7,"checked":true,"draft":{"title":"Teste de migração, sem valor jornalístico","site":"Conteúdo fictício de teste.","instagram":"Legenda fictícia","stories":"Tela livre 1\n\nTela livre 2\nTela livre 3"}}},{"at":null,"action":"Registro incompleto antigo","title":"Sem ID no original","detalhe":"Dado adicional de negócio"}],"profile":{"weights":{"pecem":2},"decisions":4},"extra":{"editorial":"Conservar este conteúdo","api_key":"segredo-ficticio-123456","nested":{"password":"segredo-ficticio-123456","texto":"sk-ant-testeabcdefghijklmnop"}}}$fixture$::jsonb) as relatorio;
