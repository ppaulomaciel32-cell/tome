-- Only a human editorial command initializes an empty draft record.
-- Collection still creates candidates without drafting, approving or publishing.
do $repair$
declare definition text; old_line text := 'select * into strict d from radar.rascunhos where pauta_id=p.id and versao=p.versao;';
begin
 definition := pg_get_functiondef('radar_internal.comando(uuid,uuid,text,bigint,jsonb,text)'::regprocedure);
 if position(old_line in definition)=0 then raise exception 'Expected editorial function differs; review before applying.'; end if;
 definition := replace(definition,old_line,$replacement$
  select * into d from radar.rascunhos where pauta_id=p.id and versao=p.versao;
  if not found then
   insert into radar.rascunhos(redacao_id,pauta_id,versao,criado_por)
   values(r,p.id,p.versao,u) returning * into d;
  end if;
 $replacement$);
 execute definition;
end $repair$;
