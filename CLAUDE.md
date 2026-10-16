# War Room (Job Search Assistant) — CLAUDE.md

War Room is Amy's **personal, single-user** job search and application
assistant. There are no user accounts: access is gated by one PIN. It was built
on Replit and is now developed **locally on Windows with Claude Code**, then
released through GitHub (`cardguardapp-rgb/war-room`, branch `main`) to the
existing Replit deployment.

The plan of work lives in `docs/build-plan.md` (milestones M0–M8).

---

## Working rules (mandatory)

- **Machines.** Locally: Windows 11, PowerShell 5.1, Node 24. Replit also runs
  Node 24. pnpm runs package scripts through Git Bash (`script-shell` is set in
  the user's pnpm config, not in the repo's `.npmrc`), so **package scripts may
  use POSIX syntax**. But **every command given to Amy must be PowerShell or
  Replit Shell, and must say which**.
- **One command at a time**, copy-paste ready.
- **Never read `.env` and never ask for secrets to be pasted.** Name the keys;
  Amy edits `.env` (in Notepad) and Replit Secrets directly.
- **Never use or suggest Replit Agent.**
- **Start of every session:** check the branch and last commit, `git fetch`, and
  say whether local and `origin/main` differ.
- **Commit at the end of each milestone** with a clear message. **Push only when
  Amy says push.**
- **Databases.** Local development uses the Neon database **`warroom-dev` only**.
  **Never connect to the production database**: the live app keeps its Replit
  Postgres database, which holds Amy's real data. This includes the smoke tests
  that touch the DB (`polishTest.ts`, `discoverTest.ts`) and any
  `drizzle-kit` command.
- **No schema changes.** New kinds of data go in the `documents` table (free-text
  `type` + `content_json`), as the app already does. If something truly needs a
  schema change, **stop and ask first**. (Note `scripts/post-merge.sh` runs
  `pnpm --filter db push` on Replit, so a schema edit merged to `main` would be
  pushed to the production database.)
- **`pnpm run dev:phone`** starts the API and the web app together, serves the
  web app over https on **port 5175** on the local network (Amy's other apps use
  5173), and prints **`War Room dev ready`** when both are up. (Added in M0.)
- **Australian English everywhere** — UI text, AI output, docs. The AI content
  rules below stay mandatory, including for everything the interview coach
  says: **never invent experience, metrics or employers.**
- **Screens.** Mobile screens must work on the Galaxy Fold6 **cover screen
  (368px)** and **inner screen (707px)**, in **light and dark**. Interview
  features (mock interview, live listen, cue cards) are **laptop-first: Chrome on
  Windows 11**.
- **No helper or explainer text in the UI.** Where help is genuinely needed, use
  an (i) tooltip.
- **The role-chat coach is right as it is.** Never change `CHAT_SYSTEM` in
  `prompts.ts`, or the coach's skills, tone and tenor, without asking first. The
  mock interview, live cue cards and debrief all reuse `CHAT_SYSTEM` **unchanged**
  as their base, adding only a short mode instruction on top (format and length
  for that mode). Make the coach faster through streaming, prompt caching and
  model choice, never by rewriting it.
- **Model defaults.** Ask before changing any model ID default. Amy decides
  whether a coach model changes.

---

## Stack

- **Monorepo:** pnpm workspaces (`artifacts/*`, `lib/*`, `scripts`), Node 24,
  TypeScript 5.9.
- **Frontend:** React 19 + Vite 7 + Tailwind 4 + shadcn/ui (Radix), wouter
  routing, TanStack Query. Lives at `artifacts/job-search-assistant`
  (`@workspace/job-search-assistant`). Mobile-first.
- **Backend:** Express 5 + TypeScript, bundled by esbuild (`build.mjs`) to
  `dist/index.mjs`. Lives at `artifacts/api-server` (`@workspace/api-server`).
  Logging with pino / pino-http.
- **Database:** **PostgreSQL through Drizzle ORM** — the shared package
  `@workspace/db` (`lib/db`): `lib/db/src/index.ts` creates a `pg` Pool from
  `DATABASE_URL`; tables in `lib/db/src/schema/`. The API re-exports the client
  and tables from `artifacts/api-server/src/lib/db.ts` — import from there.
- **File storage:** **Replit Object Storage** (GCS through the Replit sidecar at
  `127.0.0.1:1106`), wrapped by `artifacts/api-server/src/lib/objectStore.ts`
  (`newObjectKey`, `uploadObject`, `downloadObject`, `objectExists`,
  `deleteObject`). Keys are relative to `PRIVATE_OBJECT_DIR`. Nothing durable is
  written to local disk in production. **Locally** (no `REPL_ID` and nothing on
  the sidecar port) the same functions use a local-disk driver rooted at
  `<repo>/.local-storage/` (gitignored), keyed identically.
- **AI:** `@anthropic-ai/sdk` (Claude). Web search for Discover: Tavily API.
- **API contract:** plain REST + `fetch` in
  `artifacts/job-search-assistant/src/lib/api.ts` (`fetchApi` /
  `fetchMultipart`, base `/api`). The monorepo's OpenAPI/Orval packages
  (`lib/api-spec`, `lib/api-client-react`, `lib/api-zod`) exist but only the
  health check uses them (`HealthCheckResponse`); **there are no generated hooks
  in use**. A new endpoint is added by hand on both the Express route and
  `api.ts`.
- **Auth:** one PIN (`APP_PIN`). See "Auth (current)".
- `artifacts/mockup-sandbox` is Replit's design canvas scaffold, not part of the
  app.
- `.agents/memory/` holds notes from the Replit era; the useful ones are folded
  into "Gotchas" below.

## Running

**On Replit (production + Replit dev):**
- API: `artifacts/api-server/.replit-artifact/artifact.toml` — port **8080**,
  served at `/api`, health check `/api/healthz`. Production runs
  `node --enable-source-maps artifacts/api-server/dist/index.mjs`.
- Web: `artifacts/job-search-assistant/.replit-artifact/artifact.toml` — port
  20399, `BASE_PATH=/`, built to `dist/public`, served statically with a
  `/* → /index.html` rewrite. Replit's path router sends `/api` to the API.
- Deployment target is **autoscale** (ephemeral disk). `replit.nix` adds
  `libreoffice-still` (for PDF conversion).
- `scripts/post-merge.sh`: `pnpm install --frozen-lockfile` then
  `pnpm --filter db push`.

**Package scripts:**
- API `dev` = `export NODE_ENV=development && pnpm run build && pnpm run start`
  (build then run; no watch). Needs `PORT`.
- Web `dev` = `vite --host 0.0.0.0`. `vite.config.ts` **requires `PORT` and
  `BASE_PATH`** and throws without them. `runtimeErrorOverlay` (a Replit plugin)
  and all three Replit plugins (`runtimeErrorOverlay`, `cartographer`,
  `dev-banner`) load only when `REPL_ID` is set. `DEV_HTTPS=1` adds
  `@vitejs/plugin-basic-ssl` (self-signed https); `API_PORT` adds an `/api` →
  `http://localhost:$API_PORT` proxy. Both are local-only and set by `dev:phone`.
- Root: `pnpm run typecheck`, `pnpm run build`.
- `lib/db`: `push` / `push-force` (drizzle-kit). **Don't run them** (no schema
  changes; never against production).

**Locally (Windows):**
- `.env` at the repo root (template: `.env.example`) is loaded by
  `lib/db/src/env.ts` (`loadLocalEnv`, Node's `process.loadEnvFile`) **only when
  not on Replit and `NODE_ENV !== "production"`**; variables already set win.
  The API imports `@workspace/db/env` as the **first import** of `index.ts`;
  `lib/db/src/index.ts` and `drizzle.config.ts` load it too.
- **DB guard:** locally, `assertLocalDatabase` refuses any `DATABASE_URL` whose
  database name isn't `warroom-dev` (server, smoke tests, drizzle-kit). A fresh
  warroom-dev gets its tables from `pnpm --filter @workspace/db push` (guarded).
- `pnpm run dev:phone` (`scripts/dev-phone.mjs`): API on **8090** (its pnpm `dev`
  script), Vite on **5175** over self-signed https with `/api` proxied to 8090,
  then prints `War Room dev ready` plus the laptop and LAN URLs. Ctrl+C stops
  both. Vite is launched directly with Node because Git Bash (the pnpm script
  shell) rewrites `BASE_PATH=/` into `C:/Program Files/Git/`.
- **Backup import:** `pnpm --filter @workspace/api-server run import-backup
  "<zip>" [--replace]` (`artifacts/api-server/scripts/importBackup.ts`). Local
  and warroom-dev only (checks the URL and `current_database()`); refuses a
  non-empty DB unless `--replace` (truncates first). Preserves ids
  (`OVERRIDING SYSTEM VALUE`), resets the sequences, writes `files/<key>` into
  `.local-storage/<key>`. Chat attachments and the website config aren't in the
  export, so old attachments won't re-send and Website starts from defaults.
- PDF: set `SOFFICE_PATH` to use LibreOffice; otherwise downloads use the pdf-lib
  fallback. `test/docTest.ts` calls LibreOffice directly, so it needs it.
- `pnpm-workspace.yaml` overrides strip non-Linux native binaries; the
  `win32-x64` ones (esbuild, rollup, tailwind oxide, lightningcss) are allowed so
  the tooling runs on Windows. Don't re-add those exclusions.

## Environment variables

Names only — values live in `.env` (local) and Replit Secrets (production).

| Key | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | `lib/db`, drizzle config | Locally: Neon `warroom-dev` **only** |
| `APP_PIN` | `pinAuth.ts` | The PIN (login screen currently takes exactly 4 digits) |
| `SESSION_SECRET` | `pinAuth.ts` | Signs the session token |
| `ANTHROPIC_API_KEY` | `anthropic.ts` | Missing → AI endpoints return 503; the rest works |
| `TAVILY_API_KEY` | `tavily.ts` | Missing → `POST /discover/search` returns 503 |
| `PRIVATE_OBJECT_DIR` | `objectStore.ts` | `/<bucket>/<dir>`; Replit provisions it (with `PUBLIC_OBJECT_SEARCH_PATHS`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, which the code doesn't read) |
| `PORT` | API `index.ts`, `vite.config.ts` | Required by both |
| `BASE_PATH` | `vite.config.ts` | Required; real value `/` |
| `SOFFICE_PATH` | `pdf.ts` | Optional LibreOffice path |
| `CHROMIUM_PATH` | `pageRender.ts` | Optional Chromium path |
| `LOG_LEVEL`, `NODE_ENV` | logger, cookies | |

Later milestones add `AI_MODEL_*` (M2–M6) and the AssemblyAI key (M4).

## Folder structure

```
artifacts/api-server/
  build.mjs                 # esbuild bundle → dist/index.mjs
  src/
    index.ts                # HTTP server bootstrap (PORT required)
    app.ts                  # pino-http, cors, cookie-parser, json 2mb, mounts /api
    lib/
      db.ts                 # re-exports @workspace/db client + tables; ensureProfileRow()
      objectStore.ts        # Replit Object Storage helper (sidecar credentials)
      logger.ts             # pino (use req.log / logger, never console.log)
      serialize.ts          # camelCase row → snake_case API shape
      resumeParser.ts       # pure .docx → { resumeJson, styleMap, warnings } (JSZip + fast-xml-parser)
      anthropic.ts          # client; opusJson / createJson / createJsonFromImages / chatComplete;
                            #   parseJsonWithRetry; AiConfigError / AiJsonError; aiErrorResponse
      prompts.ts            # model IDs + every system prompt (CHAT_SYSTEM, TAILOR_SYSTEM, …)
      jobExtract.ts         # URL fetch + Readability (+ headless render fallback), image extraction
      tailor.ts             # resume tailoring (streamed Opus call, initial/finalize/revise)
      coverLetters.ts       # cover letters (full + short; plain = full.body)
      appQuestions.ts       # application-question answers (resume-grounded only)
      chatStore.ts          # role chat persistence; formatCoachingNotes()
      chatAttachments.ts    # chat upload ingest (images/PDF → object storage; docx/txt/md/csv → text)
      docBuild.ts           # resume + cover-letter .docx builders (docx package)
      pdf.ts                # docx → pdf via LibreOffice, pdf-lib fallback renderer
      skillGrouping.ts      # groups flat skills into discipline groups for layout (Sonnet)
      tavily.ts             # Tavily client (multi-query, URL de-dupe)
      discover.ts           # Discover settings defaults, query plan, classification, de-dupe
      pageRender.ts         # headless Chromium --dump-dom
      pageScan.ts           # harvest posting links from rendered listing pages
      siteBuild.ts          # personal-website static site + preview builder
    middlewares/pinAuth.ts  # PIN check, session token, requirePin
    routes/
      index.ts              # health, auth (public) → requirePin → everything else
      health.ts             # GET /healthz
      auth.ts               # POST /auth/login, GET /auth/status, POST /auth/logout
      profile.ts            # profile GET/PATCH; resume parse/confirm/download; GET /profile/export
      jobs.ts               # job CRUD; extract / extract-image; assess; tailor/qa/finalize/revise/approve
      documents.ts          # list; regenerate; download docx|pdf (lazy build + cache)
      generate.ts           # role chat; cover letters; application questions
      discover.ts           # settings, search, dismiss
      website.ts            # personal website config, AI draft/write, preview, export zip
  test/                     # tsx smoke scripts (see "Smoke tests")

artifacts/job-search-assistant/src/
  AppRouter.tsx             # wouter <Switch>: / and /jobs, /jobs/:id, /profile, /discover, /website
  lib/api.ts                # every API call + shared types (mirror of server shapes)
  pages/                    # jobs, job-detail, profile, discover, website, login, not-found
  components/jobs/          # AddJobDialog, TailorFlow, ResumeDiff, CoverLetterFlow, AppQuestions, RoleChat, CopyButton
  components/profile/       # ResumeReview, ExtraAnswers, AdditionalContext, resumeDraft
  components/discover/      # SettingsEditor, ResultCard
  components/layout/        # AppLayout (bottom tab bar mobile / sidebar desktop)
  components/ui/            # shadcn/ui + ai-progress

lib/db/                     # @workspace/db — Drizzle schema + pg Pool
```

## Database schema (Postgres, Drizzle)

Defined in `lib/db/src/schema/`. Drizzle rows are **camelCase** in JS; the API
returns **snake_case** (see `serialize.ts` and the per-route serialisers).

- **`profile`** — single row, `id = 1` (`ensureProfileRow()` inserts it).
  `resume_filename` (the **object storage key** of the uploaded base .docx),
  `resume_json`, `style_map_json`, `extra_answers_json` (jsonb), `extra_context`
  (text, the Profile "Additional context" box — stored and editable; no AI
  prompt reads it today), `updated_at`.
- **`jobs`** — `id` serial, `title`, `company`, `location`, `work_arrangement`,
  `source_url`, `posting_text`, `status` (text, default `'New'`), `created_at`.
  `status` has no enum/check, so adding a status needs **no migration** — extend
  `VALID_STATUSES` in `routes/jobs.ts` and the `JobStatus` union +
  `statusColors`/`statusDot`/`STATUS_ORDER` in the frontend. Order: `New` →
  `Tailoring` → `Ready` → `Applied` → `Interview` → `Offer` → `Rejected` →
  `Not Applying`.
- **`documents`** — artefacts tied to a job (`job_id` FK, `on delete cascade`).
  `type` is **free text**; `content_json` jsonb; `docx_object_key` /
  `pdf_object_key` (cached generated files in object storage, `null` until first
  download). Current types:
  - `resume` — approved tailored resume (`resume_json` shape)
  - `cover_letter` — `{ salutation, re, body }`; `cover_letter_plain` — `{ text }`;
    `cover_note` — `{ text }`
  - `assessment` — fit score/summary/flags, one per job
  - `chat` — role-chat transcript `{ messages }`, one per job
  **New kinds of data go here** (new `type` + `content_json`). Planned:
  `interview_prep` (M3), `mock_interview` (M4), `interview` (M7).
- **`qa_log`** — question/answer pairs per job (FK cascade).
- **`discover_settings`** — single row `id = 1`, `settings_json`. Absent → defaults.
- **`discover_dismissed`** — one row per dismissed URL (`url` primary key).

Deleting a job cascades to its documents and QA log.

**Not in the database:** the personal-website config is a JSON object in
object storage at the fixed key `website/config.json`.

## Resume data model

The canonical shapes are exported from
`artifacts/api-server/src/lib/resumeParser.ts` and mirrored in
`artifacts/job-search-assistant/src/lib/api.ts` — keep the two in sync. They are
stored as jsonb and returned as real objects by `GET /profile`.

### `resume_json` (the parsed resume — single source of truth)

```jsonc
{
  "version": 1,
  "sections": [            // ORDERED; render/regenerate in this order
    // kind: "contact"  (always first; produced from everything above the first heading)
    { "id", "kind": "contact", "heading",
      "name", "email", "phone", "location",
      "links": [ "…" ], "otherLines": [ "…" ] },

    // kind: "summary"
    { "id", "kind": "summary", "heading", "paragraphs": [ "…" ] },

    // kind: "experience"
    { "id", "kind": "experience", "heading",
      "items": [ { "id", "title", "company", "dates", "location",
                   "bullets": [ "…" ] } ] },

    // kind: "education"
    { "id", "kind": "education", "heading",
      "items": [ { "id", "institution", "qualification", "dates", "location",
                   "details": [ "…" ] } ] },

    // kind: "skills"
    { "id", "kind": "skills", "heading", "items": [ "…" ] },

    // kind: "other"  (anything the parser couldn't classify — never dropped)
    { "id", "kind": "other", "heading",
      "paragraphs": [ "…" ], "bullets": [ "…" ] }
  ]
}
```

Nothing from the document is ever silently discarded — unclassified content
lands in an `other` section and is surfaced (`warnings`) so its `kind` can be
reassigned on the review screen. Section order follows the source document.

### `style_map_json` (formatting captured from the actual file)

Real values read from the .docx run/style properties — never assumed. Sizes in
points; colours uppercase hex with a leading `#` (or `null` for inherit/auto).

```jsonc
{
  "version": 1,
  "defaults": { "fontFamily", "fontSizePt", "color" },
  "elements": {
    // each is a StyleEntry: { fontFamily, fontSizePt, bold, italic, color }
    "name": { … }, "sectionHeading": { … }, "jobTitle": { … },
    "body": { … }, "bullet": { … }
  }
}
```

### `extra_answers_json`

An **array** of `{ id, question, answer }` that accumulates over time (tailoring
clarifying answers are added automatically). Editable on the Profile page; saved
via `PATCH /profile`.

### Resume upload flow (two-step, no AI)

1. `POST /profile/resume/parse` (multipart field `resume`, `.docx` only, 5MB) —
   stores the file in object storage and returns
   `{ filename, resume_json, style_map_json, warnings }` for review. Does **not**
   touch the `profile` row.
2. `PUT /profile/resume` `{ filename, resume_json, style_map_json }` — commits
   the (possibly corrected) structure and makes that file the base resume,
   deleting the previous one. The .docx is kept only as a formatting reference
   (`GET /profile/resume` downloads it).

Parsing reads WordprocessingML directly (JSZip + fast-xml-parser), not mammoth,
because run-level font/size/colour is needed for the style map.

## AI content rules (mandatory)

Apply to every AI output: resumes, cover letters, application answers, website
copy, the role chat, and everything the interview coach says (prep pack, mock
interview, cue cards, debrief).

1. **Australian English spelling** in all AI-generated and UI text
   (organise, colour, optimise, specialise, centre).
2. **Never fabricate experience, qualifications, employers, dates, metrics or
   achievements.** Tailoring re-emphasises, re-orders and re-words Amy's real
   content; it never invents. If the data isn't there, surface the gap or ask —
   don't make up an answer.
3. Generated content stays traceable to stored source data:
   `profile.resume_json`, `profile.extra_answers_json`, `qa_log`, and the saved
   role chat (via `formatCoachingNotes`, which is guidance, not fact).

## Models and prompts

All model IDs and system prompts are in `artifacts/api-server/src/lib/prompts.ts`
(today as hard-coded constants; M2 moves each to an `AI_MODEL_*` env var with
these values as defaults):

| Constant | Model | Used for |
|---|---|---|
| `EXTRACT_MODEL` | `claude-sonnet-4-6` | Job extraction (URL/text/screenshots) + fit assessment (Amy chose this) |
| `TAILOR_MODEL` | `claude-opus-4-8` | Resume tailoring (adaptive thinking, effort high, streamed) |
| `DISCOVER_MODEL` | `claude-sonnet-4-6` | Discover result classification |
| `CHAT_MODEL` | `claude-opus-4-8` | Role-advice chat |
| `WEBSITE_MODEL` | `claude-opus-4-8` | Personal-website copy |
| `SKILL_GROUPING_MODEL` | `claude-sonnet-4-6` | Grouping skills for the .docx layout |

`opusJson` and `chatComplete` in `anthropic.ts` also default to
`claude-opus-4-8` when no model is passed. System prompts are sent with
`cache_control: ephemeral`. **All model JSON parsing retries once** on malformed
output (`parseJsonWithRetry`) before a clean 502 (`AiJsonError`).
`aiErrorResponse` maps errors: missing key / invalid key / billing → 503, rate
limit → 429, others → 502.

Prompts: `JOB_EXTRACTION_SYSTEM`, `JOB_IMAGE_EXTRACTION_SYSTEM`, `TAILOR_SYSTEM`
(senior-recruiter tailoring with anti-AI-writing rules, ATS/rejection-risk/bullet
checks and the JSON contract), `COVER_LETTER_SYSTEM`, `APP_QUESTIONS_SYSTEM`,
`CHAT_SYSTEM` (**do not change without asking**), `WEBSITE_DRAFT_SYSTEM`,
`WEBSITE_FIELD_SYSTEM`, `SKILL_GROUPING_SYSTEM`, `DISCOVER_CLASSIFY_SYSTEM`.

## Pages (frontend)

Navigation: **bottom tab bar on mobile, sidebar on desktop** — an explicit
product requirement; don't replace it with a hamburger menu.

- **Login** — PIN entry (currently exactly 4 digits).
- **Profile** — upload/replace the base resume; structured review screen
  (sections editable inline, `kind` reassignable, unclassified content flagged).
  **Everything is reorderable** with up/down arrows — sections, roles, education
  items and every bullet/skill/paragraph/detail line (`moveAt`, `MoveHeader`,
  arrows in `LineList`). Roles have a **"Sort by date (newest first)"** button
  (`sortExperienceByDate` in `ResumeReview.tsx`; "Present"/"Current" first,
  undated last). Also: detected style map, saved answers editor, Additional
  context, and **"Download all my data"**. Re-uploading warns before replacing.
- **Jobs** — tracked jobs with status badges and a **fit pill** (from the saved
  assessment). **Filter cards** show counts by status and fit group (Strong 8–10
  / Worth a look 6–7 / Weak 1–5 / Not scored); clicking filters (status + fit
  combine; "Clear filters" resets). **Status is editable inline** via a `Select`
  whose wrapper calls `stopPropagation` + `preventDefault` so it doesn't trigger
  the card's wouter `Link`.
- **Job Detail** — posting, fit assessment, tailoring, cover letters,
  application questions, role chat, document downloads, status. Mobile-only
  bottom action bar above the tab bar
  (`bottom-[calc(4rem+env(safe-area-inset-bottom))]`) for one-tap resume
  .docx/PDF and cover letter/note.
- **Discover** — web job search (see below).
- **Website** — builds Amy's personal professional website from the resume:
  editable config, AI drafting of headline/tagline/bio/about
  (`POST /website/draft`) and single fields (`POST /website/write`), live
  preview (`GET /website/preview?page=`) and a static-site zip
  (`GET /website/export`).

## Flows

### Add a job
- `POST /jobs/extract` `{ url }` or `{ posting_text }`. For a URL: fetch, clean
  with `@mozilla/readability` + `jsdom`; if the fetch returns a blocked/empty SPA
  shell, **render it in headless Chromium and re-run Readability**
  (`renderAndClean`). Sonnet extracts title/company/location/work_arrangement and
  the fit read. A blocked fetch returns `{ fetch_failed: true, message }` and the
  UI offers a paste box. Doesn't save — the UI shows an editable review, then
  `POST /jobs` saves with status `New`.
- **Screenshots** (`POST /jobs/extract-image`, multipart `images`, 1–8
  PNG/JPEG/GIF/WebP, ≤10MB each): held in memory only, sent to the extract model
  with `JOB_IMAGE_EXTRACTION_SYSTEM`, which transcribes the posting and returns
  the same fields in one pass. AddJobDialog tabs: From URL / Paste text /
  Screenshot.
- **Brief / no full JD yet** — a checkbox ("I don't have the full job
  description yet") swaps the tabs for a small form: title (required),
  company/location, what you know about the role, areas to highlight.
  `buildBriefPosting()` (client-side, no AI) composes a labelled `posting_text`
  telling the tailor it's a brief and to **ask rather than invent**. Saves via
  `POST /jobs` with `brief: true`, which **skips the auto fit-assessment**.
- On create, `POST /jobs` **auto-generates the fit assessment** when none was
  supplied and it isn't a brief (best-effort; never blocks creation).
  `POST /jobs/:id/assess` regenerates it. `GET /jobs` joins in each job's
  assessment and returns `fit_score` / `fit_note`.

### Resume tailoring (`tailor.ts` — never invents; asks instead)
1. `POST /jobs/:id/tailor` — posting + resume + extra answers + coaching notes →
   `{ proposed_resume, clarifying_questions[], recruiter_feedback }`; status
   `Tailoring`.
2. Clarifying questions are asked one at a time. `POST /jobs/:id/qa`
   `{ question, answer }` saves each answer to **both** `qa_log` and
   `profile.extra_answers_json`. **Questions are skippable** ("Skip", plus "Skip
   the rest and let AI use best judgement"); skipped ones go to finalize as
   `skipped[]`, are never re-asked, and are answered by best judgement from real
   data only (never invented figures/employers/dates). If anything was skipped
   the UI goes straight to review.
3. `POST /jobs/:id/tailor/finalize` `{ answers, skipped, current_resume }` —
   last pass (returns an empty `clarifying_questions`); recruiter review re-runs.
4. `POST /jobs/:id/tailor/revise` `{ proposed_resume, edit_request }` — a
   free-text edit; review re-runs.
5. `POST /jobs/:id/tailor/approve` `{ proposed_resume }` — saves a `resume`
   document; status `Ready`.

`proposed_resume` uses the `resume_json` schema so it can be diffed
(`ResumeDiff`).

### Documents: .docx / PDF
- **.docx** built on demand in `docBuild.ts` (`buildResumeDocx`,
  `buildCoverLetterDocx`): single column, real paragraphs + runs, **no tables,
  text boxes or images** (ATS-safe); fonts/sizes/colours/bold from the style map
  (`defaultStyleMap()` fallback). Skills may be grouped by `groupSkills`.
- **PDF** = the .docx converted by headless LibreOffice (`pdf.ts` `docxToPdf`),
  so the two match. `soffice` is resolved from `SOFFICE_PATH`, then
  `/usr/bin/soffice` / `/usr/bin/libreoffice`, then a glob of
  `/nix/store/*libreoffice*-wrapped/bin/soffice`. Each conversion uses a
  throwaway `-env:UserInstallation` profile. If `soffice` isn't found it falls
  back to **pdf-lib** rendering from the JSON (`buildResumePdfFallback` /
  `buildCoverLetterPdfFallback`) — functional, not a pixel match.
- `GET /documents/:id/download/:format` (`docx`|`pdf`, only `resume` and
  `cover_letter`): lazy-builds, caches in object storage, records the key, serves
  with a friendly name (`Amy-Gibbons-Resume-Acme-Corp.docx`, `docFilename`).
  `POST /documents/:id/regenerate` clears the cached keys so the next download
  rebuilds. `POST /jobs/:id/documents/generate` is a 501 stub (superseded).

### Cover letters + application questions
- **Cover letters** (`coverLetters.ts`, `COVER_LETTER_SYSTEM`): `full`
  (`{ salutation, re, body }` — no address/date/header; hook opener, no grovelling
  close) and `short` (3–5 sentence note); **plain** is `full.body`. Endpoints:
  `POST /jobs/:id/cover-letters` (may return clarifying questions — answered via
  `/jobs/:id/qa`), `.../finalize`, `.../revise` `{ current, edit_request }`,
  `.../approve` `{ full, short }` → three documents (`cover_letter`,
  `cover_letter_plain`, `cover_note`). Only `cover_letter` is downloadable; the
  other two are copy-only.
- **Application questions** (`appQuestions.ts`, `APP_QUESTIONS_SYSTEM`): answers
  drafted **only** from resume + extra answers (asks first if facts are missing).
  `POST /jobs/:id/questions` `{ questions }`, `.../finalize`
  `{ questions, answers }`, `.../save` `{ answers }` → `qa_log`. Copy buttons use
  `CopyButton` (clipboard with an `execCommand` fallback for mobile Safari).
- The resume given to the model is the **latest approved tailored resume** for
  the job if one exists, else the base resume (`loadGenContext` selects the
  newest `type='resume'` doc specifically, so other doc types never shadow it).

### Role-advice chat (the coach)
- `RoleChat` on Job Detail talks to the senior-recruiter coach (`CHAT_SYSTEM`)
  about one role, grounded in the posting (first 40,000 chars), the resume
  (tailored if approved) and extra answers (`buildChatSystem` in `generate.ts`).
- **The server owns the transcript.** The client posts only the new message +
  files as **multipart** (`message`, `files`) to `POST /jobs/:id/chat` and gets
  `{ reply, messages }` back. The last 20 turns are sent to the model.
  `chatComplete` today is a **non-streaming** `messages.create`, `max_tokens`
  2048, system prompt cached. `GET /jobs/:id/chat` loads the transcript;
  `DELETE /jobs/:id/chat` clears it ("New chat").
- Saved as one `chat` document per job (`chatStore.ts`
  `loadChat`/`saveChat`/`clearChat`).
- **Attachments** (`chatAttachments.ts`): images, PDF, `.docx`, `.txt`, `.md`,
  `.csv`; max 5 files, 15MB each. Images + PDFs are stored in object storage and
  re-sent every turn as `image`/`document` blocks (`buildTurnContent`);
  docx/txt/md/csv are extracted to text at upload and inlined. `publicTurn()`
  strips `objectKey`/extracted text before returning. `clearChat` deletes the
  attachment objects; a failed AI call deletes the just-uploaded ones.
- **Feeds generation:** `formatCoachingNotes()` renders the saved chat (incl.
  attachments) into a conservative "PRIOR COACHING CONVERSATION" block (guidance,
  not fact; never invent), threaded as `coachingNotes` into
  `runTailor`/`runCoverLetters`/`runAppQuestions`.

### Discover (web job search)
- **Parameters** (`discover_settings`, defaults `DEFAULT_DISCOVER_SETTINGS` in
  `discover.ts`): `roleTitles[]`, `officeRegion` (Gold Coast↔Brisbane),
  `remoteRule` (full-time remote from Australia), `exclusions[]`,
  `extraKeywords`, `sources[]` (pages to scan). `GET/PUT /discover/settings`;
  `normaliseSettings` validates on read and write.
- **Search** (`POST /discover/search`): `buildQueryPlan` builds capped lanes
  (cap 12): general/company + careers/ATS + recruiter-agency lanes (big boards
  and LinkedIn excluded); a recruiter "we're hiring" lane (LinkedIn allowed); a
  LinkedIn lane (`/jobs/view/…` and hiring posts); an **ATS lane**
  (`ATS_DOMAINS` — greenhouse/lever/ashby/workable/…); a **named-recruiter lane**
  (`RECRUITER_DOMAINS`). Plan de-dup keys on query **+ includeDomains**.
  `isSearchOrIndexPage` drops search/category pages, recruiter marketing pages,
  document files and LinkedIn profile pages (keeps `/jobs/view/` and `/posts/`).
  Tavily runs with `search_depth: advanced`.
- **Pages to scan:** each `sources[]` URL is rendered in headless Chromium
  (`pageRender.ts` — `CHROMIUM_PATH` or a `/nix/store/*chromium*` glob,
  `--headless=new --dump-dom --virtual-time-budget=9000`) and posting links are
  harvested (`pageScan.ts`, cap 25/source), in parallel with the web search.
  Defaults to `["https://blackroc.co/jobs"]`; an explicit empty array is
  respected. Slow cold (~15–40s/page); a failing source yields nothing.
- **Classification:** batches of 8 through `DISCOVER_MODEL` with
  `DISCOVER_CLASSIFY_SYSTEM` → per-result company/location/arrangement,
  `seniority_match`/`location_match` (`yes`/`no`/`unsure`), one-line reason.
  Deliberately lenient (default keep); `unsure` results are kept and flagged.
- **De-dupe** at three points: Tavily URL merge, pre-classification host+title,
  post-classification company+title. Response has `counts` (incl. `harvested`)
  and an indicative-coverage `note`.
- **Actions:** "Tailor for this role" seeds `AddJobDialog` (`JobSeed`) → extract
  → Job Detail; "Save" creates a `New` job; "Dismiss" → `POST /discover/dismiss`.

### Data export (backup)
`GET /profile/export` → `war-room-backup-<date>.zip` with `data.json` (every
table: `profile`, `jobs`, `documents`, `qa_log`, `discover_settings`,
`discover_dismissed`, camelCase rows) and `files/<objectKey>` for the base
resume and every cached docx/pdf. **Not included:** chat attachment objects and
the website config (`website/config.json`).

## Auth (current — M1 changes this)

- `POST /auth/login` `{ pin }` compares against `APP_PIN` with
  `timingSafeEqual`; no attempt limit.
- The session cookie `jsa_session` is `HMAC-SHA256(SESSION_SECRET, APP_PIN)` —
  the **same static value for every login**, httpOnly, `sameSite: lax`, `secure`
  in production, 30-day `maxAge`. It carries no issue time, so it never expires
  server-side, and logout only clears the cookie on that device. Changing
  `APP_PIN` or `SESSION_SECRET` invalidates every session.
- `requirePin` guards everything except `/api/healthz` and `/api/auth/*`.
- CORS is currently `origin: true, credentials: true` (reflects any origin). No
  security headers.

## PWA, mobile and resilience

- **Installable PWA:** `public/manifest.webmanifest` (standalone, navy theme,
  icons `icon-192/512.png`, `apple-touch-icon.png`), iOS meta +
  `viewport-fit=cover`. `public/sw.js` serves `public/offline.html` for offline
  navigations and deliberately **doesn't cache app JS/CSS** (avoids a stale SPA);
  registered in `main.tsx` via `${import.meta.env.BASE_URL}sw.js`. The icon
  generator script isn't in this repo. The SPA is served at web root (`/`).
- **Offline banner:** `components/OfflineBanner.tsx`.
- **AI loading states:** `components/ui/ai-progress.tsx` cycles plain statuses
  with a capped bar; wired into every long AI call. Pass a **module-scope
  (stable) `stages` array** so the timer isn't reset on render.
- **Errors:** `fetchApi`/`fetchMultipart` turn network failures into a readable,
  offline-aware `ApiError`; every AI flow has a Try again path.
- **Touch targets:** `Button` ≥44px on touch (`md:` shrinks on desktop); a
  `@media (pointer: coarse)` rule enforces 44px min-height on button-like
  controls. Long text uses `break-words`; the content wrapper is
  `overflow-x-hidden`.
- **Dark mode:** `.dark` tokens exist in `index.css`, but nothing applies the
  class yet — the app renders light only today.

## Smoke tests

Run from the repo root with `pnpm --filter @workspace/api-server exec tsx test/<file>`:
- `parseFixture.ts` — resume parser (no keys, no DB).
- `docTest.ts` — docx/pdf generation.
- `fetchTest.ts` — job page fetch + clean (network).
- `polishTest.ts` — JSON retry + export; **uses the DB**.
- `discoverTest.ts` — Discover tables + `normaliseSettings` + query building;
  **uses the DB**.

The DB tests must only ever run against `warroom-dev`.

## Gotchas

- **Express 5:** wildcard routes need `/{*splat}`; async handlers return
  `Promise<void>` and use `res.status(...).json(...)` then a bare `return;`.
- **Never `console.log` on the server** — use `req.log` in handlers, `logger`
  elsewhere.
- **Casing:** Drizzle rows are camelCase; the frontend expects snake_case.
  Every response that returns a row needs the serialiser — check sibling routes,
  not just the one being edited (a missed one once blanked the Jobs page with no
  server error).
- **Autoscale has ephemeral disk:** never write durable data to local disk in
  production (no SQLite, no local `uploads/`). Use Postgres + Object Storage.
  Never commit database snapshots (`*.db`, `*.sqlite`).
- **Two resume renderers:** the docx path (→ LibreOffice → PDF) and the pdf-lib
  fallback share no layout code; layout/pagination changes go in **both**. In
  `pdf.ts`, "keep together" is a `groupId` on `Block`.
- **Fonts under LibreOffice** resolve against what's installed (`fc-list`); the
  Replit container ships DejaVu only, so a requested "Calibri" is silently
  substituted. Force the exact installed family when overriding fonts.
- **First LibreOffice conversion is slow** (~30s+); use 60–90s timeouts in
  tests.
- **wouter:** use `<Switch>/<Route>` for any route that needs `useParams()`;
  hand-rolled `location.startsWith()` routing returns empty params.
- **sonner Toaster:** the shadcn `ui/sonner.tsx` calls `next-themes`'
  `useTheme()`; without a `ThemeProvider` it crashes silently. Make sure the
  mounted `<Toaster />` matches the `toast` import used by pages.
- **Long AI calls** need a progress state (20–60s is normal for Opus).
- `express.json` limit is 2mb (resume JSON + style map exceed the default).
- `artifacts/api-server/data/app.db`, `attached_assets/` and `exports/` are
  leftovers from the SQLite era and Replit uploads; nothing at runtime reads
  them (the Vite `@assets` alias points at `attached_assets/` but no code
  imports from it). Since M0 they're untracked and gitignored (still on disk).
