import { createHandler } from './handler.mjs';
// Token exclusivo do produtor; service_role permanece somente nesta função.
Deno.serve(createHandler({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  INGEST_SERVICE_TOKEN: Deno.env.get('INGEST_SERVICE_TOKEN'),
  SITE_URL: Deno.env.get('TNN_SITE_URL'),
  SITE_REBUILD_HOOK: Deno.env.get('TNN_SITE_REBUILD_HOOK'),
}));
