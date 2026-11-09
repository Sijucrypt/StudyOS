# StudyOS decision register

Primary specification is the [StudyOS master plan](../STUDYOS_MASTER_PLAN.md). This Phase 0 document records owner decisions and proposals pending approval.

## Phase 0 decisions and proposals

| ID | Decision | Direction |
|---|---|---|
| D01 | Account scope | Single invited owner initially. Keep data ownership multi-user safe. |
| D02 | Theme | **Owner confirmed.** Start with a simple light UI in Phase 1. Defer dark mode and a theme toggle. |
| D03 | Hosting | Next.js on Vercel and Supabase Auth/Postgres/Storage. Use low-cost plans for development. Select production tiers against reliability, backup and budget needs. Supabase Free lists inactivity pausing and lacks automatic backups. [Supabase plans](https://supabase.com/pricing) |
| D04 | Reminder precision | Start with a proposed five-minute due-to-send target during normal operation. Trial Supabase Cron at one minute with an authenticated, bounded worker. Measure and record staging results before release. Set expiry for stale reminders and surface failed deliveries. |
| D05 | AI provider and cost | Keep AI off by default. Evaluate Gemini with synthetic data only if the use is eligible. Its published terms restrict consumer use and permit product improvement with unpaid submissions in applicable regions. If eligibility cannot be confirmed, use another eligible provider or leave AI off. Require an owner-set budget, hard app caps and a kill switch before private data is sent. [Gemini terms](https://ai.google.dev/gemini-api/terms) · [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| D06 | AI privacy | Require explicit opt-in for selected excerpts after reviewing the chosen provider's terms, data use and retention. No consent is assumed in Phase 0. |
| D07 | Academic session | Choose the label at onboarding. Offer optional import of the master plan's 10 Harmattan courses. |
| D08 | File quotas | Start with 25 MB per file and 250 MB per user. Count pending reservations against quota and verify provider limits before deployment. |
| D09 | Export | Markdown and JSON notes plus original downloads for MVP. Full archive later. |
| D10 | Name | Keep StudyOS. |

D02 is confirmed. D01 and D03–D10 remain proposed. Phase 1 approval may leave the provider choice, private-data consent and spending authorization pending. Record any exceptions here. Before committing to production tiers, verify the selected project's pausing policy, storage and egress usage, worker invocation costs and backup retention. A one-minute poll can generate roughly 43,200 wake-ups in a 30-day month if it calls the worker on every tick. Prefer dispatching only when work is due if the measured volume or cost warrants it.

## Phase 1 implementation decisions

- The owner authorized Phase 1. The app uses a provisioned, confirmed Supabase account and email/password sign-in. Public signup is disabled in the local configuration and must be disabled in hosted Supabase.
- Semester course codes are unique after trimming and case normalization, including archived records. Standalone courses can share codes. A transfer into a semester with a conflicting code fails without changing the source. Moving retains the course ID and topics. Copying creates a separate offering with the course details.
- Archives preserve records and history. Archiving a session or semester excludes its descendants from active dashboard totals. Archive and restore operate on the selected record. Archiving an individual topic preserves its descendants and their progress.
- The optional template import is tracked per semester. It skips existing codes and records a successful run transactionally. A retry does not re-create imported courses that were edited or moved later.

## Deferred implementation decisions

Resolve these when their respective phase begins.

| Phase | Decision |
|---|---|
| Live AI activation | Provider eligibility, model, regional availability, paid account terms and explicit spending limits. |
| Live reminder deployment | Hosting tier, public webhook, worker supervision, and measured delivery lag. |
| 6 | Backup cadence, retention, restore targets and deletion policy. |

## Phase 2 implementation decisions

- Originals go directly to private Supabase Storage. A signed upload is tied to an immutable object key. Files over 6 MB use signed resumable upload. Each pending upload reserves 25 MB against the 250 MB quota until verified or cleaned up, so a forged file size cannot bypass the cap.
- A separate Node process polls leased jobs and runs untrusted parsing in a bounded worker thread. Verification and extraction are separate. The worker uses the Storage API for cleanup after a 27-hour grace period for signed and resumable uploads.
- React-PDF uses a bundled PDF.js worker and matching font and character-map assets. PDF and presentation chunks carry page and slide numbers. Slides follow presentation order. Word and plain-text chunks use no page number. Image and scanned PDF text extraction requires later OCR.
- Tiptap notes store normalized structured content. The editor debounces autosave and compares revisions atomically. When another editor has saved a newer revision, the stale draft remains visible for recovery.
- Library search starts with filenames. Extracted text is reserved for the worker and future scoped retrieval. Persistent citation behavior after reprocessing remains a Phase 3 decision.

## Phase 3 implementation decisions

- Gemini is an optional adapter behind explicit deployment configuration and per-request consent. The development preview uses a labeled loopback provider that returns sample excerpts. Live provider eligibility, credentials and spending approval are separate from Phase 3 code approval.
- Q&A uses scoped PostgreSQL full-text search. Resource generation samples bounded excerpts across selected sources. Requests use up to six files and twelve excerpts. A question with no lexical match records an insufficient-evidence result without a provider call.
- Chat history and generated drafts share the `ai_results` storage model. The app stores separate citation snapshots with verified file and page or slide coordinates. Immutable originals keep those coordinates meaningful after re-extraction. Removed files are labeled as unavailable.
- Per-user UTC quotas reserve request count, tokens and estimated cost before calling Gemini. Source text and question contents are excluded from usage records. An individual response can be linked to verified evidence while still requiring review for meaning.

## Phase 4 implementation decisions

- The planner uses day and week agendas and a month grid. Study sessions can link to a course and one of its topics. PostgreSQL materializes stable occurrence IDs on demand and precomputes the next 30 days when a series is saved. Daily and weekly repeats keep their anchor time zone. Spring gaps shift forward by the size of the gap. Fall overlaps use the later instant. Duration is elapsed time. [PostgreSQL timestamp rules](https://www.postgresql.org/docs/17/datetime-invalid-input.html)
- A one-session edit keeps the original occurrence ID. Replacing an upcoming series retires the old definition from the time of the edit and hides superseded planned occurrences. Completed and past occurrences are preserved. Cancelling an occurrence leaves other repeats intact. An active linked timer prevents cancellation or rescheduling of its occurrence.
- One timer can be running or paused per account. PostgreSQL serializes changes and checks revisions and start request IDs. Visible pages check in every ten seconds. If check-ins stop for more than 30 seconds, the timer pauses and credits only confirmed time. Log corrections keep the original elapsed time and append the reason and changed duration.
- Analytics assigns each completed log to its completion date in the profile time zone, including logs that cross midnight. Consistency counts days with a completed log. Adherence includes completed and missed sessions that have started, and excludes cancelled or superseded occurrences. Topic completion uses active topics in active courses.

## Phase 5 implementation decisions

- A Telegram link expires after ten minutes. StudyOS stores the token hash, binds the private chat from a verified webhook, and consumes the token once. Unlinking revokes queued deliveries and turns off scheduled reminders. The owner can also unlink with `/stop` in the bot.
- Planner writes enqueue reminders within the three-day delivery window transactionally. A standalone Node worker refreshes the window and claims due jobs every 30 seconds. A one-shot mode supports a separately managed scheduler. The production deployment and delivery-lag target still need staging verification.
- Lead times range from zero to 1,440 minutes. Advance reminders expire at the scheduled event or deadline. At-time alerts have a five-minute grace period. Quiet hours can cross midnight, use the profile time zone, and defer only within the delivery window. Daily digests cover the owner's local day.
- Claims and sends use separate fenced leases. Explicit temporary provider errors retry with bounded backoff and Telegram's requested delay. For ambiguous sends, the implementation favors duplicate prevention over the master plan's at-least-once delivery target: an unconfirmed send or expired send lease is recorded as delivery unknown and is not automatically retried. Confirm this tradeoff before enabling live delivery. An external send already in progress cannot be recalled after unlinking or cancelling.

## Master plan detail

### 19. Risks and tradeoffs

| Risk | Impact | Mitigation |
|---|---|---|
| AI costs / free-tier changes | Unexpected bills or disabled AI | Budgets, quotas, optional AI, provider adapter |
| Scanned documents without OCR | Weak source grounding | Flag unsupported pages, add OCR later |
| Serverless cron limits | Late/missed reminders | Validate plan, durable queue, alternate worker |
| Long-running parsing | Request timeouts | Asynchronous jobs, bounded resource use |
| Source hallucination | Wrong study content | Grounding, verified citations, editable output, disclaimers |
| RLS misconfiguration | Privacy breach | Policy tests and negative access cases |
| Autosave race conditions | Lost notes | Revision checks, debounce, conflict UI |
| Mobile document/AI split view | Poor usability | Single-pane mobile workflow, real-device testing |
| Backup assumptions | Irrecoverable files | Explicit DB + object storage recovery plan |
| Scope creep | Slow launch | Phase gates, defer advanced AI and collaboration |

### 20. Open decisions for owner approval

1. **Accounts:** single-user private signup/invite-only initially, or self-service registration later? *Recommendation:* invite-only/single-user first.
2. **Theme (decided):** start with a simple light UI. Defer dark mode and a theme toggle.
3. **AI:** Gemini first, with opt-in and usage caps? *Recommendation:* yes; verify current pricing and terms at implementation time.
4. **Hosting:** Vercel/Supabase with a separate scheduler if minute-level cron isn't supported? *Recommendation:* validate plan limits before locking in.
5. **Reminder precision:** acceptable delay (e.g. up to 5 minutes) versus near-minute accuracy? Determines worker cost.
6. **Academic session label:** choose at onboarding; do not assume academic year from calendar date.
7. **File quotas:** start with 25 MB per file and 250 MB total, adjustable after evaluating storage plans.
8. **AI privacy:** confirm consent to send selected extracted passages to third-party model provider.
9. **Data export:** Markdown/JSON notes and file downloads in MVP; full archive export later?
10. **App name:** keep StudyOS or rename before branding/deployment?
