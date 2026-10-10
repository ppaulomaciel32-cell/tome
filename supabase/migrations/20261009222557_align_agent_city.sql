-- Correções de localidade também mantêm o município coerente.
CREATE OR REPLACE FUNCTION public.tnn_ingest_agent(p jsonb, audit_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  j uuid := (p->>'job_id')::uuid;
  rev bigint := (p->>'revision')::bigint;
  fingerprint text := p->>'source_hash';
  old public.tomenota_publications%ROWTYPE;
  item public.tomenota_publications%ROWTYPE;
  candidate text := p->>'slug';
  suffix integer := 1;
BEGIN
  IF j IS NULL OR rev IS NULL OR rev < 1 OR fingerprint IS NULL
     OR fingerprint !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid agent envelope' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(fingerprint, 0));
  SELECT * INTO old FROM public.tomenota_publications WHERE agent_job_id=j FOR UPDATE;
  IF FOUND THEN
    IF old.agent_revision >= rev THEN
      RETURN jsonb_build_object('id',old.id,'slug',old.slug,'revision',old.agent_revision,'changed',false);
    END IF;
    UPDATE public.tomenota_publications SET title=p->>'titulo', summary=p->>'resumo',
      body=p->>'texto', cover_url=p->>'cover_url', localidade=p->>'localidade',
      city=CASE WHEN p->>'localidade'='paracuru' THEN 'Paracuru' WHEN p->>'localidade'='regiao' THEN 'Região' ELSE 'São Gonçalo do Amarante' END,
      author='Redação Tome Nota', publisher='Tome Nota News', gerada_por=p->>'gerada_por',
      fontes=p->'fontes', agent_revision=rev, status='published',
      published_at=coalesce(published_at,now())
    WHERE id=old.id RETURNING * INTO item;
  ELSE
    SELECT * INTO old FROM public.tomenota_publications
      WHERE source_hash=fingerprint AND published_at >= now()-interval '72 hours'
      ORDER BY published_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('id',old.id,'slug',old.slug,'revision',old.agent_revision,'changed',false);
    END IF;
    LOOP
      INSERT INTO public.tomenota_publications
        (slug,title,summary,body,cover_url,city,localidade,author,publisher,status,
         published_at,gerada_por,fontes,agent_job_id,agent_revision,source_hash)
      VALUES (candidate,p->>'titulo',p->>'resumo',p->>'texto',p->>'cover_url',
        CASE WHEN p->>'localidade'='paracuru' THEN 'Paracuru'
             WHEN p->>'localidade'='regiao' THEN 'Região'
             ELSE 'São Gonçalo do Amarante' END,
        p->>'localidade','Redação Tome Nota','Tome Nota News','published',now(),
        p->>'gerada_por',p->'fontes',j,rev,fingerprint)
      ON CONFLICT (slug) DO NOTHING RETURNING * INTO item;
      EXIT WHEN FOUND;
      suffix := suffix+1;
      IF suffix > 1000 THEN RAISE EXCEPTION 'slug collision limit'; END IF;
      candidate := rtrim(left(p->>'slug',235),'-')||'-'||suffix::text;
    END LOOP;
  END IF;
  INSERT INTO public.agent_log (job_id,etapa,status,payload)
    VALUES (j,'ingestao','published',audit_payload);
  RETURN jsonb_build_object('id',item.id,'slug',item.slug,'revision',item.agent_revision,'changed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.tnn_ingest_agent(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tnn_ingest_agent(jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
