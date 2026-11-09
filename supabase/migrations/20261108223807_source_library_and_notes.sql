create schema if not exists studyos_private;
revoke all on schema studyos_private from public, anon, authenticated;
grant usage on schema studyos_private to authenticated;

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 180),
  mime_type text not null check (mime_type in (
    'application/pdf', 'text/plain', 'text/markdown', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )),
  byte_size integer not null check (byte_size between 1 and 25000000),
  storage_key text generated always as (user_id::text || '/' || id::text || '/original') stored unique,
  upload_state text not null default 'pending'
    check (upload_state in ('pending', 'submitted', 'verified', 'rejected', 'expired')),
  extraction_state text not null default 'waiting'
    check (extraction_state in ('waiting', 'queued', 'ready', 'needs_ocr', 'unsupported', 'failed')),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count > 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade
);

create index materials_course_idx on public.materials (user_id, course_id, created_at desc, id);
create index materials_cleanup_idx on public.materials (created_at)
  where purged_at is null and (deleted_at is not null or upload_state in ('pending', 'rejected'));

create table public.processing_jobs (
  material_id uuid primary key references public.materials(id) on delete cascade,
  stage text not null check (stage in ('verify', 'extract', 'cleanup')),
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid
);
create index processing_jobs_due_idx on public.processing_jobs (run_after, material_id);

create table public.document_chunks (
  user_id uuid not null,
  material_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  text text not null check (char_length(text) between 1 and 1500),
  page_start integer,
  page_end integer,
  text_search_vector tsvector generated always as (to_tsvector('simple'::regconfig, text)) stored,
  primary key (material_id, chunk_index),
  check ((page_start is null and page_end is null) or
    (page_start is not null and page_end is not null and page_start > 0 and page_end >= page_start)),
  foreign key (user_id, material_id) references public.materials(user_id, id) on delete cascade
);
create index document_chunks_owner_idx on public.document_chunks (user_id, material_id);
create index document_chunks_search_idx on public.document_chunks using gin (text_search_vector);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  course_id uuid not null,
  title text not null default 'Untitled note' check (char_length(trim(title)) between 1 and 160),
  body jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
    check (jsonb_typeof(body) = 'object' and body->>'type' is not distinct from 'doc'
      and octet_length(body::text) <= 300000),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade
);
create index notes_course_idx on public.notes (user_id, course_id, updated_at desc, id);

alter table public.materials enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.document_chunks enable row level security;
alter table public.notes enable row level security;

revoke all on public.materials, public.processing_jobs, public.document_chunks, public.notes from public, anon, authenticated;
grant select on public.materials, public.notes to authenticated;
grant insert (course_id, name, mime_type, byte_size) on public.materials to authenticated;
grant insert (course_id) on public.notes to authenticated;
grant update (title, body, deleted_at) on public.notes to authenticated;
grant select, update on public.materials to service_role;
grant select, insert, update, delete on public.processing_jobs, public.document_chunks to service_role;

create policy materials_owner_read on public.materials for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);
create policy materials_owner_reserve on public.materials for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notes_owner_read on public.notes for select to authenticated
  using (user_id = (select auth.uid()));
create policy notes_owner_create on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notes_owner_update on public.notes for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

create function studyos_private.check_material_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from auth.uid() then
    raise exception 'Invalid reservation owner' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 702));
  if 25000000 + coalesce((
    select sum(case when m.upload_state = 'verified' then m.byte_size else 25000000 end)
      from public.materials m where m.user_id = new.user_id and m.purged_at is null
  ), 0) > 250000000 then
    raise exception 'Storage quota exceeded' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function studyos_private.check_material_quota() from public, anon, authenticated;
create trigger materials_quota before insert on public.materials
for each row execute function studyos_private.check_material_quota();

create function studyos_private.bump_note_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function studyos_private.bump_note_revision() from public, anon, authenticated;
create trigger notes_revision before update on public.notes
for each row execute function studyos_private.bump_note_revision();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studyos-materials', 'studyos-materials', false, 25000000, array[
  'application/pdf', 'text/plain', 'text/markdown', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]);

create policy studyos_upload_reserved_object on storage.objects for insert to authenticated
with check (
  bucket_id = 'studyos-materials' and exists (
    select 1 from public.materials m
    where m.storage_key = objects.name and m.user_id = (select auth.uid())
      and m.deleted_at is null and m.upload_state = 'pending'
      and m.created_at > now() - interval '2 hours'
  )
);
create policy studyos_read_verified_object on storage.objects for select to authenticated
using (
  bucket_id = 'studyos-materials' and exists (
    select 1 from public.materials m
    where m.storage_key = objects.name and m.user_id = (select auth.uid())
      and m.deleted_at is null and m.upload_state = 'verified'
  )
);

create function studyos_private.change_material(target_id uuid, operation text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare item public.materials%rowtype;
begin
  select m.* into item from public.materials m
    where m.id = target_id and m.user_id = auth.uid() and m.deleted_at is null for update;
  if not found then return false; end if;
  case operation
    when 'submit' then
      if item.upload_state in ('submitted', 'verified') then return true; end if;
      if item.upload_state <> 'pending' or item.created_at < now() - interval '2 hours' then return false; end if;
      update public.materials set upload_state = 'submitted' where id = item.id;
      insert into public.processing_jobs(material_id, stage) values (item.id, 'verify');
    when 'retry' then
      if item.upload_state <> 'verified' or item.extraction_state <> 'failed' then return false; end if;
      update public.materials set extraction_state = 'queued' where id = item.id;
      insert into public.processing_jobs(material_id, stage) values (item.id, 'extract');
    when 'remove' then
      update public.materials set deleted_at = now() where id = item.id;
      delete from public.document_chunks where material_id = item.id;
    else return false;
  end case;
  return true;
end
$$;
revoke all on function studyos_private.change_material(uuid, text) from public, anon, authenticated;
grant execute on function studyos_private.change_material(uuid, text) to authenticated;

create function public.change_material(target_id uuid, operation text) returns boolean
language sql security invoker set search_path = '' as $$
  select studyos_private.change_material(target_id, operation)
$$;
revoke all on function public.change_material(uuid, text) from public, anon, authenticated;
grant execute on function public.change_material(uuid, text) to authenticated;

create function public.claim_material_job()
returns table (material_id uuid, stage text, attempts integer, lease_token uuid,
  storage_key text, byte_size integer, mime_type text, deleted_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.processing_jobs (material_id, stage)
    select m.id, 'cleanup' from public.materials m
    where m.purged_at is null and m.created_at < now() - interval '27 hours'
      and (m.deleted_at is not null or m.upload_state in ('pending', 'rejected'))
      and not exists (select 1 from public.processing_jobs j where j.material_id = m.id)
    order by m.created_at limit 10
  on conflict on constraint processing_jobs_pkey do nothing;

  return query
    with next_job as (
      select j.material_id from public.processing_jobs j
      where j.run_after <= now() and (j.locked_until is null or j.locked_until <= now())
      order by j.run_after, j.material_id limit 1 for update skip locked
    ), claimed as (
      update public.processing_jobs j set attempts = j.attempts + 1,
        locked_until = now() + interval '3 minutes', lease_token = gen_random_uuid()
      from next_job n where j.material_id = n.material_id
      returning j.material_id, j.stage, j.attempts, j.lease_token
    )
    select c.material_id, c.stage, c.attempts, c.lease_token, m.storage_key, m.byte_size, m.mime_type, m.deleted_at
    from claimed c join public.materials m on m.id = c.material_id;
end
$$;
revoke all on function public.claim_material_job() from public, anon, authenticated;
grant execute on function public.claim_material_job() to service_role;

create function public.finish_material_job(target_id uuid, token uuid, outcome text,
  result_hash text default null, result_pages integer default null, result_chunks jsonb default '[]')
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  item public.materials%rowtype;
  job public.processing_jobs%rowtype;
begin
  select * into item from public.materials where id = target_id for update;
  if not found then return false; end if;
  select * into job from public.processing_jobs j
    where j.material_id = target_id and j.lease_token = token and j.locked_until > now() for update;
  if not found then return false; end if;

  if item.deleted_at is not null and job.stage <> 'cleanup' then
    delete from public.processing_jobs where material_id = target_id;
    return true;
  end if;

  if outcome = 'retry' and (job.attempts < 3 or job.stage = 'cleanup') then
    update public.processing_jobs set locked_until = null, lease_token = null,
      run_after = now() + make_interval(secs => 15 * least(job.attempts, 20))
      where material_id = target_id;
    return true;
  end if;

  if job.stage = 'cleanup' then
    if outcome <> 'purged' then return false; end if;
    update public.materials set purged_at = now(),
      upload_state = case when upload_state = 'pending' then 'expired' else upload_state end
      where id = target_id;
  elsif job.stage = 'verify' then
    if outcome = 'verified' and result_hash is not null then
      update public.materials set upload_state = 'verified', sha256 = result_hash,
        extraction_state = 'queued' where id = target_id;
      update public.processing_jobs set stage = 'extract', attempts = 0, locked_until = null,
        lease_token = null, run_after = now() where material_id = target_id;
      return true;
    end if;
    update public.materials set upload_state = 'rejected' where id = target_id;
  else
    update public.materials set extraction_state =
      case when outcome in ('ready', 'needs_ocr', 'unsupported') then outcome else 'failed' end,
      page_count = coalesce(result_pages, page_count) where id = target_id;
    if outcome = 'ready' then
      delete from public.document_chunks where material_id = target_id;
      insert into public.document_chunks (user_id, material_id, chunk_index, text, page_start, page_end)
        select item.user_id, item.id, (c.ordinal - 1)::integer, c.value->>'text',
          (c.value->>'page_start')::integer, (c.value->>'page_end')::integer
        from jsonb_array_elements(result_chunks) with ordinality c(value, ordinal);
    end if;
  end if;

  delete from public.processing_jobs where material_id = target_id;
  return true;
end
$$;
revoke all on function public.finish_material_job(uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.finish_material_job(uuid, uuid, text, text, integer, jsonb) to service_role;

create function public.search_materials(course_scope uuid default null, search_term text default '', page_offset integer default 0)
returns setof public.materials language sql stable security invoker set search_path = '' as $$
  select m.* from public.materials m
  where m.user_id = (select auth.uid()) and m.deleted_at is null
    and (course_scope is null or m.course_id = course_scope)
    and (coalesce(search_term, '') = '' or strpos(lower(m.name), lower(left(search_term, 100))) > 0)
  order by m.created_at desc, m.id
  limit 51 offset greatest(page_offset, 0)
$$;
revoke all on function public.search_materials(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_materials(uuid, text, integer) to authenticated;
