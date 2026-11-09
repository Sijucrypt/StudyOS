# StudyOS security and privacy

Primary specification is the [StudyOS master plan](../STUDYOS_MASTER_PLAN.md). This Phase 0 document records proposed implementation details pending owner approval.

## Phase 0 controls

- Provision the owner through a controlled invite with public signup disabled. Enforce verified auth and authorization at each entry point. Test logged-out and cross-user requests against both the app and direct Supabase APIs.
- Use private buckets, opaque keys and short-lived signed URLs. Treat signed URLs as bearer credentials until expiry. Keep unverified uploads unreadable. Bound decompressed bytes, file count, CPU, memory and elapsed time for parsing. Render safe structured notes and untrusted generated content without raw HTML.
- Keep privileged DB credentials, bot token and webhook/scheduler secrets server-side in separate environments. Narrow worker privileges and verify job ownership. Redact signed URLs, link tokens, documents, prompts and chat identifiers in telemetry. Rotate secrets after exposure.
- Validate the Telegram HTTPS webhook secret header before processing. Accept linking in private chats only, use short-lived random deep-link tokens within Telegram's payload limit and consume their hashes atomically. Recheck active connection before sending. Keep notification content minimal and test replay, unlink, retries and forged requests. [Telegram bot features](https://core.telegram.org/bots/features#deep-linking) · [Telegram Bot API](https://core.telegram.org/bots/api)
- Enable AI only after provider eligibility, disclosure and opt-in. Explain selected excerpts, purpose, provider terms and any retention. Set app-side quotas, avoid private excerpts on unpaid Gemini, reject unsupported citations and keep retrieved text away from privileged actions. [Gemini terms](https://ai.google.dev/gemini-api/terms)
- Back up and restore object bytes separately from Postgres. Test a paired restore against the material catalog. Define retention, account deletion, signed URL expiry, object cleanup and what remains in backup history before release. Offer Markdown/JSON note export and original file downloads in MVP, pending owner approval. [Supabase backups](https://supabase.com/docs/guides/platform/backups)

## Master plan detail

### 14. Security and privacy threat model

| Threat | Mitigation |
|---|---|
| Cross-user access | RLS, ownership checks, composite FK discipline, negative authorization tests |
| Leaked files | Private buckets, short-lived signed URLs, no public object paths |
| XSS via notes/AI output | Safe structured editor content, sanitization, no unsanitized HTML injection |
| Malicious uploads | MIME/signature validation, size caps, safe parsers, sandbox/timeout, no macro execution |
| Prompt injection in documents | Treat source text as data, constrained prompts, verified citations, no privileged AI tool actions |
| Credential exposure | Server-only secrets, `.env.example`, secret scanning, rotation procedure |
| Abuse/cost spikes | Rate limits, quotas, job concurrency limits, usage budget alerts |
| Fake bot linking/webhooks | Expiring single-use link token, verified webhook secret, replay controls |
| Scheduler abuse | Authenticated worker endpoints, least privilege, idempotent jobs |
| Data loss | Database backups, object retention/export, migration rollback plan, autosave revisions |

**Privacy:** Provide delete/export capabilities, transparent AI data handling, retention periods for failed jobs/chat history, and secure deletion workflow. Never log sensitive note contents or Telegram bot credentials.
