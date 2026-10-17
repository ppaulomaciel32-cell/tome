import {createViralHandler} from './handler.mjs';
Deno.serve(createViralHandler(Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TNN_DRAFT_SERVICE_TOKEN','TNN_DRAFT_READER_TOKEN','TNN_EDITORIAL_SIGNING_KEY'].map(k=>[k,Deno.env.get(k)]))));
