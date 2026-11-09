# StudyOS repository instructions

Primary specification is the [StudyOS master plan](STUDYOS_MASTER_PLAN.md). This Phase 0 document records proposed implementation details pending owner approval.

## Start here

Read the master plan, [docs/PROGRESS.md](docs/PROGRESS.md), [docs/DECISIONS.md](docs/DECISIONS.md) and the relevant design docs before editing. Follow the current phase in [docs/ROADMAP.md](docs/ROADMAP.md). If a proposed implementation detail conflicts with the master plan, surface the conflict and record the owner's decision.

## Working agreement

- Phase 0 is documentation only. Wait for explicit owner approval before scaffolding, writing app code or installing packages for Phase 1. Stop at every subsequent phase gate.
- At each phase start, propose small tasks, touched paths, risks and acceptance criteria. Complete one coherent slice at a time. Keep PROGRESS and DECISIONS current.
- Once implementation is approved, use strict TypeScript, runtime validation, parameterized queries and server-side authorization. Use versioned migrations for database changes and test RLS with multiple users. Keep credentials server-only and out of source control and logs.
- Verify behavior through its normal entry points and consider mobile and accessibility. Run lint, typecheck and relevant tests when tooling exists. Report commands actually run and any blocked checks. Label mocked integrations and document live verification steps.

## Master plan detail

### 18. Codex operating contract

1. Read this document, `AGENTS.md`, and relevant current code before changes.
2. In Phase 0, create/revise documentation only; do not install dependencies or scaffold app without approval.
3. At the start of each phase, propose small tasks, touched files, risks and acceptance criteria.
4. Implement one coherent task at a time; keep changes reviewable.
5. Use strict TypeScript, runtime validation, parameterized queries, and server-side authorization.
6. Write migrations and tests alongside functionality; avoid manual production changes.
7. Run lint, typecheck and relevant tests; distinguish actually run checks from untested claims.
8. Never fabricate API results, completed features, source citations or screenshots.
9. Never store secrets in repository or output them in logs.
10. Update `docs/PROGRESS.md` and `docs/DECISIONS.md` after material changes.
11. Stop at each phase gate and request approval before continuing.
12. If external services/credentials are unavailable, implement mocks or stubs clearly labeled and provide a manual verification checklist.

#### Definition of done for each task

- Behavior meets written acceptance criteria.
- Responsive and accessible states considered.
- Authorization and validation verified.
- Relevant tests added and run or explicitly documented as blocked.
- No new unhandled errors or TypeScript/lint failures.
- Documentation and migration instructions updated.
- Changes summarized with limitations and next steps.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
