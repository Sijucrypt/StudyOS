# StudyOS product requirements

Primary specification is the [StudyOS master plan](../STUDYOS_MASTER_PLAN.md). This Phase 0 document records proposed implementation details pending owner approval.

## Release intent

Build a private academic workspace for desktop and phone. The first onboarding template covers UNIOSUN 400-level Harmattan. Ask the owner for the academic session label and make import optional and safe to retry. Standalone courses need no semester. Treat copying as a new offering with independent progress. Moving an existing course preserves its ID and linked records.

The release requires a real closed-browser Telegram reminder, a readable original when extraction fails, notes that survive a reload, and scheduling and analytics backed by real data. AI is optional for the user. Provider approval and activation are separate from the core workflows. Track phase acceptance in [ROADMAP.md](ROADMAP.md) and product choices in [DECISIONS.md](DECISIONS.md).

## Master plan detail

### 1. Executive summary

StudyOS is a responsive, private academic productivity web application for organizing university and self-directed learning. It supports unlimited user-created academic sessions, semesters, courses, topics, materials, notes, AI-generated learning resources, study plans, progress records, and Telegram reminders. The first dataset is the user's UNIOSUN 400-level Harmattan semester; the data model must not hardcode any academic year, semester, or course.

**Success criteria:** A user can sign in on a laptop or phone, create a semester and course, upload and read a PDF, write a note, schedule study time, receive a Telegram reminder while the browser is closed, and optionally ask an AI question grounded in selected documents. AI outages must not block core study functions.

#### 1.1 Product principles

1. **Flexible:** Courses can belong to any academic session/semester or to a standalone learning collection.
2. **Source-first:** Original documents remain accessible independently of extraction and AI processing.
3. **Private:** User-scoped access, private storage, server-side credentials, and least privilege.
4. **Reliable:** Autosave, idempotent reminders, durable scheduling, recoverable processing jobs.
5. **Affordable:** Start with one user and managed infrastructure; set budgets and usage limits.
6. **Mobile-first usability:** Full functionality on phone, not merely a squeezed desktop layout.
7. **Incremental:** Each phase ships a usable, tested slice with clear acceptance criteria.

### 2. Scope and priorities

#### 2.1 MVP (first complete usable release)

- Sign-in, protected routes, user profile, timezone/preferences.
- Academic sessions, flexible semesters, course CRUD, course topics and completion.
- Course-specific library: PDF, DOCX, PPTX, TXT, MD and image uploads; secure download; PDF inline reader; metadata/search.
- Rich-text personal notes with safe rendering and autosave.
- AI Studio v1: source extraction, selected-source summarization, study notes, flashcards, practice questions, and grounded Q&A with references where available.
- Calendar with one-off and recurring study blocks, assignment/exam deadlines, timer and study logs.
- Telegram account linking and configurable scheduled reminders.
- Responsive dashboard with real progress and activity metrics.
- Basic tests, production deployment, backup/export procedure and monitoring.

#### 2.2 Later enhancements (not launch blockers)

- OCR for scanned PDFs and handwriting; image interpretation; website/YouTube sources.
- Semantic vector retrieval at scale, cross-course knowledge search.
- Spaced repetition, flashcard scheduling, advanced adaptive quizzes.
- Offline-first PWA, document annotations and collaborative sharing.
- AI-generated audio overviews, mind maps, presentations and multi-agent workflows.
- Full multi-user onboarding, team spaces and institution-wide deployment.

#### 2.3 Explicit non-goals for MVP

No social feed, public document sharing, grade prediction, plagiarism guarantees, automatic official exam date discovery, or AI-dependent access to files.

### 3. Initial seed data

Seed **only** the following 10 courses in a configurable Harmattan semester. Academic year/session should be chosen during onboarding rather than guessed. Do not seed fictional topics, dates, grades or progress.

| Code | Course | Units |
|---|---|---:|
| CSC401 | Software Engineering | 3 |
| CSC403 | Artificial Intelligence | 3 |
| CYB401 | System Vulnerability Assessment & Testing | 3 |
| CYB403 | Cloud Computing Security | 2 |
| CYB405 | Information Disaster Recovery | 2 |
| CYB407 | VoIP & Multimedia Security | 2 |
| CYB409 | Enterprise Security & Information Assurance | 2 |
| CYB411 | Special Topics in Computing | 2 |
| CYB415 | Threats, Exploits & CounterMeasures | 2 |
| CYB497 | Research Methodology | 1 |
| **Total** | **10 courses** | **22** |

Courses must be editable, archivable, and transferable/copiable between semesters. Do not delete historical progress implicitly when moving a course; prefer creating a new course offering/instance when retaking it.

### 4. User journeys

1. **Onboard:** Sign in → set timezone → create academic session and semester → import optional seed courses.
2. **Organize:** Create a course → add topics → upload sources → categorize and search.
3. **Read and take notes:** Open source in reader → write/edit note → autosave → resume on phone.
4. **Generate learning resources:** Select sources → choose output type and instructions → generate → inspect citations → edit/save to course.
5. **Ask about sources:** Select course documents → ask question → read grounded response with clickable source references; see clear uncertainty if not supported.
6. **Plan:** Create recurring study block → select course/topic → set reminder lead time → receive Telegram message.
7. **Track:** Start/pause/finish timer → save actual duration → complete topics → review dashboard.
8. **Recover:** Retry failed extraction, re-open original file, export notes, reschedule missed sessions.

### 7. Information architecture and routes

| Route | Purpose |
|---|---|
| `/login` | Sign-in |
| `/dashboard` | Today, stats, next sessions, recent files |
| `/sessions` | Academic sessions and semesters |
| `/sessions/[sessionId]/semesters/[semesterId]` | Semester courses and overview |
| `/courses/new` | Create course or standalone learning course |
| `/courses/[courseId]` | Course overview |
| `/courses/[courseId]/topics` | Topic hierarchy/progress |
| `/courses/[courseId]/library` | Upload, filter and manage sources |
| `/courses/[courseId]/materials/[materialId]` | Reader and source metadata |
| `/courses/[courseId]/notes` | Personal and generated notes |
| `/courses/[courseId]/studio` | AI resource generation |
| `/courses/[courseId]/chat` | Grounded source chat |
| `/courses/[courseId]/planner` | Course-specific schedule |
| `/library` | Cross-course material browser |
| `/planner` | Daily/weekly/monthly calendar |
| `/analytics` | Study time, consistency, topic completion |
| `/settings` | Profile, timezone, data export |
| `/settings/integrations/telegram` | Link/test/unlink bot notifications |

Use URL-based tabs where useful, with preserved back-navigation and mobile-friendly navigation.

### 8. UI/UX specification

**Visual direction:** start with a simple light UI. Use light surfaces, readable typography, subtle accents and minimal decoration. Defer dark mode and a theme toggle.

**Desktop:** collapsible left sidebar, top bar, course cards, split document/notes/AI workspace. **Mobile:** bottom navigation or drawer, stacked cards, segmented tabs for Source / Notes / AI, full-screen reader when needed. Support ~320px viewport widths, touch targets ≥44px, keyboard navigation, focus indicators, loading/empty/error states and reduced-motion preferences.

**Primary dashboard widgets:** courses, study time this week, upcoming schedule, deadlines, topic progress, recently opened files, quick add. Do not display fabricated data; use genuine empty states.

**Study workspace:** desktop 2–3 panes where screen width permits; on mobile, a single active pane with persistent save indicators and easy source switching.

**Design tokens:** define the light palette, spacing, typography, radii, elevation and semantic status colors in one theme layer. Meet WCAG AA contrast targets where feasible.

### 13. Progress and analytics definitions

- **Topic completion:** completed topics / total active topics; if zero topics, display “Not started” rather than 0% as a judgment.
- **Study hours:** sum of completed, valid `study_logs.active_seconds` within timezone-aware reporting interval; do not sum scheduled duration.
- **Consistency:** days with ≥1 completed study log / days in selected interval; disclose definition.
- **Schedule adherence:** completed planned occurrences / eligible planned occurrences; exclude future and cancelled sessions.
- **Upcoming deadlines:** open deadlines sorted by due time, including overdue separately.

Course progress should default to topic completion, with study time as a separate metric. Never derive grades or GPA without user-entered results and an explicit grading policy.
