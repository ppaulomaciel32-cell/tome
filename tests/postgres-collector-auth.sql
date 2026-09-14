-- Valida autorização sem imprimir ou devolver a credencial; rollback integral.
begin;
do $$ declare token text; begin
 select decrypted_secret into strict token from vault.decrypted_secrets where name='radar_collector_token';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 set local role service_role;
 if public.tn_coletor_autorizar(null) or public.tn_coletor_autorizar(repeat('x',64)) or not public.tn_coletor_autorizar(token) then raise exception 'Autorização incorreta';end if;
 reset role;
 set local role authenticated;
 begin perform public.tn_coletor_autorizar(token);raise exception 'Usuário acessou autenticação interna';exception when sqlstate '42501' then null;end;
 reset role;
end $$;
select 'Chave correta aceita; chave ausente/incorreta e usuário recusados' as teste;
rollback;
