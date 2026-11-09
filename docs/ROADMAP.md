# StudyOS delivery roadmap

Primary specification is the [StudyOS master plan](../STUDYOS_MASTER_PLAN.md). This Phase 0 document records proposed implementation details pending owner approval.

## Gates and verification

Phase 0 ends with owner approval of the scope, hosting strategy, scheduler target and AI privacy/cost direction. The architecture review confirms documented capabilities. It leaves runtime and plan validation as explicit acceptance work.

| Checkpoint | Evidence required |
|---|---|
| Before Phase 1 starts | Owner approval recorded. Outline the first small foundation task, proposed touched paths, risks and acceptance criteria. |
| Phase 1 | Invitation and protected route behavior on desktop and phone. Two-user negative tests, idempotent seed import and editable standalone courses. Confirm selected web/database plans and environment separation. |
| Phase 2 | Direct private upload near configured limit, quota races and aborted-upload recovery, representative parser and reader tests, original readable after extraction failure, note revision conflict across devices. |
| Phase 3 | Provider eligibility and budget decision, consent controls, citation and injection tests, and core study flows working with AI disabled. |
| Phase 4 | DST gaps/overlaps, recurrence edits and exceptions, midnight boundaries, timer reconciliation, idempotent completion and metrics checked against fixtures. |
| Phase 5 | Staging worker runs independently of browser. Measure lag against the approved target, including duplicate triggers, edit/cancel/unlink, transient failures and catch-up after downtime. |
| Phase 6 | Production smoke test, desktop/mobile and keyboard checks, monitoring, documented operating costs, paired database and file restore, rollback and export. |

Use the unit, integration and end-to-end strategy below. Keep timing targets provisional until baseline profiling. Record the evidence and limitations in [PROGRESS.md](PROGRESS.md).

## Master plan detail

### 16. Testing strategy

**Unit:** recurrence expansion, timezones, progress calculations, note revision conflict handling, parsing chunk boundaries, citation validation, idempotency key generation.

**Integration:** auth/RLS, course ownership, signed file access, document processing job transitions, AI adapter mock, Telegram webhook token redemption, notification claims/retries.

**End-to-end:** login → create session/semester/course → upload/read file → create/edit note → generate resource → schedule session → complete timer → inspect analytics → receive test Telegram notification.

**Responsive/accessibility:** test 320/375/768/1024/1440px, real mobile browser where available, keyboard-only navigation, screen-reader labels, contrast, zoom and reduced motion.

**Security negative tests:** unauthenticated access, cross-user IDs, invalid upload types, oversized files, forged webhook requests, prompt injection in source text, replayed link tokens, duplicate scheduler invocation.

**Performance targets (initial, to validate):** fast perceived dashboard load on average mobile connections, reasonable PDF first-page display, responsive typing/autosave, bounded extraction and generation latency with visible progress. Define measurable budgets after baseline profiling rather than inventing guaranteed numbers.

### 17. Implementation roadmap and acceptance gates

#### Phase 0 — Planning and repository standards

**Deliverables:** this plan split into `docs/PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `ROADMAP.md`, `SECURITY.md`, `DECISIONS.md`, plus `AGENTS.md` and `PROGRESS.md`.

**Gate:** user approves scope, hosting strategy, AI privacy/cost approach and scheduler feasibility. **No app code yet.**

#### Phase 1 — Foundation and flexible academics

- Initialize Next.js, TypeScript, Tailwind and UI primitives.
- Supabase auth, protected routes, RLS/migrations.
- Academic session, semester, standalone course, course/topic CRUD.
- Responsive app shell, dashboard empty states, initial optional seed import.

**Acceptance:** On phone and laptop, authenticated user can create/edit/archive academic structures; unauthorized access is blocked; no hardcoded semester/course restrictions; tests pass.

#### Phase 2 — Source library and notes

- Private uploads, file metadata/search/download, inline PDF viewer.
- Extractor job flow for text-bearing formats, status/retry handling.
- Tiptap notes, autosave and conflict-safe revisions.

**Acceptance:** User can upload/read/reopen documents across devices, create/edit notes, and still read originals when extraction fails. Cross-user access tests pass.

#### Phase 3 — AI Study Studio

- Server-side Gemini adapter, quotas and privacy disclosure.
- Scoped chunk retrieval, grounded Q&A, validated citations.
- Generate/edit/save summaries, notes, flashcards, quizzes and guides.

**Acceptance:** Source references link to actual documents; unsupported questions report insufficient evidence; provider errors do not break library/notes; cost caps work.

#### Phase 4 — Study planner and analytics

- Calendar, recurring events, deadlines, timer, study logs.
- Dashboard and progress calculations based on real data.

**Acceptance:** Repeated events display correctly, missed/cancelled handling works, timer doesn't double-count, metrics match underlying logs.

#### Phase 5 — Telegram reminders

- Bot linking, webhook verification, preferences, outbox, worker, retries.
- Study/deadline/daily digest notifications and edit/cancel handling.

**Acceptance:** Real reminder reaches linked Telegram account with browser closed; duplicate worker invocations don't routinely duplicate messages; disabled/unlinked users are not messaged.

#### Phase 6 — Hardening and release

- Full E2E/mobile/security review, performance, monitoring, backup/export, deployment docs.

**Acceptance:** Production smoke tests pass; known limitations and running costs are documented; rollback procedure exists.
