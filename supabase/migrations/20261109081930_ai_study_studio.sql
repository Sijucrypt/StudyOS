create function studyos_private.retrieve_ai_evidence(course_scope uuid, source_ids uuid[], question text)
returns table (material_id uuid, source_name text, mime_type text, chunk_index integer, excerpt text, page_start integer, page_end integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  terms tsquery;
begin
  if owner_id is null or coalesce(cardinality(source_ids), 0) not between 1 and 6 or (
    select count(*) from public.materials m
    where m.user_id = owner_id and m.course_id = course_scope and m.id = any(source_ids)
      and m.deleted_at is null and m.upload_state = 'verified' and m.extraction_state = 'ready'
  ) <> cardinality(source_ids) then
    raise exception 'Selected sources are unavailable' using errcode = '42501';
  end if;

  if question is not null then
    select to_tsquery('simple', string_agg(t.word, ' | ')) into terms
    from (
      select distinct word
      from regexp_split_to_table(lower(left(question, 500)), '[^[:alnum:]]+') as token(word)
      where word ~ '^[[:alnum:]]{2,32}$' and to_tsvector('english', word) <> ''::tsvector
        and word not in ('explain', 'describe', 'define', 'definition', 'tell', 'according', 'notes', 'document', 'source', 'meaning', 'please')
      order by word limit 24
    ) t;
    if terms is null then return; end if;

    return query
      select m.id, m.name, m.mime_type, c.chunk_index, c.text, c.page_start, c.page_end
      from public.materials m
      join public.document_chunks c on c.user_id = m.user_id and c.material_id = m.id
      where m.user_id = owner_id and m.course_id = course_scope and m.id = any(source_ids)
        and m.deleted_at is null and m.upload_state = 'verified' and m.extraction_state = 'ready'
        and c.text_search_vector @@ terms
      order by ts_rank_cd(c.text_search_vector, terms, 32) desc, m.id, c.chunk_index
      limit 12;
  else
    -- Sample the start of each half so long files do not use only their first pages.
    return query
      select m.id, m.name, m.mime_type, c.chunk_index, c.text, c.page_start, c.page_end
      from public.materials m
      cross join lateral (
        select distinct on (b.band) b.chunk_index, b.text, b.page_start, b.page_end
        from (
          select dc.chunk_index, dc.text, dc.page_start, dc.page_end,
            ntile(2) over (order by dc.chunk_index) as band
          from public.document_chunks dc
          where dc.user_id = owner_id and dc.material_id = m.id
        ) b
        order by b.band, b.chunk_index
      ) c
      where m.user_id = owner_id and m.course_id = course_scope and m.id = any(source_ids)
        and m.deleted_at is null and m.upload_state = 'verified' and m.extraction_state = 'ready'
      order by m.id, c.chunk_index;
  end if;
end
$$;
revoke all on function studyos_private.retrieve_ai_evidence(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function studyos_private.retrieve_ai_evidence(uuid, uuid[], text) to authenticated;

create function public.retrieve_ai_evidence(course_scope uuid, source_ids uuid[], question text default null)
returns table (material_id uuid, source_name text, mime_type text, chunk_index integer, excerpt text, page_start integer, page_end integer)
language sql stable security invoker set search_path = '' as $$
  select * from studyos_private.retrieve_ai_evidence(course_scope, source_ids, question)
$$;
revoke all on function public.retrieve_ai_evidence(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.retrieve_ai_evidence(uuid, uuid[], text) to authenticated;

alter table public.materials add constraint materials_course_scope_key unique (user_id, course_id, id);

create table public.ai_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null,
  kind text not null check (kind in ('chat', 'summary', 'notes', 'flashcards', 'mcq', 'theory', 'guide')),
  question text check (char_length(question) between 1 and 500),
  title text not null check (char_length(trim(title)) between 1 and 160),
  output jsonb not null check (jsonb_typeof(output) = 'object' and octet_length(output::text) <= 60000),
  selected_material_ids uuid[] not null check (cardinality(selected_material_ids) between 1 and 6),
  provider text not null check (provider in ('fixture', 'gemini', 'local')),
  model text not null check (char_length(model) between 1 and 100),
  prompt_version text not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  check ((kind = 'chat') = (question is not null)),
  unique (user_id, course_id, id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade
);
create index ai_results_owner_course_idx on public.ai_results (user_id, course_id, created_at desc, id);

create table public.ai_result_sources (
  result_id uuid not null,
  user_id uuid not null default auth.uid(),
  course_id uuid not null,
  citation_id text not null check (citation_id ~ '^S([1-9]|1[0-2])$'),
  material_id uuid not null,
  source_name text not null check (char_length(source_name) between 1 and 180),
  mime_type text not null,
  chunk_index integer not null check (chunk_index >= 0),
  page_start integer,
  page_end integer,
  check ((page_start is null and page_end is null) or
    (page_start is not null and page_end is not null and page_start > 0 and page_end >= page_start)),
  primary key (result_id, citation_id),
  foreign key (user_id, course_id, result_id) references public.ai_results(user_id, course_id, id) on delete cascade,
  foreign key (user_id, course_id, material_id) references public.materials(user_id, course_id, id)
);
create index ai_result_sources_material_idx on public.ai_result_sources (user_id, course_id, material_id);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  usage_day date not null default ((now() at time zone 'UTC')::date),
  provider text not null check (provider in ('fixture', 'gemini')),
  model text not null check (char_length(model) between 1 and 100),
  operation text not null check (operation in ('chat', 'summary', 'notes', 'flashcards', 'mcq', 'theory', 'guide')),
  reserved_tokens integer not null check (reserved_tokens between 1 and 50000),
  reserved_microusd integer not null check (reserved_microusd between 0 and 10000000),
  status text not null default 'reserved' check (status in ('reserved', 'complete', 'failed')),
  actual_tokens integer check (actual_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  error_code text check (error_code in ('provider', 'invalid_output', 'storage')),
  created_at timestamptz not null default now()
);
create index ai_usage_owner_day_idx on public.ai_usage (user_id, usage_day, provider);

do $$
declare table_name text;
begin
  foreach table_name in array array['ai_results', 'ai_result_sources', 'ai_usage'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy ai_owner on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
  end loop;
end
$$;

grant select on public.ai_results, public.ai_result_sources, public.ai_usage to authenticated;
grant update (title, output, saved_at) on public.ai_results to authenticated;
grant insert (provider, model, operation, reserved_tokens, reserved_microusd) on public.ai_usage to authenticated;
grant update (status, actual_tokens, latency_ms, error_code) on public.ai_usage to authenticated;

create function studyos_private.bump_ai_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  return new;
end
$$;
revoke all on function studyos_private.bump_ai_revision() from public, anon, authenticated;
create trigger ai_results_revision before update on public.ai_results
for each row execute function studyos_private.bump_ai_revision();

create function public.reserve_ai_usage(provider_name text, model_name text, operation_name text,
  token_reservation integer, cost_reservation integer, daily_requests integer, daily_tokens integer, daily_cost integer)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  utc_day date := (now() at time zone 'UTC')::date;
  requests bigint;
  tokens bigint;
  cost bigint;
  entry uuid;
begin
  if owner_id is null or token_reservation not between 1 and 50000 or cost_reservation not between 0 and 10000000
    or daily_requests is null or daily_tokens is null or daily_cost is null then
    raise exception 'Invalid AI reservation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 830));
  select count(*), coalesce(sum(reserved_tokens), 0), coalesce(sum(reserved_microusd), 0)
    into requests, tokens, cost from public.ai_usage
    where user_id = owner_id and usage_day = utc_day and provider = provider_name;
  if requests >= daily_requests or tokens + token_reservation > daily_tokens or cost + cost_reservation > daily_cost then
    return null;
  end if;
  insert into public.ai_usage(provider, model, operation, reserved_tokens, reserved_microusd)
    values (provider_name, model_name, operation_name, token_reservation, cost_reservation) returning id into entry;
  return entry;
end
$$;
revoke all on function public.reserve_ai_usage(text, text, text, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(text, text, text, integer, integer, integer, integer, integer) to authenticated;

create function studyos_private.store_ai_result(course_scope uuid, output_kind text, user_question text, output_title text, output_body jsonb,
  source_ids uuid[], provider_name text, model_name text, prompt_id text, refs jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  result uuid;
  inserted integer;
begin
  if owner_id is null or coalesce(cardinality(source_ids), 0) not between 1 and 6 or (
    select count(*) from public.materials m where m.user_id = owner_id
      and m.course_id = course_scope and m.id = any(source_ids) and m.deleted_at is null
      and m.upload_state = 'verified' and m.extraction_state = 'ready'
  ) <> cardinality(source_ids) or jsonb_typeof(refs) is distinct from 'array' or jsonb_array_length(refs) > 12 then
    raise exception 'Selected sources are unavailable' using errcode = '42501';
  end if;
  insert into public.ai_results(user_id, course_id, kind, question, title, output, selected_material_ids, provider, model, prompt_version)
    values (owner_id, course_scope, output_kind, user_question, output_title, output_body, source_ids, provider_name, model_name, prompt_id)
    returning id into result;
  insert into public.ai_result_sources(user_id, result_id, course_id, citation_id, material_id, source_name, mime_type, chunk_index, page_start, page_end)
    select owner_id, result, course_scope, r.citation_id, m.id, m.name, m.mime_type, c.chunk_index, c.page_start, c.page_end
    from jsonb_to_recordset(refs) as r(citation_id text, material_id uuid, chunk_index integer, page_start integer, page_end integer)
    join public.materials m on m.id = r.material_id and m.id = any(source_ids)
      and m.user_id = owner_id and m.course_id = course_scope and m.deleted_at is null
      and m.upload_state = 'verified' and m.extraction_state = 'ready'
    join public.document_chunks c on c.user_id = m.user_id and c.material_id = m.id and c.chunk_index = r.chunk_index
      and c.page_start is not distinct from r.page_start and c.page_end is not distinct from r.page_end;
  get diagnostics inserted = row_count;
  if inserted <> jsonb_array_length(refs) then raise exception 'Invalid references' using errcode = '42501'; end if;
  return result;
end
$$;
revoke all on function studyos_private.store_ai_result(uuid, text, text, text, jsonb, uuid[], text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function studyos_private.store_ai_result(uuid, text, text, text, jsonb, uuid[], text, text, text, jsonb) to authenticated;

create function public.store_ai_result(course_scope uuid, output_kind text, user_question text, output_title text, output_body jsonb,
  source_ids uuid[], provider_name text, model_name text, prompt_id text, refs jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select studyos_private.store_ai_result(course_scope, output_kind, user_question, output_title, output_body,
    source_ids, provider_name, model_name, prompt_id, refs)
$$;
revoke all on function public.store_ai_result(uuid, text, text, text, jsonb, uuid[], text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_ai_result(uuid, text, text, text, jsonb, uuid[], text, text, text, jsonb) to authenticated;
