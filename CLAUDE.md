# Job Search Assistant — CLAUDE.md

This file orients any future development session (including Claude Code over
SSH) on this project. It is a **personal, single-user** job search and
application assistant. There is no multi-tenant auth — access is gated by a
single 4-digit PIN.

## Stack

- **Frontend**: React + Vite + TypeScript + Tailwind CSS, mobile-first
  (390px viewport baseline). Lives at `artifacts/job-search-assistant`.
- **Backend**: Node.js + Express 5 + TypeScript. Lives at
  `artifacts/api-server`. Bundled with esbuild.
- **Database**: **SQLite via `better-sqlite3`** — deliberately NOT the
  monorepo's default Postgres/Drizzle stack (`@workspace/db`). This app does
  not use that package at all.
- **API contract**: Plain REST + `fetch` on the frontend. This app does
  **not** use the monorepo's OpenAPI/Orval codegen pattern
  (`@workspace/api-client-react`) — there are no generated hooks. Any new
  endpoint must be added by hand on both the Express route and the frontend
  fetch call.
- **File storage**: Local disk at `artifacts/api-server/uploads` (resumes,
  generated documents). Not S3/object storage — this is a personal tool
  running on a single instance.
- **Auth**: A single 4-digit PIN (`APP_PIN` env var). No user accounts, no
  passwords, no OAuth. A session cookie (HMAC of `APP_PIN` using
  `SESSION_SECRET`) is issued on successful PIN entry and checked on every
  API route except `/api/healthz` and `/api/auth/*`.

## Environment variables (Replit Secrets)

- `APP_PIN` — the 4-digit PIN required to unlock the app.
- `SESSION_SECRET` — used to sign the session cookie.
- `ANTHROPIC_API_KEY` — **not yet requested/wired up**. Required once AI
  tailoring/generation logic is implemented (resume tailoring, cover letter
  drafting, Q&A answers).
- `TAVILY_API_KEY` — **not yet requested/wired up**. Required once the
  Discover page's job search is implemented.

## Folder structure

```
artifacts/api-server/
  src/
    app.ts                 # Express app: middleware, mounts /api router
    index.ts                # HTTP server bootstrap
    lib/
      db.ts                 # better-sqlite3 connection + schema DDL + row types
      paths.ts               # resolves uploadsDir / dataDir regardless of cwd
      logger.ts              # pino logger (use req.log / logger, never console.log)
    middlewares/
      pinAuth.ts             # PIN verification, session cookie issue/check, requirePin guard
    routes/
      index.ts               # mounts health (public), auth (public), then requirePin, then the rest
      health.ts               # GET /healthz
      auth.ts                 # POST /auth/login, GET /auth/status, POST /auth/logout
      profile.ts               # profile CRUD + resume upload/download (multer, .docx only)
      jobs.ts                   # job CRUD + status transitions + POST /jobs/:id/tailor (stub)
      documents.ts               # per-job documents list + POST generate (stub) + download
      discover.ts                 # GET /discover/search (stub, returns empty results)
  uploads/                # gitignored — uploaded resumes + generated docs live here
  data/                   # gitignored — app.db (SQLite file) lives here

artifacts/job-search-assistant/
  src/
    pages/                # Profile, Jobs, JobDetail, Discover
    components/           # shared UI (nav shell: bottom tab bar mobile / sidebar desktop, etc.)
    ...
```

## Database schema (SQLite)

- **`profile`** — single row, `id = 1` (enforced by CHECK). Fields:
  `resume_filename`, `resume_json`, `style_map_json`, `extra_answers_json`,
  `updated_at`. Represents the user's one base resume + parsed structured
  data + writing-style preferences + answers to recurring application
  questions.
- **`jobs`** — one row per job the user is tracking. Fields: `title`,
  `company`, `source_url`, `posting_text`, `status`
  (`New` → `Tailoring` → `Ready` → `Applied`), `created_at`.
- **`documents`** — generated artefacts tied to a job (`job_id`, cascade
  delete). `type` is one of `resume`, `cover_letter`, `cover_letter_plain`,
  `cover_note`. Holds `content_json` plus paths to generated `.docx`/`.pdf`
  files under `uploads/`.
- **`qa_log`** — a history of application-question/answer pairs tied to a
  job, for reuse and consistency across applications.

Foreign keys are enforced (`PRAGMA foreign_keys = ON`); deleting a job
cascades to its documents and QA log entries.

## Pages (frontend)

- **Profile** — upload/replace the base resume (`.docx` only), view/edit
  parsed professional details, writing style preferences, and saved answers
  to common application questions.
- **Jobs** — list of tracked jobs with status badges (New / Tailoring /
  Ready / Applied), add a job by pasting a URL or the raw posting text.
- **Job Detail** — full posting text, tailored resume and cover letter(s)
  once generated, document downloads, status control.
- **Discover** — placeholder job search UI only. No real search is wired up
  yet (backend returns an empty stub result). Do not fabricate results.

Navigation: bottom tab bar on mobile, sidebar on desktop. This is an
explicit product requirement, not just a default pattern — do not replace it
with e.g. a hamburger menu.

## AI content rules (apply once AI logic is implemented)

These rules are **mandatory** for any AI-generated resume, cover letter, or
Q&A content produced by this app:

1. **Always use Australian English spelling** in all AI-generated and
   UI-authored text (e.g. "organise", "colour", "optimise", "specialise").
2. **Never fabricate experience, qualifications, employers, dates, or
   achievements.** Tailoring means re-emphasising, re-ordering, and
   re-wording the user's real, existing resume content to match a job
   posting — never inventing new experience that isn't grounded in the
   user's actual profile data. If the profile lacks information needed to
   answer a question convincingly, surface that gap to the user rather than
   inventing an answer.
3. Generated content should stay traceable to source data already stored in
   `profile.resume_json` / `profile.extra_answers_json` / `qa_log`.

## Current status (scaffold phase)

As of this build, **no AI logic is implemented**. `POST /jobs/:id/tailor`
and `POST /jobs/:id/documents/generate` return `501 Not Implemented`, and
`GET /discover/search` returns an empty result set. The frontend should
present clear "coming soon" / stub states for these rather than mocking fake
data. Implementing the real tailoring/generation/discovery logic (via
Anthropic + Tavily) is future work.

## Gotchas

- Express 5: wildcard routes need `/{*splat}` syntax; async handlers should
  be typed to return `Promise<void>` and use `res.status(...).json(...)`
  followed by a bare `return;`, not `return res...`.
- Never use `console.log` on the server — use `req.log` in route handlers or
  the shared `logger` elsewhere.
- The SQLite file and uploads directory are resolved via
  `artifacts/api-server/src/lib/paths.ts`, which works whether the process
  cwd is the repo root or the `api-server` package dir. Reuse it rather than
  hardcoding paths.
- All routes except `/api/healthz`, `/api/auth/login`, `/api/auth/status`,
  `/api/auth/logout` require a valid PIN session cookie
  (`requirePin` middleware in `routes/index.ts`).
