create table public.study_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid,
  topic_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  anchor_local timestamp not null,
  timezone text not null check (char_length(timezone) between 1 and 100),
  duration_minutes integer not null check (duration_minutes between 1 and 720),
  recurrence text not null check (recurrence in ('once', 'daily', 'weekly')),
  repeat_until date,
  retired_at timestamptz,
  check (repeat_until is null or (recurrence <> 'once' and repeat_until >= anchor_local::date)),
  check (topic_id is null or course_id is not null),
  unique (user_id, id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade,
  foreign key (user_id, course_id, topic_id) references public.topics(user_id, course_id, id) on delete set null (topic_id)
);
create index study_events_owner_course_idx on public.study_events(user_id, course_id, topic_id);

create table public.study_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  event_id uuid not null,
  course_id uuid,
  topic_id uuid,
  local_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled', 'superseded')),
  check (ends_at > starts_at and ends_at - starts_at <= interval '12 hours'),
  check (topic_id is null or course_id is not null),
  unique (event_id, local_date),
  unique (user_id, id),
  foreign key (user_id, event_id) references public.study_events(user_id, id) on delete cascade,
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade,
  foreign key (user_id, course_id, topic_id) references public.topics(user_id, course_id, id) on delete set null (topic_id)
);
create index study_occurrences_owner_time_idx on public.study_occurrences(user_id, starts_at);
create index study_occurrences_course_idx on public.study_occurrences(user_id, course_id, starts_at);
create index study_occurrences_topic_idx on public.study_occurrences(user_id, course_id, topic_id) where topic_id is not null;

create table public.study_deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  category text not null check (category in ('assignment', 'exam', 'other')),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade
);
create index study_deadlines_owner_due_idx on public.study_deadlines(user_id, due_at);
create index study_deadlines_course_idx on public.study_deadlines(user_id, course_id, due_at);

create table public.study_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid,
  occurrence_id uuid,
  request_id uuid not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  running_since timestamptz,
  confirmed_through timestamptz,
  paused_at timestamptz,
  pause_reason text check (pause_reason in ('manual', 'inactive')),
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0),
  corrected_seconds integer check (corrected_seconds between 1 and 43200),
  status text not null check (status in ('running', 'paused', 'completed', 'discarded')),
  revision integer not null default 1,
  check ((status = 'running') = (running_since is not null and confirmed_through is not null)),
  check (confirmed_through >= running_since),
  check ((status in ('completed', 'discarded')) = (finished_at is not null)),
  unique (user_id, request_id),
  unique (user_id, id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade,
  foreign key (user_id, occurrence_id) references public.study_occurrences(user_id, id) on delete cascade
);
create unique index study_logs_active_idx on public.study_logs(user_id) where status in ('running', 'paused');
create unique index study_logs_occurrence_idx on public.study_logs(occurrence_id)
  where occurrence_id is not null and status <> 'discarded';
create index study_logs_owner_occurrence_idx on public.study_logs(user_id, occurrence_id);
create index study_logs_owner_finished_idx on public.study_logs(user_id, finished_at desc, id) where status = 'completed';
create index study_logs_course_idx on public.study_logs(user_id, course_id, finished_at desc);

create table public.study_log_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  log_id uuid not null,
  previous_seconds bigint not null check (previous_seconds > 0),
  new_seconds integer not null check (new_seconds between 1 and 43200),
  reason text not null check (char_length(trim(reason)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (user_id, log_id) references public.study_logs(user_id, id) on delete cascade
);
create index study_log_corrections_log_idx on public.study_log_corrections(user_id, log_id, created_at desc);

do $$
declare relation text;
begin
  foreach relation in array array['study_events', 'study_occurrences', 'study_deadlines', 'study_logs', 'study_log_corrections'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('create policy study_owner on public.%I for select to authenticated using (user_id = (select auth.uid()))', relation);
  end loop;
end
$$;

create function studyos_private.expand_study_events(owner_id uuid, from_at timestamptz, to_at timestamptz, course_scope uuid)
returns void language sql set search_path = '' as $$
  insert into public.study_occurrences(user_id, event_id, course_id, topic_id, local_date, title, starts_at, ends_at)
  select e.user_id, e.id, e.course_id, e.topic_id, candidate.day::date, e.title, instant.starts_at,
    instant.starts_at + make_interval(mins => e.duration_minutes)
  from public.study_events e
  cross join lateral generate_series(
    greatest(e.anchor_local::date, ((from_at - interval '12 hours') at time zone e.timezone)::date - 1)::timestamp,
    least(
      coalesce(e.repeat_until, ((to_at at time zone e.timezone)::date + 1)),
      case when e.recurrence = 'once' then e.anchor_local::date else ((to_at at time zone e.timezone)::date + 1) end
    )::timestamp,
    interval '1 day'
  ) candidate(day)
  cross join lateral (
    select (candidate.day::date + e.anchor_local::time) at time zone e.timezone as starts_at
  ) instant
  where e.user_id = owner_id and (course_scope is null or e.course_id = course_scope)
    and (e.recurrence <> 'weekly' or (candidate.day::date - e.anchor_local::date) % 7 = 0)
    and instant.starts_at < to_at and instant.starts_at + make_interval(mins => e.duration_minutes) > from_at
    and (e.retired_at is null or instant.starts_at < e.retired_at)
  on conflict (event_id, local_date) do nothing
$$;
revoke all on function studyos_private.expand_study_events(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create function studyos_private.check_study_course(owner_id uuid, target_course uuid, active_only boolean)
returns void language plpgsql stable set search_path = '' as $$
begin
  if target_course is not null and not exists (
    select 1 from public.courses c
    left join public.semesters s on s.id = c.semester_id and s.user_id = c.user_id
    left join public.academic_sessions a on a.id = s.academic_session_id and a.user_id = c.user_id
    where c.id = target_course and c.user_id = owner_id
      and (not active_only or (c.archived_at is null and s.archived_at is null and a.archived_at is null))
  ) then
    raise exception 'Course unavailable' using errcode = '42501';
  end if;
end
$$;
revoke all on function studyos_private.check_study_course(uuid, uuid, boolean) from public, anon, authenticated;

create function studyos_private.study_schedule(operation text, payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  target uuid := (payload->>'id')::uuid;
  chosen_course uuid := (payload->>'course_id')::uuid;
  chosen_topic uuid := (payload->>'topic_id')::uuid;
  changed uuid;
  plan public.study_occurrences%rowtype;
  local_time timestamp;
  effective_zone text;
  instant timestamptz;
  now_at timestamptz;
  name text;
  repeat text;
  until_date date;
  minutes integer;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();

  if operation in ('new_event', 'replace_series', 'reschedule', 'save_deadline') then
    perform studyos_private.check_study_course(owner_id, chosen_course, true);
    if operation <> 'save_deadline' and chosen_topic is not null and not exists (
      select 1 from public.topics where user_id = owner_id and course_id = chosen_course and id = chosen_topic and archived_at is null
    ) then raise exception 'Topic unavailable' using errcode = '42501'; end if;
    name := trim(payload->>'title');
    local_time := (payload->>'local_time')::timestamp;
    effective_zone := payload->>'timezone';
    if local_time is null or local_time::date not between date '2000-01-01' and date '2100-12-31'
      or not exists (select 1 from pg_timezone_names where lower(pg_timezone_names.name) = lower(effective_zone)) then
      raise exception 'Invalid date or timezone' using errcode = '22023';
    end if;
    instant := local_time at time zone effective_zone;
  end if;

  if operation in ('replace_series', 'cancel_series', 'reschedule', 'cancel_occurrence') then
    select * into plan from public.study_occurrences where user_id = owner_id and id = target;
    if not found or plan.status <> 'planned' then
      raise exception 'Session unavailable' using errcode = '42501';
    end if;
  end if;

  if operation in ('replace_series', 'cancel_series') then
    if (operation = 'replace_series' and instant < now_at) or exists (
      select 1 from public.study_logs l join public.study_occurrences o on o.user_id = l.user_id and o.id = l.occurrence_id
      where l.user_id = owner_id and o.event_id = plan.event_id and o.starts_at >= now_at
        and l.status in ('running', 'paused')
    ) then
      raise exception 'Future series change conflicts with an active session' using errcode = '22023';
    end if;
    update public.study_events set retired_at = now_at
      where user_id = owner_id and id = plan.event_id and retired_at is null returning id into changed;
    if changed is null then raise exception 'Series already changed' using errcode = '22023'; end if;
    update public.study_occurrences
      set status = case when operation = 'replace_series' then 'superseded' else 'cancelled' end
      where user_id = owner_id and event_id = plan.event_id and starts_at >= now_at and status = 'planned';
    if operation = 'cancel_series' then return changed; end if;
  end if;

  if operation in ('new_event', 'replace_series') then
    repeat := payload->>'recurrence';
    until_date := (payload->>'repeat_until')::date;
    minutes := (payload->>'duration_minutes')::integer;
    insert into public.study_events(user_id, course_id, topic_id, title, anchor_local, timezone, duration_minutes, recurrence, repeat_until)
      values (owner_id, chosen_course, chosen_topic, name, local_time, effective_zone, minutes, repeat, until_date) returning id into changed;
    perform studyos_private.expand_study_events(owner_id, now_at - interval '12 hours', now_at + interval '30 days', chosen_course);
    if instant >= now_at + interval '30 days' or instant < now_at - interval '12 hours' then
      perform studyos_private.expand_study_events(owner_id, instant, instant + interval '1 second', chosen_course);
    end if;
    return changed;
  end if;

  if operation in ('reschedule', 'cancel_occurrence') then
    if exists (select 1 from public.study_logs l where l.user_id = owner_id and l.occurrence_id = plan.id
      and l.status in ('running', 'paused')) then
      raise exception 'Finish or discard this timer first' using errcode = '22023';
    end if;
    if operation = 'cancel_occurrence' then
      update public.study_occurrences set status = 'cancelled' where id = plan.id;
    else
      if instant < now_at or plan.starts_at < now_at then
        raise exception 'Choose a future session and date' using errcode = '22023';
      end if;
      update public.study_occurrences set title = name, course_id = chosen_course, topic_id = chosen_topic, starts_at = instant,
        ends_at = instant + make_interval(mins => (payload->>'duration_minutes')::integer) where id = plan.id;
    end if;
    return plan.id;
  end if;

  if operation = 'save_deadline' then
    if target is null then
      insert into public.study_deadlines(user_id, course_id, title, category, due_at)
        values (owner_id, chosen_course, name, payload->>'category', instant) returning id into changed;
    else
      update public.study_deadlines set course_id = chosen_course, title = name, category = payload->>'category', due_at = instant
        where user_id = owner_id and id = target and status <> 'cancelled' returning id into changed;
    end if;
  elsif operation = 'deadline_status' then
    update public.study_deadlines set status = payload->>'status'
      where user_id = owner_id and id = target returning id into changed;
  else
    raise exception 'Unknown planner operation' using errcode = '22023';
  end if;
  if changed is null then raise exception 'Deadline unavailable' using errcode = '42501'; end if;
  return changed;
end
$$;
revoke all on function studyos_private.study_schedule(text, jsonb) from public, anon, authenticated;
grant execute on function studyos_private.study_schedule(text, jsonb) to authenticated;

create function public.study_schedule(operation text, payload jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select studyos_private.study_schedule(operation, payload)
$$;
revoke all on function public.study_schedule(text, jsonb) from public, anon, authenticated;
grant execute on function public.study_schedule(text, jsonb) to authenticated;

create function studyos_private.study_timer(operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  now_at timestamptz;
  target uuid := (payload->>'id')::uuid;
  chosen_course uuid := (payload->>'course_id')::uuid;
  occurrence uuid := (payload->>'occurrence_id')::uuid;
  intent uuid := (payload->>'request_id')::uuid;
  expected integer := (payload->>'revision')::integer;
  row public.study_logs%rowtype;
  plan public.study_occurrences%rowtype;
  credit_ms bigint;
  previous bigint;
  correction integer;
  matches_revision boolean;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if operation not in ('read', 'start', 'heartbeat', 'pause', 'pause_hidden', 'resume', 'finish', 'discard', 'correct')
    or operation is null then raise exception 'Unknown timer operation' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();

  if operation = 'start' then
    if intent is null then raise exception 'Missing timer request' using errcode = '22023'; end if;
    select * into row from public.study_logs where user_id = owner_id and request_id = intent;
    if not found then
      select * into row from public.study_logs where user_id = owner_id and status in ('running', 'paused');
    end if;
    if row.id is null then
      if occurrence is not null then
        select * into plan from public.study_occurrences where user_id = owner_id and id = occurrence and status = 'planned';
        if not found then raise exception 'Session unavailable' using errcode = '42501'; end if;
        chosen_course := plan.course_id;
      end if;
      perform studyos_private.check_study_course(owner_id, chosen_course, true);
      insert into public.study_logs(user_id, course_id, occurrence_id, request_id, started_at, running_since, confirmed_through, status)
        values (owner_id, chosen_course, occurrence, intent, now_at, now_at, now_at, 'running') returning * into row;
    end if;
  elsif operation = 'read' then
    select * into row from public.study_logs where user_id = owner_id and status in ('running', 'paused');
    if not found then return jsonb_build_object('log', null, 'server_now', now_at); end if;
  else
    select * into row from public.study_logs where user_id = owner_id and id = target;
    if not found then raise exception 'Study log unavailable' using errcode = '42501'; end if;
  end if;

  matches_revision := expected is not distinct from row.revision;
  if row.status = 'running' and now_at - row.confirmed_through > interval '30 seconds' then
    credit_ms := greatest(0, floor(extract(epoch from row.confirmed_through - row.running_since) * 1000)::bigint);
    update public.study_logs set elapsed_ms = elapsed_ms + credit_ms, running_since = null, confirmed_through = null,
      status = 'paused', paused_at = now_at, pause_reason = 'inactive', revision = revision + 1
      where id = row.id returning * into row;
  end if;

  if matches_revision and operation = 'heartbeat' and row.status = 'running' then
    update public.study_logs set confirmed_through = greatest(confirmed_through, now_at) where id = row.id returning * into row;
  elsif matches_revision and operation = 'resume' and row.status = 'paused' and expected = row.revision then
    update public.study_logs set status = 'running', running_since = now_at, confirmed_through = now_at,
      pause_reason = null, revision = revision + 1 where id = row.id returning * into row;
  elsif matches_revision and operation in ('pause', 'pause_hidden', 'finish', 'discard') and row.status in ('running', 'paused') then
    credit_ms := 0;
    if row.status = 'running' then
      credit_ms := greatest(0, floor(extract(epoch from (
        case when operation = 'pause_hidden' then row.confirmed_through else greatest(row.confirmed_through, now_at) end
        - row.running_since
      )) * 1000)::bigint);
    elsif operation in ('pause', 'pause_hidden') then
      return jsonb_build_object('log', to_jsonb(row), 'server_now', now_at);
    end if;
    if operation = 'finish' and row.elapsed_ms + credit_ms < 1000 then
      raise exception 'Study for at least one second before finishing' using errcode = '22023';
    end if;
    update public.study_logs set elapsed_ms = elapsed_ms + credit_ms, running_since = null, confirmed_through = null,
      status = case operation when 'finish' then 'completed' when 'discard' then 'discarded' else 'paused' end,
      finished_at = case when operation in ('finish', 'discard') then now_at else null end,
      paused_at = case when operation in ('pause', 'pause_hidden') then now_at else paused_at end,
      pause_reason = case operation when 'pause' then 'manual' when 'pause_hidden' then 'inactive' else null end,
      revision = revision + 1 where id = row.id returning * into row;
    if operation = 'finish' and row.occurrence_id is not null then
      update public.study_occurrences set status = 'completed'
        where user_id = owner_id and id = row.occurrence_id and status = 'planned';
    end if;
  elsif matches_revision and operation = 'correct' and row.status = 'completed' then
    previous := coalesce(row.corrected_seconds, row.elapsed_ms / 1000);
    correction := (payload->>'seconds')::integer;
    if correction is null or correction not between 1 and 43200 or
      coalesce(char_length(trim(payload->>'reason')), 0) not between 1 and 200 then
      raise exception 'Invalid study log correction' using errcode = '22023';
    end if;
    if correction <> previous then
      insert into public.study_log_corrections(user_id, log_id, previous_seconds, new_seconds, reason)
        values (owner_id, row.id, previous, correction, trim(payload->>'reason'));
      update public.study_logs set corrected_seconds = correction, revision = revision + 1
        where id = row.id returning * into row;
    end if;
  end if;

  return jsonb_build_object('log', to_jsonb(row), 'server_now', now_at);
end
$$;
revoke all on function studyos_private.study_timer(text, jsonb) from public, anon, authenticated;
grant execute on function studyos_private.study_timer(text, jsonb) to authenticated;

create function public.study_timer(operation text, payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select studyos_private.study_timer(operation, payload)
$$;
revoke all on function public.study_timer(text, jsonb) from public, anon, authenticated;
grant execute on function public.study_timer(text, jsonb) to authenticated;

create function studyos_private.study_window(first_day date, last_day date, view_zone text, course_scope uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  from_at timestamptz;
  to_at timestamptz;
  now_at timestamptz;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if first_day is null or last_day is null or last_day - first_day not between 0 and 62
    or first_day < date '1999-12-01' or last_day > date '2101-01-31'
    or not exists (select 1 from pg_timezone_names where lower(name) = lower(view_zone)) then
    raise exception 'Invalid planner window' using errcode = '22023';
  end if;
  perform studyos_private.check_study_course(owner_id, course_scope, false);
  from_at := first_day::timestamp at time zone view_zone;
  to_at := (last_day + 1)::timestamp at time zone view_zone;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();
  perform studyos_private.expand_study_events(owner_id, from_at, to_at, course_scope);

  return jsonb_build_object(
    'from_at', from_at, 'to_at', to_at, 'server_now', now_at,
    'occurrences', coalesce((
      select jsonb_agg(to_jsonb(o) || jsonb_build_object('recurrence', e.recurrence, 'repeat_until', e.repeat_until, 'topic_title', t.title,
        'timezone', e.timezone, 'series_retired', e.retired_at is not null) order by o.starts_at, o.id)
      from public.study_occurrences o join public.study_events e on e.user_id = o.user_id and e.id = o.event_id
      left join public.topics t on t.user_id = o.user_id and t.course_id = o.course_id and t.id = o.topic_id
      where o.user_id = owner_id and (course_scope is null or o.course_id = course_scope)
        and o.starts_at < to_at and o.starts_at > from_at - interval '12 hours'
        and o.ends_at > from_at and o.status <> 'superseded'
    ), '[]'::jsonb),
    'deadlines', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.due_at, d.id) from public.study_deadlines d
      where d.user_id = owner_id and (course_scope is null or d.course_id = course_scope)
        and d.due_at >= from_at and d.due_at < to_at
    ), '[]'::jsonb)
  );
end
$$;
revoke all on function studyos_private.study_window(date, date, text, uuid) from public, anon, authenticated;
grant execute on function studyos_private.study_window(date, date, text, uuid) to authenticated;

create function public.study_window(first_day date, last_day date, view_zone text, course_scope uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select studyos_private.study_window(first_day, last_day, view_zone, course_scope)
$$;
revoke all on function public.study_window(date, date, text, uuid) from public, anon, authenticated;
grant execute on function public.study_window(date, date, text, uuid) to authenticated;

create function public.study_metrics(first_day date, last_day date, view_zone text, course_scope uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  report_window jsonb;
  from_at timestamptz;
  to_at timestamptz;
  now_at timestamptz;
begin
  report_window := public.study_window(first_day, last_day, view_zone, course_scope);
  from_at := (report_window->>'from_at')::timestamptz;
  to_at := (report_window->>'to_at')::timestamptz;
  now_at := (report_window->>'server_now')::timestamptz;
  return (
    with grouped_logs as (
      select (l.finished_at at time zone view_zone)::date as day,
        sum(coalesce(l.corrected_seconds, l.elapsed_ms / 1000)) as seconds
      from public.study_logs l
      where l.user_id = owner_id and l.status = 'completed' and l.finished_at >= from_at and l.finished_at < to_at
        and (course_scope is null or l.course_id = course_scope)
      group by (l.finished_at at time zone view_zone)::date
    ), topics as (
      select count(*) as total, count(*) filter (where t.completed_at is not null) as completed
      from public.topics t
      join public.courses c on c.id = t.course_id and c.user_id = t.user_id
      left join public.semesters s on s.id = c.semester_id and s.user_id = c.user_id
      left join public.academic_sessions a on a.id = s.academic_session_id and a.user_id = s.user_id
      where t.user_id = owner_id and t.archived_at is null and c.archived_at is null and s.archived_at is null and a.archived_at is null
        and (course_scope is null or c.id = course_scope)
    ), adherence as (
      select count(*) as eligible, count(*) filter (where o.status = 'completed') as completed
      from public.study_occurrences o
      where o.user_id = owner_id and o.starts_at >= from_at and o.starts_at < to_at and o.starts_at <= now_at
        and (o.status = 'completed' or (o.status = 'planned' and o.ends_at <= now_at))
        and (course_scope is null or o.course_id = course_scope)
    )
    select jsonb_build_object(
      'seconds', coalesce((select sum(seconds) from grouped_logs), 0),
      'days_with_study', (select count(*) from grouped_logs where seconds > 0),
      'day_count', last_day - first_day + 1,
      'days', (select jsonb_agg(jsonb_build_object('date', days.day::date, 'seconds', coalesce(g.seconds, 0)) order by days.day)
        from generate_series(first_day::timestamp, last_day::timestamp, interval '1 day') days(day)
        left join grouped_logs g on g.day = days.day::date),
      'topics', (select to_jsonb(topics) from topics),
      'adherence', (select to_jsonb(adherence) from adherence),
      'overdue', coalesce((select jsonb_agg(to_jsonb(d) order by d.due_at, d.id) from (
        select id, title, category, due_at from public.study_deadlines where user_id = owner_id and status = 'open'
          and due_at < now_at and (course_scope is null or course_id = course_scope)
        order by due_at, id limit 5
      ) d), '[]'::jsonb),
      'upcoming', coalesce((select jsonb_agg(to_jsonb(d) order by d.due_at, d.id) from (
        select id, title, category, due_at from public.study_deadlines where user_id = owner_id and status = 'open'
          and due_at >= now_at and (course_scope is null or course_id = course_scope)
        order by due_at, id limit 5
      ) d), '[]'::jsonb)
    )
  );
end
$$;
revoke all on function public.study_metrics(date, date, text, uuid) from public, anon, authenticated;
grant execute on function public.study_metrics(date, date, text, uuid) to authenticated;
