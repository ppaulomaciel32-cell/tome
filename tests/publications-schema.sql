begin;
set local statement_timeout='10s';
do $$
declare article_id uuid; article public.tomenota_publications; invalid_field text;
begin
  insert into public.tomenota_publications(slug,title,summary,body,updated_at)
  values ('tnn-schema-fixture-20261008','Escolas do Pecem','Resumo de uma materia de teste.','Texto da materia.',now()-interval '1 day')
  returning id into article_id;
  select * into article from public.tomenota_publications where id=article_id;
  if article.status <> 'draft' or article.published_at is not null or article.updated_at <> now() then
    raise exception 'FAIL: initial status/date defaults';
  end if;
  update public.tomenota_publications set status='published' where id=article_id;
  select * into article from public.tomenota_publications where id=article_id;
  if article.published_at <> now() then raise exception 'FAIL: publication timestamp'; end if;
  if not (article.search @@ plainto_tsquery('portuguese','escola')) then
    raise exception 'FAIL: weighted Portuguese full-text index';
  end if;
  update public.tomenota_publications set title='Transportes da cidade' where id=article_id;
  select * into article from public.tomenota_publications where id=article_id;
  if not (article.search @@ plainto_tsquery('portuguese','transporte')) then
    raise exception 'FAIL: generated search column did not follow update';
  end if;
  foreach invalid_field in array array['slug','title','summary','cover_url'] loop
    begin
      case invalid_field
        when 'slug' then update public.tomenota_publications set slug='ab' where id=article_id;
        when 'title' then update public.tomenota_publications set title='ab' where id=article_id;
        when 'summary' then update public.tomenota_publications set summary='curto' where id=article_id;
        when 'cover_url' then update public.tomenota_publications set cover_url='http://invalid.example/image.jpg' where id=article_id;
      end case;
      raise exception 'FAIL: invalid % was accepted', invalid_field;
    exception when check_violation then null;
    end;
  end loop;
end $$;
select 'PASS: draft defaults, publish/update timestamps, generated Portuguese search, field constraints' as result;
rollback;
