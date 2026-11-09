# StudyOS

StudyOS is a private workspace for academics, course materials, personal notes, and source-grounded study resources. The workspace includes an optional UNIOSUN Harmattan course import.

## Run locally

1. Use Node.js 22.13 or later. Run `npm ci`.
2. Create a development Supabase project or use the [local Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) with Docker. Keep development and production separate.
3. With Supabase CLI v3, run `supabase start` and `supabase db push` for a local stack. For a hosted development project, run `supabase db push --remote=<dev-project-ref>`. The migrations are in [supabase/migrations](supabase/migrations).
4. Disable public sign-ups in the hosted project's Auth settings. Local sign-ups are disabled in `supabase/config.toml`. In the development Dashboard or Studio, create a confirmed owner account with a strong password via the Auth users panel. This version uses email and password sign-in.
5. Copy `.env.example` to `.env.local`. Enter the Supabase project URL and publishable key, or the local API URL and anon key printed by the CLI. The web app needs only the publishable or anon key.
6. Run `npm run dev` and open `http://localhost:3000`. Sign in, set a display name and timezone in Settings, then create a session and semester in Academics or add a standalone course. The semester page offers the optional import.

## Run the source library

Apply the Phase 2 migration to the same development project. It creates the private `studyos-materials` bucket. Set the project's Storage maximum to at least 25 MB. For the separate worker, configure the same Supabase URL and `SUPABASE_WORKER_KEY` with the project's server-only secret key or local service-role key. Keep that key out of the web deployment environment when running the worker elsewhere.

Run `npm run library:worker` in a second terminal or as a supervised Node process. It polls the durable queue, verifies uploads, extracts supported text, and reclaims expired uploads. For a scheduled runner, use `npm run library:worker -- --once` to process one due job per invocation. Verification and extraction are separate jobs. Files waiting for the worker are visible in the library. A verified original can be downloaded even if extraction fails.

The upload limit is 25 MB per file and 250 MB per user. Pending uploads reserve 25 MB each until verified or cleaned up. Originals use two-minute signed links. Reopen a file or choose Refresh preview for a fresh link. The PDF extractor processes up to 250 pages and 500,000 characters. Image OCR and scanned-PDF OCR are outside Phase 2.

## Run AI Study Studio

Apply the Phase 3 migration, then open **AI Studio** from the dashboard navigation and choose a course. Select one to six files with extracted text. Source Q&A searches those files and reports when it cannot find evidence. Study resources are created as drafts and can be edited and saved. PDF citations open the corresponding page. Presentation citations name the slide.

Live generation is disabled by default. Before enabling Gemini, verify that the intended use is eligible, confirm the model and paid account terms, and approve the budget. Google restricts consumer use of the Gemini Developer API. Keep the adapter disabled if eligibility is unclear. The workspace continues to work with AI disabled. [Gemini terms](https://ai.google.dev/gemini-api/terms) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

For an approved deployment, configure `STUDYOS_AI_PROVIDER=gemini`, `STUDYOS_GEMINI_APPROVED=1`, and the server-only `GEMINI_API_KEY` and `GEMINI_MODEL`. Set the daily request, token and cost limits and the model rates from `.env.example`. Rate fields use microdollars per million tokens. One US dollar equals 1,000,000 microdollars. Each live request reserves up to 12,000 input and 3,000 output tokens and their estimated cost before contacting the provider. The app uses UTC days and keeps reservations through failures. Actual provider billing remains separate. Every live request requires confirmation to share its prompt and selected excerpts.

## Use the study planner

Apply the Phase 4 migration before starting the app. Open **Planner** from the dashboard or **Course planner** from a course. Choose a day, week, or month. Add a one-time, daily, or weekly session, or an assignment or exam deadline. Edit one session or replace its upcoming series from **Session actions**.

Start a general study timer or choose **Use timer** from a calendar session. Pause, resume, and finish to create a study log. Keep the timer page visible during a session. A hidden or suspended timer can pause and save only the time it confirmed before losing contact.

Open **Analytics** to review study time, study days, schedule adherence and topic progress. Each completed log counts on its completion day in the profile time zone. Use **Correct log duration** to save a corrected duration and reason.

## Set up Telegram reminders

1. Apply the Phase 5 migration to the development or hosted Supabase project. Use a separate Telegram bot for each environment.
2. Deploy the web app to a public HTTPS URL. Configure the server-only `SUPABASE_TELEGRAM_SERVICE_KEY`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET`. Generate a random webhook secret from at least 16 bytes and encode it as base64url. Keep these values out of client variables and logs.
3. In a trusted terminal with `TELEGRAM_BOT_TOKEN` and the same `TELEGRAM_WEBHOOK_SECRET`, run `npm run telegram:webhook -- https://your-app.example/api/telegram/webhook`. The command sets and verifies the webhook. [Telegram webhook docs](https://core.telegram.org/bots/api#setwebhook)
4. Configure the worker with the Supabase URL, `SUPABASE_TELEGRAM_SERVICE_KEY` and `TELEGRAM_BOT_TOKEN`. Run `npm run telegram:worker` as a supervised process. It checks every 30 seconds. For a managed scheduler, invoke `npm run telegram:worker -- --once` once per minute. The worker runs independently of browsers.
5. In **Settings → Telegram reminders**, create a link, open the bot and press Start. Refresh the connection status and send a test message. Enable scheduled reminders and choose the lead times, quiet hours and daily digest. Use **Unlink Telegram** or send `/stop` to disconnect.

Delivery history distinguishes queued, sent, failed, skipped and unknown outcomes. Advance reminders expire when the session starts or the deadline arrives. Zero-minute reminders can catch up for five minutes. Quiet hours defer only when delivery can still occur before expiry.

## Verify

- `npm run lint`, `npm run typecheck`, and `npm run build` check the project.
- `npm test` applies the migrations to embedded PostgreSQL and checks ownership, academic setup, private uploads and note revisions, AI safeguards, planner and timer rules, and Telegram linking and delivery states.
- Run `npm run build`, then `npx playwright install chromium` and `npm run test:e2e` for the desktop and 320px phone flows. Set `STUDYOS_BROWSER_CHANNEL=msedge` if using installed Edge instead of downloading Chromium. The suite uses a loopback Supabase test double backed by the real migrations in embedded PostgreSQL. The library and Telegram workers run as separate processes. Test accounts, files and simulated messages are disposable.
- Before release, apply the migration to development Supabase. Create two confirmed test users and repeat the browser walkthrough on desktop and a phone. Verify session refresh, sign-out, invalid credentials, direct URLs from the other account, and failed direct REST mutations with the second user's token. Verify RLS on each public table, repeat the import without duplicates, and verify that moving a course retains topic progress. Remove the test accounts after the checks.
- For live Phase 2 verification, upload a small PDF and a file over 6 MB, interrupt and retry the larger transfer, and confirm the worker verifies both. Open and download the PDF on a phone and laptop, then refresh an expired preview. Verify rejected uploads and another user's originals cannot be signed. Verify an extraction failure leaves the original available, and confirm expired or removed uploads are cleared by the worker. Edit the same note in two tabs and check that the stale tab keeps its draft without replacing the saved revision.
- For live Phase 3 verification with an eligible provider, use synthetic source material. Verify citation links, irrelevant questions, every study format, saved edits, and daily limits. Temporarily disable the adapter or use a rejected test key and verify that the library and notes still work. The automated browser suite uses a loopback excerpt fixture and contacts no external AI provider.
- For live Phase 4 verification, compare a repeating series across a daylight-saving transition, cancel and reschedule individual occurrences, and verify date and time labels in two profile time zones. Pause, reload, resume and finish a timer on two devices. Suspend one device to check that unconfirmed time is excluded. Compare corrected logs, deadlines and analytics with the underlying records, and verify isolation with a second account.
- For live Phase 5 verification, link a real private Telegram chat in staging, verify the confirmation and test delivery, then close every app tab before a scheduled reminder. Measure due-to-send lag, run overlapping worker ticks, change or cancel a pending reminder, and verify that disabled and unlinked accounts receive no later messages. Test a digest and a quiet-hour boundary. The local browser suite runs the same worker against a simulated Bot API and embedded PostgreSQL.

See the [master plan](STUDYOS_MASTER_PLAN.md), [decisions](docs/DECISIONS.md), and [progress](docs/PROGRESS.md) for the phase gate.
