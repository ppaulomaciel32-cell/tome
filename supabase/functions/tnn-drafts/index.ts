import { createDraftHandler } from './handler.mjs';
Deno.serve(createDraftHandler({
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  TNN_DRAFT_SERVICE_TOKEN: Deno.env.get('TNN_DRAFT_SERVICE_TOKEN'),
  TNN_DRAFT_READER_TOKEN: Deno.env.get('TNN_DRAFT_READER_TOKEN'),
  TNN_MANUAL_ENABLED:Deno.env.get('TNN_MANUAL_ENABLED'),
}));
