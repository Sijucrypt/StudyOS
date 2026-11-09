create table public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id bigint not null check (chat_id between 1 and 4503599627370495),
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (user_id, id)
);
create unique index telegram_active_user_idx on public.telegram_connections(user_id) where disconnected_at is null;
create unique index telegram_active_chat_idx on public.telegram_connections(chat_id) where disconnected_at is null;

create table public.telegram_link_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table public.telegram_webhook_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
create index telegram_webhook_received_idx on public.telegram_webhook_updates(received_at);

create table public.telegram_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  study_enabled boolean not null default true,
  deadline_enabled boolean not null default true,
  digest_enabled boolean not null default false,
  study_lead integer not null default 15 check (study_lead between 0 and 1440),
  deadline_lead integer not null default 60 check (deadline_lead between 0 and 1440),
  digest_time time(0) not null default '07:00',
  quiet_start time(0),
  quiet_end time(0),
  check ((quiet_start is null and quiet_end is null) or (quiet_start is not null and quiet_end is not null and quiet_start <> quiet_end)),
  check (digest_time < time '24:00' and (quiet_start is null or quiet_start < time '24:00') and (quiet_end is null or quiet_end < time '24:00'))
);

create table public.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  binding_id uuid not null,
  kind text not null check (kind in ('link', 'test', 'study', 'deadline', 'digest')),
  intent_key text not null,
  target_id uuid,
  target_at timestamptz,
  digest_day date,
  scheduled_for timestamptz not null,
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'claimed', 'sending', 'sent', 'failed', 'uncertain', 'suppressed')),
  attempts integer not null default 0 check (attempts between 0 and 4),
  claim_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  reason text check (reason in ('changed', 'disabled', 'unlinked', 'quiet_hours', 'expired', 'rate_limit', 'provider_unavailable', 'telegram_rejected', 'delivery_unknown')),
  created_at timestamptz not null default now(),
  unique (binding_id, intent_key),
  foreign key (user_id, binding_id) references public.telegram_connections(user_id, id) on delete cascade,
  check ((kind in ('study', 'deadline')) = (target_id is not null)),
  check ((kind = 'digest') = (digest_day is not null)),
  check ((kind in ('study', 'deadline', 'digest')) = (target_at is not null))
);
create index telegram_outbox_owner_recent_idx on public.telegram_outbox(user_id, created_at desc, id);
create index telegram_outbox_owner_target_idx on public.telegram_outbox(user_id, kind, target_id) where target_id is not null;
create index telegram_outbox_binding_idx on public.telegram_outbox(user_id, binding_id);
create index telegram_outbox_due_idx on public.telegram_outbox(next_attempt_at, id) where status = 'pending';
create index telegram_outbox_expiry_idx on public.telegram_outbox(expires_at) where status in ('pending', 'claimed');
create index telegram_outbox_lease_idx on public.telegram_outbox(lease_until) where status in ('claimed', 'sending');

do $$
declare relation text;
begin
  foreach relation in array array['telegram_connections', 'telegram_link_tokens', 'telegram_webhook_updates', 'telegram_preferences', 'telegram_outbox'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
  end loop;
end
$$;

create function studyos_private.telegram_context(owner_id uuid)
returns table (binding_id uuid, chat_id bigint, zone text, enabled boolean,
  study_enabled boolean, deadline_enabled boolean, digest_enabled boolean,
  study_lead integer, deadline_lead integer, digest_time time, quiet_start time, quiet_end time)
language sql stable set search_path = '' as $$
  select c.id, c.chat_id, case when exists (select 1 from pg_timezone_names z where lower(z.name) = lower(p.timezone))
      then p.timezone else 'Africa/Lagos' end,
    n.enabled, n.study_enabled, n.deadline_enabled, n.digest_enabled,
    n.study_lead, n.deadline_lead, n.digest_time, n.quiet_start, n.quiet_end
  from public.telegram_connections c
  join public.telegram_preferences n on n.user_id = c.user_id
  left join public.profiles p on p.id = c.user_id
  where c.user_id = owner_id and c.disconnected_at is null
$$;
revoke all on function studyos_private.telegram_context(uuid) from public, anon, authenticated;

create function studyos_private.telegram_quiet_release(candidate timestamptz, zone text, quiet_start time, quiet_end time)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  local_time timestamp := candidate at time zone zone;
  release_day date := local_time::date;
begin
  if quiet_start is null or quiet_end is null then return candidate; end if;
  if quiet_start < quiet_end then
    if local_time::time < quiet_start or local_time::time >= quiet_end then return candidate; end if;
  elsif local_time::time >= quiet_start then
    release_day := release_day + 1;
  elsif local_time::time >= quiet_end then
    return candidate;
  end if;
  return greatest(candidate, (release_day + quiet_end) at time zone zone);
end
$$;
revoke all on function studyos_private.telegram_quiet_release(timestamptz, text, time, time) from public, anon, authenticated;

create function studyos_private.queue_telegram_reminder(owner_id uuid, binding uuid, reminder_kind text, key text,
  source_id uuid, source_at timestamptz, digest_day date, scheduled timestamptz, ready_at timestamptz, expiry timestamptz)
returns void language sql set search_path = '' as $$
  insert into public.telegram_outbox as o
    (user_id, binding_id, kind, intent_key, target_id, target_at, digest_day, scheduled_for, next_attempt_at, expires_at, status, reason)
  values (owner_id, binding, reminder_kind, key, source_id, source_at, digest_day, scheduled, ready_at, expiry,
    case when ready_at >= expiry then 'suppressed' else 'pending' end,
    case when ready_at >= expiry then 'quiet_hours' else null end)
  on conflict (binding_id, intent_key) do update
    set target_at = excluded.target_at, scheduled_for = excluded.scheduled_for,
      next_attempt_at = excluded.next_attempt_at, expires_at = excluded.expires_at,
      status = excluded.status, reason = excluded.reason
    where o.attempts = 0 and o.status in ('pending', 'suppressed')
      and (o.target_at, o.scheduled_for, o.next_attempt_at, o.expires_at, o.status, o.reason) is distinct from
          (excluded.target_at, excluded.scheduled_for, excluded.next_attempt_at, excluded.expires_at, excluded.status, excluded.reason)
$$;
revoke all on function studyos_private.queue_telegram_reminder(uuid, uuid, text, text, uuid, timestamptz, date, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create function studyos_private.sync_telegram_target(owner_id uuid, reminder_kind text, source_id uuid, now_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare
  ctx record;
  target_at timestamptz;
  scheduled timestamptz;
  ready_at timestamptz;
  expiry timestamptz;
  desired_key text;
begin
  select * into ctx from studyos_private.telegram_context(owner_id);
  if found and ctx.enabled then
    if reminder_kind = 'study' and ctx.study_enabled then
      select o.starts_at into target_at from public.study_occurrences o
        where o.user_id = owner_id and o.id = source_id and o.status = 'planned';
      scheduled := target_at - make_interval(mins => ctx.study_lead);
      expiry := target_at + case when ctx.study_lead = 0 then interval '5 minutes' else interval '0' end;
    elsif reminder_kind = 'deadline' and ctx.deadline_enabled then
      select d.due_at into target_at from public.study_deadlines d
        where d.user_id = owner_id and d.id = source_id and d.status = 'open';
      scheduled := target_at - make_interval(mins => ctx.deadline_lead);
      expiry := target_at + case when ctx.deadline_lead = 0 then interval '5 minutes' else interval '0' end;
    end if;
  end if;
  if expiry > now_at and target_at <= now_at + interval '3 days' then
    desired_key := reminder_kind || ':' || source_id::text || ':' || extract(epoch from target_at)::text;
  end if;

  update public.telegram_outbox o set status = 'suppressed', reason = 'changed', claim_token = null, lease_until = null
    where o.user_id = owner_id and o.kind = reminder_kind and o.target_id = source_id and o.status in ('pending', 'claimed')
      and (o.binding_id is distinct from ctx.binding_id or o.intent_key is distinct from desired_key);
  if desired_key is null then return; end if;

  ready_at := studyos_private.telegram_quiet_release(greatest(scheduled, now_at), ctx.zone, ctx.quiet_start, ctx.quiet_end);
  -- Keep the original due time for already-due jobs unless quiet hours defer delivery.
  if ready_at = now_at then ready_at := scheduled; end if;
  perform studyos_private.queue_telegram_reminder(owner_id, ctx.binding_id, reminder_kind, desired_key,
    source_id, target_at, null, scheduled, ready_at, expiry);
end
$$;
revoke all on function studyos_private.sync_telegram_target(uuid, text, uuid, timestamptz) from public, anon, authenticated;

create function studyos_private.telegram_plan_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform studyos_private.sync_telegram_target(new.user_id, tg_argv[0], new.id, clock_timestamp());
  return new;
end
$$;
revoke all on function studyos_private.telegram_plan_changed() from public, anon, authenticated;
create trigger telegram_study_changed after insert or update of starts_at, status on public.study_occurrences
  for each row execute function studyos_private.telegram_plan_changed('study');
create trigger telegram_deadline_changed after insert or update of due_at, status on public.study_deadlines
  for each row execute function studyos_private.telegram_plan_changed('deadline');

create function studyos_private.refresh_telegram_owner(owner_id uuid, now_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare
  ctx record;
  target uuid;
  day date;
  scheduled timestamptz;
  ready_at timestamptz;
  expiry timestamptz;
begin
  select * into ctx from studyos_private.telegram_context(owner_id);
  if not found or not ctx.enabled then return; end if;

  if ctx.study_enabled or ctx.digest_enabled then
    perform studyos_private.expand_study_events(owner_id, now_at - interval '1 day', now_at + interval '3 days', null);
  end if;
  if ctx.study_enabled then
    for target in select id from public.study_occurrences where user_id = owner_id and status = 'planned'
      and starts_at > now_at - interval '5 minutes' and starts_at <= now_at + interval '3 days'
    loop
      perform studyos_private.sync_telegram_target(owner_id, 'study', target, now_at);
    end loop;
  end if;
  if ctx.deadline_enabled then
    for target in select id from public.study_deadlines where user_id = owner_id and status = 'open'
      and due_at > now_at - interval '5 minutes' and due_at <= now_at + interval '3 days'
    loop
      perform studyos_private.sync_telegram_target(owner_id, 'deadline', target, now_at);
    end loop;
  end if;
  if ctx.digest_enabled then
    day := (now_at at time zone ctx.zone)::date;
    for offset_days in 0..1 loop
      scheduled := (day + offset_days + ctx.digest_time) at time zone ctx.zone;
      expiry := (day + offset_days + 1)::timestamp at time zone ctx.zone;
      ready_at := studyos_private.telegram_quiet_release(greatest(scheduled, now_at), ctx.zone, ctx.quiet_start, ctx.quiet_end);
      if ready_at = now_at then ready_at := scheduled; end if;
      perform studyos_private.queue_telegram_reminder(owner_id, ctx.binding_id, 'digest', 'digest:' || (day + offset_days)::text,
        null, scheduled, day + offset_days, scheduled, ready_at, expiry);
    end loop;
  end if;
end
$$;
revoke all on function studyos_private.refresh_telegram_owner(uuid, timestamptz) from public, anon, authenticated;

create function studyos_private.disconnect_telegram_owner(owner_id uuid, now_at timestamptz)
returns void language plpgsql set search_path = '' as $$
begin
  update public.telegram_connections set disconnected_at = now_at
    where user_id = owner_id and disconnected_at is null;
  update public.telegram_preferences set enabled = false where user_id = owner_id;
  delete from public.telegram_link_tokens where user_id = owner_id;
  update public.telegram_outbox set status = 'suppressed', reason = 'unlinked', claim_token = null, lease_until = null
    where user_id = owner_id and status in ('pending', 'claimed');
end
$$;
revoke all on function studyos_private.disconnect_telegram_owner(uuid, timestamptz) from public, anon, authenticated;

create function studyos_private.telegram_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'connected_at', (select connected_at from public.telegram_connections
      where user_id = owner_id and disconnected_at is null),
    'preferences', coalesce((select to_jsonb(p) - 'user_id' from public.telegram_preferences p where p.user_id = owner_id),
      '{"enabled":false,"study_enabled":true,"deadline_enabled":true,"digest_enabled":false,"study_lead":15,"deadline_lead":60,"digest_time":"07:00:00","quiet_start":null,"quiet_end":null}'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id) from (
      select id, kind, scheduled_for, next_attempt_at, status, reason, attempts, sent_at, created_at
      from public.telegram_outbox
      where user_id = owner_id and (status <> 'pending' or scheduled_for <= now())
      order by created_at desc, id limit 16
    ) o), '[]'::jsonb)
  );
end
$$;
revoke all on function studyos_private.telegram_state() from public, anon, authenticated;
grant execute on function studyos_private.telegram_state() to authenticated;

create function public.telegram_state()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select studyos_private.telegram_state()
$$;
revoke all on function public.telegram_state() from public, anon, authenticated;
grant execute on function public.telegram_state() to authenticated;

create function studyos_private.telegram_settings_action(operation text, payload jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  now_at timestamptz;
  binding uuid;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();

  if operation = 'link' then
    insert into public.telegram_link_tokens(user_id, token_hash, expires_at)
      values (owner_id, payload->>'token_hash', now_at + interval '10 minutes')
    on conflict (user_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, used_at = null;
    return 'link_created';
  elsif operation = 'unlink' then
    perform studyos_private.disconnect_telegram_owner(owner_id, now_at);
    return 'unlinked';
  elsif operation = 'save' then
    insert into public.telegram_preferences as p
      (user_id, enabled, study_enabled, deadline_enabled, digest_enabled, study_lead, deadline_lead, digest_time, quiet_start, quiet_end)
    values (owner_id, (payload->>'enabled')::boolean, (payload->>'study_enabled')::boolean,
      (payload->>'deadline_enabled')::boolean, (payload->>'digest_enabled')::boolean,
      (payload->>'study_lead')::integer, (payload->>'deadline_lead')::integer, (payload->>'digest_time')::time,
      (payload->>'quiet_start')::time, (payload->>'quiet_end')::time)
    on conflict (user_id) do update set enabled = excluded.enabled, study_enabled = excluded.study_enabled,
      deadline_enabled = excluded.deadline_enabled, digest_enabled = excluded.digest_enabled, study_lead = excluded.study_lead,
      deadline_lead = excluded.deadline_lead, digest_time = excluded.digest_time, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end;
    update public.telegram_outbox o set status = 'suppressed', reason = 'disabled', claim_token = null, lease_until = null
      from public.telegram_preferences p where p.user_id = owner_id and o.user_id = owner_id and o.status in ('pending', 'claimed')
        and ((o.kind = 'study' and not (p.enabled and p.study_enabled))
          or (o.kind = 'deadline' and not (p.enabled and p.deadline_enabled))
          or (o.kind = 'digest' and not (p.enabled and p.digest_enabled)));
    perform studyos_private.refresh_telegram_owner(owner_id, now_at);
    return 'saved';
  elsif operation = 'test' then
    select id into binding from public.telegram_connections where user_id = owner_id and disconnected_at is null;
    if not found then return 'not_connected'; end if;
    if exists (select 1 from public.telegram_outbox
      where user_id = owner_id and binding_id = binding and kind = 'test' and created_at > now_at - interval '1 minute')
    then return 'already_queued'; end if;
    perform studyos_private.queue_telegram_reminder(owner_id, binding, 'test', 'test:' || gen_random_uuid()::text,
      null, null, null, now_at, now_at, now_at + interval '10 minutes');
    return 'queued';
  end if;
  raise exception 'Unknown Telegram settings operation' using errcode = '22023';
end
$$;
revoke all on function studyos_private.telegram_settings_action(text, jsonb) from public, anon, authenticated;
grant execute on function studyos_private.telegram_settings_action(text, jsonb) to authenticated;

create function public.telegram_settings_action(operation text, payload jsonb)
returns text language sql security invoker set search_path = '' as $$
  select studyos_private.telegram_settings_action(operation, payload)
$$;
revoke all on function public.telegram_settings_action(text, jsonb) from public, anon, authenticated;
grant execute on function public.telegram_settings_action(text, jsonb) to authenticated;

grant usage on schema studyos_private to service_role;

create function studyos_private.telegram_handle_update(incoming_id bigint, command text, incoming_chat bigint, token_digest text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  binding uuid;
  now_at timestamptz;
begin
  if incoming_id is null or incoming_id not between 0 and 4503599627370495
    or incoming_chat is null or incoming_chat not between 1 and 4503599627370495
    or command is null or command not in ('start', 'stop') then return false; end if;
  insert into public.telegram_webhook_updates(update_id) values (incoming_id)
    on conflict (update_id) do nothing;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(91321, hashtext(incoming_chat::text));

  if command = 'stop' then
    select user_id into owner_id from public.telegram_connections where chat_id = incoming_chat and disconnected_at is null;
  else
    select user_id into owner_id from public.telegram_link_tokens
      where token_hash = token_digest and used_at is null and expires_at > clock_timestamp();
  end if;
  if owner_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();

  if command = 'stop' then
    if not exists (select 1 from public.telegram_connections where user_id = owner_id
      and chat_id = incoming_chat and disconnected_at is null) then return false; end if;
    perform studyos_private.disconnect_telegram_owner(owner_id, now_at);
    return true;
  end if;

  if exists (select 1 from public.telegram_connections
    where chat_id = incoming_chat and user_id <> owner_id and disconnected_at is null)
  then return false; end if;
  update public.telegram_link_tokens set used_at = now_at
    where user_id = owner_id and token_hash = token_digest and used_at is null and expires_at > now_at;
  if not found then return false; end if;

  if exists (select 1 from public.telegram_connections
    where user_id = owner_id and chat_id = incoming_chat and disconnected_at is null) then return true; end if;
  -- Rotating to a different chat requires a fresh opt-in for scheduled delivery.
  if exists (select 1 from public.telegram_connections where user_id = owner_id and disconnected_at is null) then
    perform studyos_private.disconnect_telegram_owner(owner_id, now_at);
  end if;
  insert into public.telegram_preferences(user_id) values (owner_id) on conflict (user_id) do nothing;
  insert into public.telegram_connections(user_id, chat_id, connected_at) values (owner_id, incoming_chat, now_at)
    returning id into binding;
  perform studyos_private.queue_telegram_reminder(owner_id, binding, 'link', 'linked',
    null, null, null, now_at, now_at, now_at + interval '10 minutes');
  return true;
end
$$;
revoke all on function studyos_private.telegram_handle_update(bigint, text, bigint, text) from public, anon, authenticated;
grant execute on function studyos_private.telegram_handle_update(bigint, text, bigint, text) to service_role;

create function public.telegram_handle_update(incoming_id bigint, command text, incoming_chat bigint, token_digest text default null)
returns boolean language sql security invoker set search_path = '' as $$
  select studyos_private.telegram_handle_update(incoming_id, command, incoming_chat, token_digest)
$$;
revoke all on function public.telegram_handle_update(bigint, text, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_handle_update(bigint, text, bigint, text) to service_role;

create function studyos_private.refresh_telegram_outbox()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  now_at timestamptz := clock_timestamp();
  refreshed integer := 0;
begin
  for owner_id in select c.user_id from public.telegram_connections c
    join public.telegram_preferences p on p.user_id = c.user_id
    where c.disconnected_at is null and p.enabled order by c.user_id
  loop
    -- Planner and link writes use the same owner lock. A busy owner can be revisited on the next tick.
    if pg_try_advisory_xact_lock(hashtextextended(owner_id::text, 844)) then
      perform studyos_private.refresh_telegram_owner(owner_id, now_at);
      refreshed := refreshed + 1;
    end if;
  end loop;
  delete from public.telegram_webhook_updates where received_at < now_at - interval '7 days';
  delete from public.telegram_link_tokens where expires_at < now_at - interval '1 day';
  return refreshed;
end
$$;
revoke all on function studyos_private.refresh_telegram_outbox() from public, anon, authenticated;
grant execute on function studyos_private.refresh_telegram_outbox() to service_role;

create function public.refresh_telegram_outbox()
returns integer language sql security invoker set search_path = '' as $$
  select studyos_private.refresh_telegram_outbox()
$$;
revoke all on function public.refresh_telegram_outbox() from public, anon, authenticated;
grant execute on function public.refresh_telegram_outbox() to service_role;

create function studyos_private.claim_telegram_outbox()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  now_at timestamptz := clock_timestamp();
  item public.telegram_outbox%rowtype;
begin
  update public.telegram_outbox set status = 'uncertain', reason = 'delivery_unknown', lease_until = null, claim_token = null
    where status = 'sending' and lease_until <= now_at;
  update public.telegram_outbox set status = 'suppressed', reason = 'expired', lease_until = null, claim_token = null
    where status in ('pending', 'claimed') and expires_at <= now_at;
  update public.telegram_outbox set status = 'pending', lease_until = null, claim_token = null
    where status = 'claimed' and lease_until <= now_at;
  with candidate as (
    select id from public.telegram_outbox
      where status = 'pending' and next_attempt_at <= now_at and expires_at > now_at and attempts < 4
      order by next_attempt_at, id limit 1 for update skip locked
  )
  update public.telegram_outbox o set status = 'claimed', lease_until = now_at + interval '1 minute', claim_token = gen_random_uuid()
    from candidate c where o.id = c.id returning o.* into item;
  if not found then return null; end if;
  return jsonb_build_object('id', item.id, 'token', item.claim_token);
end
$$;
revoke all on function studyos_private.claim_telegram_outbox() from public, anon, authenticated;
grant execute on function studyos_private.claim_telegram_outbox() to service_role;

create function public.claim_telegram_outbox()
returns jsonb language sql security invoker set search_path = '' as $$
  select studyos_private.claim_telegram_outbox()
$$;
revoke all on function public.claim_telegram_outbox() from public, anon, authenticated;
grant execute on function public.claim_telegram_outbox() to service_role;

create function studyos_private.telegram_digest(owner_id uuid, digest_day date, zone text, now_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select 'StudyOS plan for ' || to_char(digest_day, 'DD Mon YYYY') || ' (' || zone || ')' || E'\n\n' ||
    coalesce(nullif(concat_ws(E'\n\n', (
      select 'Study sessions' || E'\n' || string_agg('• ' || to_char(o.starts_at at time zone zone, 'HH24:MI') || ' ' || o.title, E'\n' order by o.starts_at, o.id)
      from (select id, starts_at, title from public.study_occurrences where user_id = owner_id and status = 'planned'
        and starts_at >= digest_day::timestamp at time zone zone and starts_at < (digest_day + 1)::timestamp at time zone zone
        and ends_at > now_at order by starts_at, id limit 5) o
    ), (
      select 'Deadlines' || E'\n' || string_agg('• ' || to_char(d.due_at at time zone zone, 'HH24:MI') || ' ' || d.title, E'\n' order by d.due_at, d.id)
      from (select id, due_at, title from public.study_deadlines where user_id = owner_id and status = 'open'
        and due_at >= digest_day::timestamp at time zone zone and due_at < (digest_day + 1)::timestamp at time zone zone
        order by due_at, id limit 5) d
    )), ''), 'No remaining study sessions or open deadlines today.')
$$;
revoke all on function studyos_private.telegram_digest(uuid, date, text, timestamptz) from public, anon, authenticated;

create function studyos_private.prepare_telegram_send(job_id uuid, lease_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid;
  now_at timestamptz;
  item public.telegram_outbox%rowtype;
  ctx record;
  target_at timestamptz;
  due timestamptz;
  expiry timestamptz;
  quiet_release timestamptz;
  title text;
  message text;
  reason_code text;
begin
  select user_id into owner_id from public.telegram_outbox where id = job_id and claim_token = lease_token and status = 'claimed';
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 844));
  now_at := clock_timestamp();
  select * into item from public.telegram_outbox where id = job_id and claim_token = lease_token
    and status = 'claimed' and lease_until > now_at for update;
  if not found then return null; end if;
  select * into ctx from studyos_private.telegram_context(owner_id);

  if not found or ctx.binding_id <> item.binding_id then reason_code := 'unlinked';
  elsif item.kind = 'link' then
    message := 'StudyOS is connected. You can configure reminders in StudyOS settings.';
  elsif item.kind = 'test' then
    message := 'This is a test message from StudyOS.';
  elsif not ctx.enabled or (item.kind = 'study' and not ctx.study_enabled)
    or (item.kind = 'deadline' and not ctx.deadline_enabled) or (item.kind = 'digest' and not ctx.digest_enabled) then
    reason_code := 'disabled';
  elsif item.kind = 'study' then
    select o.starts_at, o.title into target_at, title from public.study_occurrences o
      where o.user_id = owner_id and o.id = item.target_id and o.status = 'planned';
    if target_at is distinct from item.target_at then reason_code := 'changed'; end if;
    due := target_at - make_interval(mins => ctx.study_lead);
    expiry := target_at + case when ctx.study_lead = 0 then interval '5 minutes' else interval '0' end;
    message := 'Study reminder · ' || title || E'\nStarts ' || to_char(target_at at time zone ctx.zone, 'DD Mon YYYY HH24:MI') || ' (' || ctx.zone || ')';
  elsif item.kind = 'deadline' then
    select d.due_at, d.title into target_at, title from public.study_deadlines d
      where d.user_id = owner_id and d.id = item.target_id and d.status = 'open';
    if target_at is distinct from item.target_at then reason_code := 'changed'; end if;
    due := target_at - make_interval(mins => ctx.deadline_lead);
    expiry := target_at + case when ctx.deadline_lead = 0 then interval '5 minutes' else interval '0' end;
    message := 'Deadline reminder · ' || title || E'\nDue ' || to_char(target_at at time zone ctx.zone, 'DD Mon YYYY HH24:MI') || ' (' || ctx.zone || ')';
  else
    due := (item.digest_day + ctx.digest_time) at time zone ctx.zone;
    expiry := (item.digest_day + 1)::timestamp at time zone ctx.zone;
    message := studyos_private.telegram_digest(owner_id, item.digest_day, ctx.zone, now_at);
  end if;

  if reason_code is null then
    expiry := coalesce(expiry, item.expires_at);
    if expiry <= now_at then reason_code := 'expired';
    elsif item.kind in ('study', 'deadline', 'digest') then
      quiet_release := studyos_private.telegram_quiet_release(greatest(due, now_at), ctx.zone, ctx.quiet_start, ctx.quiet_end);
      if quiet_release >= expiry then reason_code := 'quiet_hours';
      elsif quiet_release > now_at then
        update public.telegram_outbox set status = 'pending', reason = null, scheduled_for = due,
          expires_at = expiry, next_attempt_at = quiet_release, lease_until = null, claim_token = null where id = item.id;
        return null;
      end if;
    end if;
  end if;

  if reason_code is not null then
    update public.telegram_outbox set status = 'suppressed', reason = reason_code, lease_until = null, claim_token = null where id = item.id;
    return null;
  end if;
  update public.telegram_outbox set status = 'sending', attempts = attempts + 1, reason = null,
    scheduled_for = coalesce(due, scheduled_for), expires_at = expiry, lease_until = now_at + interval '1 minute'
    where id = item.id;
  return jsonb_build_object('chat_id', ctx.chat_id::text, 'message', message);
end
$$;
revoke all on function studyos_private.prepare_telegram_send(uuid, uuid) from public, anon, authenticated;
grant execute on function studyos_private.prepare_telegram_send(uuid, uuid) to service_role;

create function public.prepare_telegram_send(job_id uuid, lease_token uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select studyos_private.prepare_telegram_send(job_id, lease_token)
$$;
revoke all on function public.prepare_telegram_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_telegram_send(uuid, uuid) to service_role;

create function studyos_private.finish_telegram_send(job_id uuid, lease_token uuid, result text, retry_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  now_at timestamptz := clock_timestamp();
  item public.telegram_outbox%rowtype;
  retry_at timestamptz;
  next_status text;
  next_reason text;
begin
  select * into item from public.telegram_outbox where id = job_id and claim_token = lease_token and status = 'sending' for update;
  if not found then return false; end if;
  if result = 'sent' then
    next_status := 'sent';
  elsif result = 'delivery_unknown' then
    next_status := 'uncertain'; next_reason := result;
  elsif result in ('rate_limit', 'provider_unavailable') then
    next_reason := result;
    retry_at := now_at + make_interval(secs => greatest(coalesce(retry_seconds, 0), (15 * power(2, item.attempts - 1))::integer));
    next_status := case when item.attempts < 4 and retry_at < item.expires_at then 'pending' else 'failed' end;
  elsif result = 'telegram_rejected' then
    next_status := 'failed'; next_reason := result;
  else
    raise exception 'Invalid Telegram delivery outcome' using errcode = '22023';
  end if;
  update public.telegram_outbox set status = next_status, reason = next_reason, next_attempt_at = coalesce(retry_at, next_attempt_at),
    sent_at = case when next_status = 'sent' then now_at else null end,
    lease_until = null, claim_token = null where id = item.id;
  return true;
end
$$;
revoke all on function studyos_private.finish_telegram_send(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function studyos_private.finish_telegram_send(uuid, uuid, text, integer) to service_role;

create function public.finish_telegram_send(job_id uuid, lease_token uuid, result text, retry_seconds integer default 0)
returns boolean language sql security invoker set search_path = '' as $$
  select studyos_private.finish_telegram_send(job_id, lease_token, result, retry_seconds)
$$;
revoke all on function public.finish_telegram_send(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.finish_telegram_send(uuid, uuid, text, integer) to service_role;
