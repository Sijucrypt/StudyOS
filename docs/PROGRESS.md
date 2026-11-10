# StudyOS progress

Primary specification is the [StudyOS master plan](../STUDYOS_MASTER_PLAN.md). This Phase 0 document records proposed implementation details pending owner approval.

## 8 November 2026 — Phase 0

**Status at close:** Documentation and architecture review complete. Owner subsequently authorized Phase 1.

- Split the specification into [product requirements](PRD.md), [architecture](ARCHITECTURE.md), [database](DATABASE.md), [roadmap](ROADMAP.md), [security](SECURITY.md) and [decisions](DECISIONS.md). Added the root [repository instructions](../AGENTS.md).
- Reviewed published service constraints for hosting, scheduling, file transfer, auth, provider data use, Telegram and backups. Recorded design risks, candidate mitigations and phase-specific verification steps.
- The architecture is feasible at the design level. Target-plan scheduler behavior, real delivery lag, upload/parser compatibility, provider eligibility and production cost still require validation. No services were provisioned or tested.
- Recorded the owner's preference for a simple light UI in Phase 1. Dark mode and a theme toggle are deferred.
- No application code, scaffolding or dependencies were added. There is no application test suite to run at this phase.

## 8 November 2026 — Phase 1

**Status:** Implemented and verified locally. Live Supabase verification is pending.

- Added the light Next.js app shell, Supabase sign-in, protected routes, dashboard, and editable profile and timezone.
- Added academic sessions, semesters, standalone courses, course move/copy, topic hierarchy and completion, archive/restore, and optional Harmattan import.
- Added the versioned PostgreSQL migration with RLS, same-owner and same-course constraints, and a transactional seed function.
- Passed lint, TypeScript checking, the production build, and three PostgreSQL integration tests. Desktop and 320px phone browser workflows passed with a loopback Supabase Auth/REST test double backed by the migration in embedded PostgreSQL. The npm audit at install reported zero vulnerabilities after updating a lint dependency.
- Live Supabase Auth and PostgREST, account provisioning, session refresh, and physical-phone behavior still need verification against a development project. The [README](../README.md) includes the setup and verification checklist.

## 8 November 2026 — Phase 2

**Status:** Implemented and verified locally. Live Supabase Storage and physical-phone verification are pending.

- Added private course uploads, cross-course filename search, short-lived original downloads, and an inline PDF reader.
- Added a durable worker for size and signature verification, text extraction and cleanup. Original access is independent of extraction status. The extractor records known PDF page and presentation slide numbers.
- Added rich-text notes with autosave and revision checks that preserve stale drafts without overwriting the saved version.
- The versioned migration defines storage policies, upload reservations, chunk storage, job leases and note revisions. The [README](../README.md) documents the worker and the live verification steps.
- Passed lint, type checking, the production build, six PostgreSQL and parser integration tests, and four desktop and 320px phone browser workflows. Browser tests used the real extraction worker and embedded PostgreSQL behind a loopback Auth, REST and Storage test double.
- The local Supabase database was unavailable for CLI migration-history and advisor checks. Hosted Storage signing, resumable upload, and physical-phone PDF behavior remain live verification tasks.

## 9 November 2026 — Phase 3

**Status:** AI Study Studio implemented and verified locally. Live Gemini and hosted Supabase verification are pending.

- Added per-course source Q&A, summaries, study notes, flashcards, multiple-choice quizzes, theory practice and guides. Drafts can be edited and saved without changing personal notes.
- Added scoped evidence retrieval, server-validated citations, PDF page links, private result history, and atomic daily request, token and estimated-cost reservations.
- Live AI is disabled by default. The preview uses a labeled local excerpt fixture. The [README](../README.md) documents the eligibility gate, consent, configuration and live test checklist.
- Passed lint, type checking, the production build, ten integration tests and six desktop and phone-sized browser tests across Phases 1–3. Verified consent enforcement, unrelated questions, resource edits and reloads, quota reservations, private results and PDF citation navigation. The seeded demo also exercised every resource format.
- Isolated PDF preview errors so a malformed PDF can still be downloaded from the file page. The local preview runs on port 3200 with temporary demo data.

## 9 November 2026 — Phase 4

**Status:** Study planner and analytics implemented and verified locally. Hosted Supabase and physical-phone verification are pending. The owner subsequently authorized Phase 5.

- Added global and course planners with day, week and month views, topic-linked study sessions, daily and weekly repeats, and deadline management.
- Added persisted timer state with revision checks, confirmed activity, pause and resume, idempotent completion, and an audited correction history.
- Added dashboard schedule and deadline summaries, and analytics for study time, consistency, schedule adherence and active topics.
- The versioned migration defines occurrence identities and owner-scoped operations. The [README](../README.md) records the local-day rules and live verification checklist.
- Passed lint, type checking, the production build, 14 integration tests and eight browser tests across desktop and a 320px phone viewport. Covered DST gaps and overlaps, course/topic isolation, missed and cancelled sessions, recurring edits, timer persistence and duplicate completion, and corrected analytics.
- The local preview on port 3300 has temporary sample data. Verified a topic-linked repeating session, assignment deadline, timer log, corrected analytics and dashboard summaries through the preview.

## 9 November 2026 — Phase 5

**Status:** Telegram linking, reminders and delivery history are implemented and verified locally. The live Telegram acceptance check and hosted Supabase staging checks remain pending. The owner subsequently authorized Phase 6.

- Added one-time private-chat linking, a verified webhook, test messages, and unlink from either StudyOS or the bot.
- Added per-kind study and deadline reminders, lead times, quiet hours and a local-time daily digest. Planner edits and cancellations reconcile the durable queue.
- Added an independent worker with claim leases, last-minute eligibility checks, and bounded retries for confirmed failures. Unconfirmed sends are visible in delivery history and are not repeated automatically.
- Passed lint, type checking, the production build, 19 integration tests and 10 browser tests across desktop and a 320px phone viewport. Verified forged and replayed webhook requests, quiet hours, rate-limit retries, overlapping worker ticks after closing the browser context, and suppression after cancellation, disable or unlink. Telegram delivery used a simulated Bot API.
- Verified the temporary preview on port 3400. It delivered one simulated connection confirmation, test message, study reminder and deadline reminder through the standalone worker.
- The [README](../README.md) documents webhook registration, worker setup and the live acceptance check with the browser closed.

## 9 November 2026 — Supabase staging

- Created a separate StudyOS project in WajuAi's Supabase organization, in the Ireland region. Supabase quoted $0 per month for project creation and reported the project healthy.
- Configured the project's URL and publishable key in the ignored local environment file. The owner applied the five migrations with the CLI. Verified that hosted migration history matches the repository and that RLS is enabled on all 22 application tables.
- Disabled public sign-ups in hosted Supabase Auth and verified that anonymous sign-ins were already disabled.
- Verified that the owner account exists and its email is confirmed. Staging still needs the server keys for the workers, a public HTTPS deployment and webhook verification.

## 10 November 2026 — Phase 6

**Status:** Note export and release checks implemented. The live release gate remains open.

- Added owner-only Markdown and JSON downloads for the last saved note revision. Existing private original downloads remain available.
- Added [GitHub Actions checks](../.github/workflows/checks.yml) and the [release runbook](RELEASE.md) for staging, smoke tests, monitoring, paired backups and rollback.
- Passed lint, type checking, the production build, 21 integration and unit tests, and 10 browser tests on desktop and a 320px phone viewport. Note export was checked with keyboard navigation, widths from 320px to 1440px, both download formats, a signed-out visitor and a second signed-in account. The production dependency audit reported zero known vulnerabilities. Browser tests used local service fixtures.
- Production still needs a public deployment, independently supervised workers, hosted sign-in and storage verification, real Telegram delivery, performance measurements on a physical phone, alerts, a paired restore exercise and confirmed operating costs. AI remains optional and off by default.

### Staging deployment

- Rechecked the hosted Supabase project. It is healthy, has five applied migrations and 22 application tables with RLS, and has one confirmed user. The private materials bucket has a 25 MB file limit.
- Deployed commit `1db895f` to the free Render web service in Frankfurt. The staging smoke command passed against the local production build and against [the live staging URL](https://studyos-staging.onrender.com). It verified the sign-in form and signed-out redirects for the dashboard, library and settings.
- Passed the live browser and Supabase check with two disposable accounts. Verified invalid-password rejection, sign-in, sign-out, course creation and updates, note autosave, and a planner deadline after reload. The other account could not open the course or note export, and the hosted Data API returned no course row for it. Removed both test accounts and verified the synthetic course was removed.
- The staging deployment uses the existing Supabase project. The owner can sign in with the existing account. Live file processing and Telegram reminders still require their workers.

### Library worker verification

- Verified the hosted library with a disposable account and two synthetic PDFs, including a resumable upload over 6 MB. Ran the library worker from the local checkout against the staging queue. Both files were verified, saved extracted text for page one, displayed in the browser, and downloaded byte-for-byte. Removed the test account and its uploads.
- The owner selected free-only hosting on Vercel. The library worker now has a bounded Vercel function entry point in addition to its standalone command. The [release runbook](RELEASE.md) records how to deploy the function and use Supabase Cron and Vault. Vercel account authentication, deployment, and live scheduling remain pending.
- Verified the production build, parser bundle, lint, type check, and 21 integration and unit tests. The new worker browser test passed on desktop and phone viewports, including unauthorized requests and real PDF parsing against the loopback database fixture. The scheduler SQL passed with fixture extensions and dispatched only when jobs or cleanup were due.
