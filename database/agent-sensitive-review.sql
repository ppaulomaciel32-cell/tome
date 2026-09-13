-- A classificação sensível do agente também exige conferência específica no servidor.
do $$ declare definition text; target text; replacement text; begin
 select pg_get_functiondef('radar_internal.comando(uuid,uuid,text,bigint,jsonb,text)'::regprocedure) into definition;
 target:=$s$if p.categoria ~* '(pol[ií]cia|sa[uú]de|pol[ií]tica|acidente|morte|den[uú]ncia|acusa[cç][aã]o)' and not coalesce((dados->>'revisao_sensivel')::boolean,false) then$s$;
 replacement:=$s$if (p.categoria ~* '(pol[ií]cia|sa[uú]de|pol[ií]tica|acidente|morte|den[uú]ncia|acusa[cç][aã]o)' or exists(select 1 from radar.agentes_pautas ap join radar.agentes_monitoramento ag on ag.id=ap.agente_id and ag.redacao_id=ap.redacao_id where ap.pauta_id=p.id and ap.redacao_id=r and ag.revisao_sensivel)) and not coalesce((dados->>'revisao_sensivel')::boolean,false) then$s$;
 if position(target in definition)=0 then raise exception 'Trava editorial mudou; revisar migração antes de aplicar.';end if;
 execute replace(definition,target,replacement);
end $$;
