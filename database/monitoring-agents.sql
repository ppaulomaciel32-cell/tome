-- Primeira etapa: triagem por regras, sem chamadas de IA nem publicação editorial.
begin;
create table radar.agentes_monitoramento (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null references radar.redacoes(id),
 numero int not null check(numero between 1 and 10), slug text not null, nome text not null,
 instrucao text not null, padrao_titulo text not null, prioridade int not null,
 ativo boolean not null default true, revisao_sensivel boolean not null default false,
 versao int not null default 1, metodo text not null default 'regras_v1' check(metodo='regras_v1'),
 criado_em timestamptz not null default now(),
 unique(redacao_id,id), unique(redacao_id,numero), unique(redacao_id,slug)
);
create table radar.agentes_fontes (
 redacao_id uuid not null, agente_id uuid not null, fonte_id uuid not null,
 primary key(redacao_id,agente_id,fonte_id),
 foreign key(redacao_id,agente_id) references radar.agentes_monitoramento(redacao_id,id),
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id)
);
create index agentes_fontes_fonte on radar.agentes_fontes(redacao_id,fonte_id);
create table radar.execucoes_agentes (
 id uuid primary key default gen_random_uuid(), redacao_id uuid not null,
 agente_id uuid not null, fonte_id uuid not null, pauta_id uuid not null,
 inicio timestamptz not null, fim timestamptz not null, latencia_ms numeric not null check(latencia_ms>=0),
 metodo text not null check(metodo='regras_v1'), versao_regra int not null,
 motivo text not null check(length(btrim(motivo))>0), snapshot jsonb not null,
 chamadas_ia int not null default 0 check(chamadas_ia=0), tokens int not null default 0 check(tokens=0),
 custo_ia_usd numeric not null default 0 check(custo_ia_usd=0), custo_infra_usd numeric default null,
 unique(redacao_id,id), unique(redacao_id,pauta_id),
 foreign key(redacao_id,agente_id) references radar.agentes_monitoramento(redacao_id,id),
 foreign key(redacao_id,fonte_id) references radar.fontes(redacao_id,id),
 foreign key(redacao_id,pauta_id) references radar.pautas(redacao_id,id)
);
create index execucoes_agentes_agente on radar.execucoes_agentes(redacao_id,agente_id,fim desc);
create index execucoes_agentes_fonte on radar.execucoes_agentes(redacao_id,fonte_id,fim desc);
create table radar.agentes_pautas (
 redacao_id uuid not null, pauta_id uuid not null, agente_id uuid not null, execucao_id uuid not null,
 motivo text not null, versao_pauta int not null, atribuido_em timestamptz not null default now(),
 primary key(redacao_id,pauta_id),
 foreign key(redacao_id,pauta_id) references radar.pautas(redacao_id,id),
 foreign key(redacao_id,agente_id) references radar.agentes_monitoramento(redacao_id,id),
 foreign key(redacao_id,execucao_id) references radar.execucoes_agentes(redacao_id,id)
);
create index agentes_pautas_agente on radar.agentes_pautas(redacao_id,agente_id);
create index agentes_pautas_execucao on radar.agentes_pautas(redacao_id,execucao_id);

insert into radar.agentes_monitoramento(redacao_id,numero,slug,nome,instrucao,padrao_titulo,prioridade,revisao_sensivel)
select r.id,v.* from radar.redacoes r cross join (values
 (1,'cidade-ocorrencias','Cidade e ocorrências','Acidentes, trânsito e emergências; levantar candidatos, exigir confirmação humana.','acidente|colis[aã]o|inc[eê]ndio|alagamento|tr[aâ]nsito|emerg[eê]ncia',90,true),
 (2,'empregos','Empregos','Verificar requisitos, prazo e local real do emprego. Não afirmar vaga aberta sem conferir.','emprego|vagas|concurso|sele[cç][aã]o|capacita[cç][aã]o',80,false),
 (3,'investimentos','Investimentos','Separar anúncio, contrato, obra e investimento executado.','investimento|ind[uú]stria|industrial|porto|obra',65,false),
 (4,'cotidiano','Cotidiano','Serviços, rotina, cultura e bairros; destino provisório quando nenhum sinal específico existe.','abastecimento|energia|transporte|escola|cultura|festival|servi[cç]o',10,false),
 (5,'economia-bairros','Economia dos bairros','Negócios locais, cooperativas, comércio e economia social.','cooperativa|com[eé]rcio|empreendedor|pequenos neg[oó]cios|economia solid[aá]ria',60,false),
 (6,'ia-economia-local','IA e economia local','Exigir aplicação concreta para negócios e trabalhadores locais.','intelig[eê]ncia artificial|automa[cç][aã]o|tecnologia|digitaliza[cç][aã]o',75,false),
 (7,'politica-bastidores','Política e bastidores','Somente atos e declarações públicas documentadas; não inferir alianças.','prefeito|elei[cç][aã]o|elei[cç][oõ]es|nomea[cç][aã]o|partido|pol[ií]tica',55,true),
 (8,'controversias-denuncias','Controvérsias e denúncias','Rumores são pistas; registrar origem e lacunas, nunca tratar acusação como fato.','den[uú]ncia|esc[aâ]ndalo|briga|fofoca|investiga[cç][aã]o|acusa[cç][aã]o',95,true),
 (9,'macro-repercussao','Macro e repercussão','Exigir impacto local; repercussão depende de métricas, nunca de impressão da IA.','infla[cç][aã]o|selic|congresso nacional|governo federal|economia nacional',50,false),
 (10,'camara-vereadores','Câmara e vereadores','Atos públicos da Câmara de São Gonçalo do Amarante/CE; ausência de dados não significa ausência de atuação.','vereador|vereadora|c[aâ]mara|sess[aã]o plen[aá]ria|requerimento|projeto de lei',100,true)
) v(numero,slug,nome,instrucao,padrao_titulo,prioridade,revisao_sensivel);

-- Todos usam a coleta compartilhada: uma única leitura por fonte e um responsável por candidato.
insert into radar.agentes_fontes select a.redacao_id,a.id,f.id from radar.agentes_monitoramento a join radar.fontes f using(redacao_id);

create function radar_internal.vincular_fonte_agentes() returns trigger language plpgsql set search_path='' as $$
begin
 insert into radar.agentes_fontes select new.redacao_id,a.id,new.id from radar.agentes_monitoramento a where a.redacao_id=new.redacao_id;
 return new;
end $$;
create trigger vincular_agentes after insert on radar.fontes for each row execute function radar_internal.vincular_fonte_agentes();

create function radar_internal.atribuir_agente() returns trigger language plpgsql set search_path='' as $$
declare a radar.agentes_monitoramento; f radar.fontes; motivo text; iniciado timestamptz:=clock_timestamp(); terminado timestamptz; eid uuid:=gen_random_uuid();
begin
 if new.origem<>'coleta_automatica' or new.fonte_id is null then return new; end if;
 select * into f from radar.fontes where id=new.fonte_id and redacao_id=new.redacao_id;
 select x.* into a from radar.agentes_monitoramento x
 join radar.agentes_fontes af on af.redacao_id=x.redacao_id and af.agente_id=x.id and af.fonte_id=new.fonte_id
 where x.redacao_id=new.redacao_id and x.ativo and (
  x.slug=f.regra_extracao->>'agente_slug' or new.titulo ~* x.padrao_titulo or x.slug='cotidiano')
 order by (x.slug=coalesce(f.regra_extracao->>'agente_slug','')) desc,
  (new.titulo ~* x.padrao_titulo) desc,x.prioridade desc,x.numero limit 1;
 if a.id is null then return new; end if;
 motivo:=case when a.slug=f.regra_extracao->>'agente_slug' then 'Fonte vinculada explicitamente ao agente: '||f.nome
  when new.titulo ~* a.padrao_titulo then 'Sinal no título: '||substring(new.titulo from ('(?i)('||a.padrao_titulo||')'))
  else 'Triagem geral provisória: nenhum sinal específico no título; categoria a conferir.' end;
 terminado:=clock_timestamp();
 insert into radar.execucoes_agentes(id,redacao_id,agente_id,fonte_id,pauta_id,inicio,fim,latencia_ms,metodo,versao_regra,motivo,snapshot)
 values(eid,new.redacao_id,a.id,new.fonte_id,new.id,iniciado,terminado,extract(epoch from terminado-iniciado)*1000,'regras_v1',a.versao,motivo,
  jsonb_build_object('pauta',to_jsonb(new),'agente',to_jsonb(a),'fonte',jsonb_build_object('id',f.id,'nome',f.nome,'url',f.url),'rascunho',null));
 insert into radar.agentes_pautas(redacao_id,pauta_id,agente_id,execucao_id,motivo,versao_pauta)
 values(new.redacao_id,new.id,a.id,eid,motivo,new.versao);
 perform radar_internal.registrar_evento(new.redacao_id,new.id,'agente_atribuido',null,
  'Agente '||a.numero||' — '||a.nome||'. '||motivo||' Método: regras_v1; 0 chamadas de IA.');
 return new;
end $$;

-- O snapshot editorial passa a incluir a atribuição. Eventos anteriores permanecem intactos.
create or replace function radar_internal.snapshot(p uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('pauta',to_jsonb(x),'rascunho',to_jsonb(d),'conferencia',to_jsonb(c),'conferencia_evidencia',to_jsonb(e),'aprovacao',to_jsonb(a),
  'agente_responsavel',(select jsonb_build_object('id',ag.id,'numero',ag.numero,'nome',ag.nome,'metodo',ag.metodo,'execucao_id',ap.execucao_id,'motivo',ap.motivo,'versao_pauta',ap.versao_pauta)
    from radar.agentes_pautas ap join radar.agentes_monitoramento ag on ag.id=ap.agente_id where ap.pauta_id=x.id and ap.redacao_id=x.redacao_id))
 from radar.pautas x left join radar.rascunhos d on d.pauta_id=x.id and d.versao=x.versao
 left join radar.conferencias c on c.id=x.conferencia_atual_id
 left join radar.conferencias e on e.id=x.conferencia_evidencia_id
 left join radar.aprovacoes a on a.id=x.aprovacao_atual_id where x.id=p
$$;
create trigger atribuir_agente after insert on radar.pautas for each row execute function radar_internal.atribuir_agente();

create function radar_internal.painel_agentes(r uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform radar_internal.exigir_papel(r,array['editor_chefe','redator','leitor']::radar.papel[]);
 return jsonb_build_object('servidor_em',now(),'metodo','regras_v1','instagram','nao_conectado',
  'agentes',coalesce((select jsonb_agg(to_jsonb(x) order by x.numero) from (
   select a.id,a.numero,a.nome,a.instrucao,a.ativo,a.metodo,a.revisao_sensivel,
   (select count(*) from radar.execucoes_agentes e where e.agente_id=a.id) atribuicoes,
   (select max(fim) from radar.execucoes_agentes e where e.agente_id=a.id) ultima_atribuicao,
   (select count(*) from radar.agentes_fontes af join radar.fontes f on f.id=af.fonte_id where af.agente_id=a.id and f.ativa and f.estado_circuito<>'aberto') fontes_disponiveis
   from radar.agentes_monitoramento a where a.redacao_id=r)x),'[]'::jsonb),
  'fontes',coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (
   select id,nome,url,ativa,ultima_varredura,ultimo_sucesso,proxima_varredura,estado_circuito,ultimo_erro_texto from radar.fontes where redacao_id=r)x),'[]'::jsonb),
  'execucoes',coalesce((select jsonb_agg(to_jsonb(x) order by x.fim desc) from (
   select e.id,e.pauta_id,p.codigo,p.titulo,p.url_fonte,p.data_documento,p.data_fato,p.status,e.fim,e.motivo,e.latencia_ms,e.chamadas_ia,e.tokens,e.custo_ia_usd,e.custo_infra_usd,a.nome agente,f.nome fonte
   from radar.execucoes_agentes e join radar.pautas p on p.id=e.pauta_id join radar.agentes_monitoramento a on a.id=e.agente_id join radar.fontes f on f.id=e.fonte_id
   where e.redacao_id=r order by e.fim desc limit 30)x),'[]'::jsonb));
end $$;
create function public.tn_painel_agentes(redacao_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select radar_internal.painel_agentes(redacao_id) $$;

do $$ declare t text; begin
 foreach t in array array['agentes_monitoramento','agentes_fontes','execucoes_agentes','agentes_pautas'] loop
  execute format('alter table radar.%I enable row level security',t);
  execute format('alter table radar.%I force row level security',t);
  execute format('revoke all on radar.%I from public,anon,authenticated,service_role',t);
  execute format('create policy sem_acesso_direto on radar.%I for all to anon,authenticated using(false) with check(false)',t);
 end loop;
 foreach t in array array['execucoes_agentes','agentes_pautas'] loop
  execute format('create trigger impedir_alteracao before update or delete on radar.%I for each row execute function radar_internal.imutavel()',t);
  execute format('create trigger impedir_truncate before truncate on radar.%I for each statement execute function radar_internal.imutavel()',t);
 end loop;
end $$;
revoke execute on function radar_internal.atribuir_agente(),radar_internal.vincular_fonte_agentes() from public,anon,authenticated,service_role;
revoke execute on function radar_internal.painel_agentes(uuid),public.tn_painel_agentes(uuid) from public,anon,service_role;
grant execute on function radar_internal.painel_agentes(uuid),public.tn_painel_agentes(uuid) to authenticated;
commit;
