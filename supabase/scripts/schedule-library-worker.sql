-- Install after verifying the worker route on the intended Vercel Hobby project.
-- Set studyos_library_worker_url and studyos_library_worker_token in Supabase Vault first.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $validate$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'studyos_library_worker_url'
      and decrypted_secret ~ '^https://[a-z0-9-]+[.]vercel[.]app/api/internal/library-worker$'
  ) or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'studyos_library_worker_token' and decrypted_secret ~ '^[A-Za-z0-9_-]{43}$'
  ) then
    raise exception 'Configure the library worker URL and token in Vault first.';
  end if;
end;
$validate$;

select cron.schedule(
  'studyos-library-worker',
  '* * * * *',
  $job$
  select net.http_post(
    url := endpoint.decrypted_secret,
    headers := jsonb_build_object('Authorization', 'Bearer ' || token.decrypted_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 155000
  )
  from vault.decrypted_secrets as endpoint
  join vault.decrypted_secrets as token on token.name = 'studyos_library_worker_token'
  where endpoint.name = 'studyos_library_worker_url'
    and (
      exists (
        select 1 from public.processing_jobs as job
        where job.run_after <= now() and (job.locked_until is null or job.locked_until <= now())
      )
      or exists (
        select 1 from public.materials as material
        where material.purged_at is null and material.created_at < now() - interval '27 hours'
          and (material.deleted_at is not null or material.upload_state in ('pending', 'rejected'))
          and not exists (select 1 from public.processing_jobs as job where job.material_id = material.id)
      )
    );
  $job$
);

commit;
