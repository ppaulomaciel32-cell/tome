-- Função preexistente do Supabase: mantém o event trigger; retira execução pelo cliente.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- Metadados acessíveis somente por rotinas internas autorizadas.
create policy sem_acesso_direto on radar.redacoes for all to anon, authenticated using(false) with check(false);
create policy sem_acesso_direto on radar.usuarios for all to anon, authenticated using(false) with check(false);
create policy sem_acesso_direto on radar.membros_redacao for all to anon, authenticated using(false) with check(false);
