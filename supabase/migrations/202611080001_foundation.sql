create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  display_name text not null default '' check (char_length(display_name) <= 100),
  timezone text not null default 'Africa/Lagos'
    check (char_length(timezone) between 1 and 100)
);

create table public.academic_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  label text not null check (char_length(trim(label)) between 1 and 100),
  starts_on date,
  ends_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (user_id, id)
);
create unique index academic_sessions_label_idx on public.academic_sessions (user_id, lower(trim(label)));

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  academic_session_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  starts_on date,
  ends_on date,
  archived_at timestamptz,
  harmattan_imported_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (user_id, id),
  foreign key (user_id, academic_session_id) references public.academic_sessions(user_id, id)
    on delete cascade
);
create unique index semesters_name_idx on public.semesters (user_id, academic_session_id, lower(trim(name)));

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  semester_id uuid,
  code text not null check (char_length(trim(code)) between 1 and 30),
  title text not null check (char_length(trim(title)) between 1 and 160),
  units integer not null default 0 check (units >= 0),
  description text not null default '' check (char_length(description) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, semester_id) references public.semesters(user_id, id) on delete cascade
);
create index courses_owner_semester_idx on public.courses (user_id, semester_id);
create unique index courses_semester_code_idx
  on public.courses (user_id, semester_id, upper(trim(code))) where semester_id is not null;

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null,
  parent_topic_id uuid,
  title text not null check (char_length(trim(title)) between 1 and 160),
  sort_order integer not null default 0 check (sort_order >= 0),
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, course_id, id),
  foreign key (user_id, course_id) references public.courses(user_id, id) on delete cascade,
  foreign key (user_id, course_id, parent_topic_id) references public.topics(user_id, course_id, id)
);
create index topics_parent_idx on public.topics (user_id, course_id, parent_topic_id);

create function public.check_topic_ancestry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_topic_id is null then
    return new;
  end if;

  -- Serialize parent assignments within a course before inspecting its ancestry.
  perform 1 from public.courses
    where user_id = new.user_id and id = new.course_id for no key update;

  if exists (
    with recursive ancestors(id) as (
      select new.parent_topic_id
      union
      select t.parent_topic_id
        from public.topics t join ancestors a on a.id = t.id
        where t.user_id = new.user_id and t.course_id = new.course_id
          and t.parent_topic_id is not null
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'A topic cannot contain itself' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger topics_ancestry
before insert or update of parent_topic_id on public.topics
for each row execute function public.check_topic_ancestry();

alter table public.profiles enable row level security;
create policy own_profile on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

do $$
declare name text;
begin
  foreach name in array array['academic_sessions', 'semesters', 'courses', 'topics'] loop
    execute format('alter table public.%I enable row level security', name);
    execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', name);
  end loop;
end
$$;

revoke all on public.profiles, public.academic_sessions, public.semesters, public.courses, public.topics
  from public, anon, authenticated;
grant select, insert, update on public.profiles, public.academic_sessions, public.courses, public.topics
  to authenticated;
grant select on public.semesters to authenticated;
grant insert (user_id, academic_session_id, name, starts_on, ends_on) on public.semesters to authenticated;
grant update (name, starts_on, ends_on, archived_at) on public.semesters to authenticated;
revoke execute on function public.check_topic_ancestry() from public, anon, authenticated;

create function public.import_harmattan(target_semester uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  prior_import timestamptz;
  inserted_count integer;
begin
  select s.harmattan_imported_at into prior_import
    from public.semesters s
    join public.academic_sessions a on a.user_id = s.user_id and a.id = s.academic_session_id
    where s.user_id = owner_id and s.id = target_semester
      and s.archived_at is null and a.archived_at is null
    for update of s, a;
  if not found then
    raise exception 'Active semester not found' using errcode = '42501';
  end if;
  if prior_import is not null then
    return 0;
  end if;

  insert into public.courses (user_id, semester_id, code, title, units)
  values
    (owner_id, target_semester, 'CSC401', 'Software Engineering', 3),
    (owner_id, target_semester, 'CSC403', 'Artificial Intelligence', 3),
    (owner_id, target_semester, 'CYB401', 'System Vulnerability Assessment & Testing', 3),
    (owner_id, target_semester, 'CYB403', 'Cloud Computing Security', 2),
    (owner_id, target_semester, 'CYB405', 'Information Disaster Recovery', 2),
    (owner_id, target_semester, 'CYB407', 'VoIP & Multimedia Security', 2),
    (owner_id, target_semester, 'CYB409', 'Enterprise Security & Information Assurance', 2),
    (owner_id, target_semester, 'CYB411', 'Special Topics in Computing', 2),
    (owner_id, target_semester, 'CYB415', 'Threats, Exploits & CounterMeasures', 2),
    (owner_id, target_semester, 'CYB497', 'Research Methodology', 1)
  on conflict (user_id, semester_id, (upper(trim(code)))) where semester_id is not null do nothing;

  get diagnostics inserted_count = row_count;
  update public.semesters set harmattan_imported_at = now()
    where user_id = owner_id and id = target_semester;
  return inserted_count;
end
$$;

revoke execute on function public.import_harmattan(uuid) from public, anon, authenticated;
grant execute on function public.import_harmattan(uuid) to authenticated;
