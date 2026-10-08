-- Read this result BEFORE running a schema migration. No data is changed here.
select
  count(*) as total,
  count(*) filter (where status='published' and published_at <= now()) as currently_visible,
  count(*) filter (where status='published' and published_at <= now() and published_at is not null) as keep_existing_date,
  count(*) filter (where status='published' and published_at <= now() and published_at is null) as fallback_created_at
from public.tomenota_publications;

-- The existing RLS requires a non-null published_at <= now(). Consequently no
-- currently visible record needs a date fallback. Never promote a draft or a
-- scheduled record. These predicates intentionally match the existing policy.
-- Run only after reviewing the counts above; this is idempotent and normally 0.
update public.tomenota_publications
set status='published', published_at=coalesce(published_at,created_at)
where status='published' and published_at <= now()
  and (status is distinct from 'published' or published_at is null);
