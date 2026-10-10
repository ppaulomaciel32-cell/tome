-- Somente a tabela pública de notícias e os logs deste agente.
ALTER TABLE public.tomenota_publications
  ADD COLUMN localidade text NOT NULL DEFAULT 'regiao'
    CHECK (localidade IN ('sao-goncalo','pecem','taiba','croata','paracuru','regiao')),
  ADD COLUMN gerada_por text NOT NULL DEFAULT 'humana'
    CHECK (gerada_por IN ('ia','humana','ia+humana')),
  ADD COLUMN fontes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(fontes) = 'array' AND jsonb_array_length(fontes) <= 5),
  ADD COLUMN agent_job_id uuid UNIQUE,
  ADD COLUMN agent_revision bigint NOT NULL DEFAULT 0 CHECK (agent_revision >= 0),
  ADD COLUMN source_hash text CHECK (source_hash IS NULL OR source_hash ~ '^[a-f0-9]{64}$');

CREATE INDEX publications_local_idx ON public.tomenota_publications
  (localidade, published_at DESC, slug) WHERE status = 'published';
CREATE INDEX publications_source_hash_idx ON public.tomenota_publications
  (source_hash, published_at DESC) WHERE source_hash IS NOT NULL;

CREATE TABLE public.agent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  etapa text NOT NULL CHECK (char_length(etapa) BETWEEN 1 AND 60),
  status text NOT NULL CHECK (char_length(status) BETWEEN 1 AND 40),
  erro text CHECK (char_length(erro) <= 1000),
  duracao_ms integer NOT NULL DEFAULT 0 CHECK (duracao_ms >= 0),
  payload jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.agent_log TO service_role;
CREATE INDEX agent_log_job_idx ON public.agent_log (job_id, criado_em DESC);
CREATE INDEX agent_log_created_idx ON public.agent_log (criado_em);

-- INVOKER: não aumenta as permissões do chamador. Apenas service_role executa.
-- A transação cobre a matéria completa e seu registro de auditoria.
CREATE FUNCTION public.tnn_ingest_agent(p jsonb, audit_payload jsonb)
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
ANALYZE public.tomenota_publications;
NOTIFY pgrst,'reload schema';
