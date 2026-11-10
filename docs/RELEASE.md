# StudyOS release runbook

Use an isolated staging project and synthetic files first. Record the commit, deploy URL, test date and results in [PROGRESS.md](PROGRESS.md). The [CI workflow](../.github/workflows/checks.yml) uses loopback integrations and cannot certify a live deployment.

## Deploy staging

1. Confirm a public HTTPS Next.js host, the Supabase project, and a supervised Node runner or minute-level scheduler for the workers. Use the same revision for the web app and workers. Keep staging separate from production, including the bot when practical. Do not register the same bot against two environments.
2. Apply versioned migrations and verify history and RLS. Keep sign-ups and anonymous access disabled and provision a confirmed owner through Supabase Auth. Set the Auth Site URL to the deployment, limit allowed redirects to known hosts, and confirm that the private materials bucket permits the 25 MB application limit.
3. Set the Supabase URL and publishable key in the web service. For Telegram, also set the bot username, webhook secret and Telegram service key in the web service. Configure the separate Telegram worker with the Supabase URL, Telegram service key and bot token. The library worker needs only the Supabase URL and its server key. Use secret stores and keep server keys out of browser bundles, build logs and source control. [Environment variable names](../.env.example).
4. Leave AI off for the first live check. Verify the app can be used without AI. Enable it only after provider eligibility, pricing, consent and usage limits have been reviewed.
5. Start the library and Telegram workers using the commands in the [README](../README.md). Register the webhook against the chosen HTTPS URL and check Telegram's webhook status. Observe worker execution with every browser tab closed.

### Library worker on Vercel Hobby

Use the Vercel Hobby project and existing Supabase Free project. Vercel's native Hobby cron runs at most daily. Supabase Cron can look for due work every minute and invoke the bounded Vercel worker route only when the queue or cleanup needs it. [Vercel cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) · [Supabase Cron](https://supabase.com/docs/guides/cron)

1. Deploy the tested branch to the intended Hobby project. Set the two public Supabase variables and set `SUPABASE_WORKER_KEY` as a sensitive server environment variable.
2. Generate a dedicated token with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` in your own terminal. Store it as `STUDYOS_LIBRARY_CRON_SECRET` in Vercel's sensitive environment and as `studyos_library_worker_token` in Supabase Vault. Keep it out of shared logs and source control. The scheduler token authorizes only a worker tick.
3. Verify `POST /api/internal/library-worker` returns 401 without the bearer token and 200 with it. Put the full stable HTTPS endpoint URL into Vault as `studyos_library_worker_url`. Apply the [scheduler SQL](../supabase/scripts/schedule-library-worker.sql) to staging.
4. Upload a synthetic PDF, wait for the scheduled verification and extraction, then check the preview and compare downloaded bytes. Confirm cron succeeds on the next minute and inspect the HTTP response status without reading the request queue, which can contain the scheduler token. To disable the schedule, run `select cron.unschedule('studyos-library-worker');`.

## Acceptance and monitoring

Run `node scripts/smoke-staging.mjs https://YOUR-STAGING-HOST` after the deployment becomes live. It checks that the sign-in form is configured and that signed-out visitors are redirected from the dashboard, library and settings. Use the checks below for the signed-in and worker flows.

| Check | Pass condition |
| --- | --- |
| Auth and privacy | Sign in with the invited owner and check dashboard reload and sign out. A separate test user cannot read the owner's course, note export or file by URL. A signed-out visitor is returned to login. |
| Library and note export | Upload a PDF and a file over 6 MB. Verify processing, open the PDF, download an original, and open Markdown and JSON from a saved note. Simulate an extraction failure and download the original anyway. |
| Planner | Create a repeating session and deadline in the profile time zone. Complete one timer, reload and check analytics. |
| Telegram | Link a real private chat and verify a test message. Close the browser; a scheduled reminder arrives once. Measure from due time to send; the proposed target is five minutes. Test cancellation, overlapping ticks and retry, quiet hours, digest, and unlink. |
| Accessibility and performance | Try keyboard only, including skip link and note downloads, and check mobile and desktop with zoom and reduced motion. Check at least one physical phone. Record dashboard and first PDF page load times on mobile data and the note save delay; set budgets from the measurements. |
| Monitoring | Configure an HTTPS check for `/login` and alerts on repeated 5xx, failed worker ticks, growing queue age and failed or unknown deliveries. Monitor recent ticks separately from app availability. Trigger and clear one staging alert. Keep signed URLs, credentials, note text and chat IDs out of alert payloads. |

Record the selected web, database, backup storage and worker plans, the monthly fixed cost, and any usage limits or overage rates before enabling production. Staging Supabase project creation was quoted at $0/month. Production cost is unconfirmed. See [Supabase plan and billing information](https://supabase.com/pricing) and [Vercel plans](https://vercel.com/pricing); confirm the selected runner's cost too.

## Backup and restore

1. Agree on backup frequency, retention, encryption and access before launch. Record the acceptable data-loss window and recovery time. Use a low-traffic write freeze for a consistent pair: block web writes, stop both workers and wait for in-flight jobs and uploads to finish.
2. Capture a database snapshot or logical backup following the [Supabase backup guide](https://supabase.com/docs/guides/platform/backups). Capture the bytes from the private Storage bucket separately and record a manifest of object keys, sizes and checksums. Label both with the same backup ID, migration version and time. Keep the encrypted pair outside the application project and resume normal service after verification of the backup.
3. Restore into an isolated project with workers, webhooks and real provider access disabled. Restore database records, Auth and RLS as supported by the chosen method. Restore private objects through the Storage API with the original keys. Validate object checksums, ownership, note revisions, PDF and original downloads with short-lived URLs. Recreate environment secrets separately. Keep outbound sends disabled during the exercise so restored queues cannot resend historical reminders.
4. Log the recovery time, earliest recoverable time, mismatches and remediation. Run the exercise in staging before claiming recoverability; Supabase database backups do not include Storage object bytes.

## Rollback

Pause the affected workers first if a release affects queues or data writes. Restore the previous healthy web deployment and matching worker revision. Check migration compatibility before reverting application code. Fix incompatible schema changes with a reviewed forward migration or a verified paired restore if necessary; a restore can lose writes since the backup. Validate sign-in, a private download, and a staged job before re-enabling traffic and scheduled sends.
