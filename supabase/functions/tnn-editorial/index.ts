import {createEditorialHandler} from './handler.mjs';
Deno.serve(createEditorialHandler(Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TNN_EDITORIAL_TOKEN','TNN_EDITORIAL_SIGNING_KEY','TNN_DRAFT_SERVICE_TOKEN','TNN_DRAFT_READER_TOKEN','TNN_SITE_URL','TNN_SITE_REBUILD_HOOK'].map(key=>[key,Deno.env.get(key)]))));
