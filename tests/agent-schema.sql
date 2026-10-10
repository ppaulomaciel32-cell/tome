BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  j uuid := gen_random_uuid();
  p jsonb;
  a jsonb;
  b jsonb;
BEGIN
  p := jsonb_build_object('job_id',j,'revision',1,'source_hash',repeat('a',64),
    'slug','tnn-agente-teste-transacao','titulo','Título de teste do agente',
    'resumo','Resumo de teste transacional, sem publicação real.',
    'texto',E'Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.\n\nQuarto parágrafo.',
    'cover_url','https://example.com/cover.jpg','localidade','pecem','gerada_por','ia',
    'fontes',jsonb_build_array(jsonb_build_object('titulo','Fonte de teste','url','https://example.com/fonte')));
  a := public.tnn_ingest_agent(p,p);
  b := public.tnn_ingest_agent(p,p);
  IF a->>'id' <> b->>'id' OR (b->>'changed')::boolean THEN RAISE EXCEPTION 'dedup failed'; END IF;
  p := p || jsonb_build_object('revision',2,'titulo','Título corrigido do teste','slug','slug-que-nao-deve-mudar','localidade','paracuru');
  b := public.tnn_ingest_agent(p,p);
  IF b->>'slug' <> a->>'slug' OR b->>'id' <> a->>'id' THEN RAISE EXCEPTION 'correction lost slug'; END IF;
  IF (SELECT city FROM public.tomenota_publications WHERE id=(a->>'id')::uuid)<>'Paracuru' THEN RAISE EXCEPTION 'city mismatch'; END IF;
  IF (SELECT count(*) FROM public.agent_log WHERE job_id=j) <> 2 THEN RAISE EXCEPTION 'audit failed'; END IF;
  p := p || jsonb_build_object('job_id',gen_random_uuid(),'revision',1,'source_hash',repeat('b',64),'slug',a->>'slug');
  b := public.tnn_ingest_agent(p,p);
  IF b->>'slug' <> (a->>'slug')||'-2' THEN RAISE EXCEPTION 'collision failed'; END IF;
  p := p || jsonb_build_object('job_id',gen_random_uuid(),'slug','outra-materia-mesma-fonte');
  a := public.tnn_ingest_agent(p,p);
  IF a->>'id' <> b->>'id' THEN RAISE EXCEPTION '72h dedup failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM * FROM public.agent_log; RAISE EXCEPTION 'logs leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.tnn_ingest_agent('{}','{}'); RAISE EXCEPTION 'RPC leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO public.tomenota_publications(slug,title,summary,body)
    VALUES ('anon-insert-teste','Título válido','Resumo válido de teste','Texto');
    RAISE EXCEPTION 'anon wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: atomicidade, idempotência, colisão, correção, logs privados e anon sem escrita' AS resultado;
ROLLBACK;
