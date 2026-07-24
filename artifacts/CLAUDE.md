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
- `ANTHROPIC_API_KEY` — **required for AI features** (job extraction + resume
  tailoring). If unset, those endpoints return `503` with a clear message; the
  rest of the app works. Add it in Replit Secrets and restart the workflow.
- `TAVILY_API_KEY` — **required for Discover search** (the web search behind the
  Discover page). If unset, `POST /discover/search` returns `503`; the rest of
  Discover (editing/saving parameters) still works. Discover search also needs
  `ANTHROPIC_API_KEY` for the classification step. Add both in Replit Secrets.

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
      resumeParser.ts        # pure .docx -> { resumeJson, styleMap, warnings } (JSZip + fast-xml-parser)
      anthropic.ts           # Anthropic client; JSON parse + retry-once (parseJsonWithRetry/opusJson/createJson); error->HTTP mapping
      prompts.ts             # model IDs + system prompts (JOB_EXTRACTION_SYSTEM, TAILOR_SYSTEM)
      jobExtract.ts          # URL fetch + @mozilla/readability + Sonnet 4.6 metadata extraction
      tailor.ts              # resume tailoring calls (Opus 4.8, streaming, initial/finalize/revise)
      coverLetters.ts        # cover-letter generation (Opus 4.8) — full + plain + short
      appQuestions.ts        # application-question answering (Opus 4.8) — resume-grounded only
      docBuild.ts            # resume + cover-letter .docx builders (docx pkg) from JSON + style map
      pdf.ts                 # docx->pdf via LibreOffice (nix store) + pdf-lib fallback renderer
      tavily.ts              # Tavily web-search client (Discover) — single + multi-query, URL de-dupe
      discover.ts            # Discover: settings defaults, query building, AI classification, de-dupe
    middlewares/
      pinAuth.ts             # PIN verification, session cookie issue/check, requirePin guard
    routes/
      index.ts               # mounts health (public), auth (public), then requirePin, then the rest
      health.ts               # GET /healthz
      auth.ts                 # POST /auth/login, GET /auth/status, POST /auth/logout
      profile.ts               # profile GET/PATCH; resume parse/confirm/download (multer, .docx only, 5MB)
      jobs.ts                   # job CRUD; POST /jobs/extract; tailoring endpoints (tailor/qa/finalize/revise/approve)
      documents.ts               # documents list + GET /documents/:id/download/:format (docx|pdf, lazy-built)
      generate.ts                 # /jobs/:id/cover-letters(+finalize/revise/approve); /jobs/:id/questions(+finalize/save)
      discover.ts                 # Discover: GET/PUT /discover/settings, POST /discover/search, POST /discover/dismiss
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
  `company`, `source_url`, `posting_text`, `status`, `created_at`.
  `status` is a plain **text** column (default `'New'`, no enum/check
  constraint), so adding a status needs **no migration** — just extend
  `VALID_STATUSES` in `routes/jobs.ts` and the `JobStatus` union +
  `statusColors`/`statusDot`/`STATUS_ORDER` in the frontend. Pipeline order:
  `New` → `Tailoring` → `Ready` → `Applied` → `Interview` → `Offer` →
  `Rejected` → `Not Applying`.
- **`documents`** — generated artefacts tied to a job (`job_id`, cascade
  delete). `type` is free text; current values: `resume`, `cover_letter`,
  `cover_letter_plain`, `cover_note`, `assessment` (the fit score/summary/flags,
  one per job — see below), and `chat` (the saved role-advice transcript,
  `content_json = { messages }`, one per job). Holds `content_json` plus paths
  to generated `.docx`/`.pdf` files under `uploads/`. New "types" piggyback on
  this table (free-text `type` + jsonb `content_json`) to avoid schema
  migrations. `GET /jobs` joins in each job's `assessment` and returns
  `fit_score`/`fit_note` on the list rows so the Jobs page can show a fit pill.
- **`qa_log`** — a history of application-question/answer pairs tied to a
  job, for reuse and consistency across applications.
- **`discover_settings`** — single row, `id = 1`. Holds the user's editable
  Discover search parameters as JSON (`settings_json`). Absent → the built-in
  defaults are used.
- **`discover_dismissed`** — one row per dismissed listing URL (`url` primary
  key). Dismissed URLs are filtered out of every future search.

Foreign keys are enforced (`PRAGMA foreign_keys = ON`); deleting a job
cascades to its documents and QA log entries.

## Resume data model

The `profile` row stores three JSON blobs as text. The API layer parses them
on the way out (`GET /profile` returns real objects, not strings) and
`JSON.stringify`s on the way in. The canonical shapes are defined and exported
in `artifacts/api-server/src/lib/resumeParser.ts` and mirrored on the frontend
in `artifacts/job-search-assistant/src/lib/api.ts` — keep those two in sync.

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

Rules: nothing from the document is ever silently discarded — unclassified
content lands in an `other` section and is surfaced to the user (see
`warnings`) so they can reassign its `kind` on the review screen. Section
order is preserved from the source document.

### `style_map_json` (formatting captured from the actual file)

Real values are read from the .docx run/style properties — never assumed.
Sizes are points; colours are uppercase hex with a leading `#` (or `null` for
inherit/auto).

```jsonc
{
  "version": 1,
  "defaults": { "fontFamily", "fontSizePt", "color" },
  "elements": {
    // each is a StyleEntry: { fontFamily, fontSizePt, bold, italic, color }
    "name":           { … },   // the name heading at the top
    "sectionHeading": { … },   // section headings
    "jobTitle":       { … },   // role/company header lines
    "body":           { … },   // body paragraphs
    "bullet":         { … }    // bullet points
  }
}
```

### `extra_answers_json`

An **array** of `{ id, question, answer }` — Q/A pairs that accumulate over
time (later phases add to it when the AI asks clarifying questions). Editable
and deletable on the Profile page. Saved via `PATCH /profile`.

### Resume upload flow (two-step, no AI)

1. `POST /profile/resume/parse` (multipart, field `resume`, `.docx` only,
   5MB cap) — saves the original file and returns
   `{ filename, resume_json, style_map_json, warnings }` for review. **Does
   not** touch the `profile` row.
2. `PUT /profile/resume` `{ filename, resume_json, style_map_json }` — commits
   the (possibly user-corrected) structure and marks that file as the base
   resume, deleting any previous resume file. The parsed structure is now the
   source of truth; the `.docx` is kept only as a formatting reference
   (`GET /profile/resume` downloads it).

Parsing is pure — no AI calls. `resumeParser.ts` parses the raw
WordprocessingML directly (JSZip + fast-xml-parser) rather than via mammoth,
because run-level font/size/colour is needed for the style map. Dev smoke
test: `pnpm --filter @workspace/api-server exec tsx test/parseFixture.ts`.

## Pages (frontend)

- **Profile** — upload/replace the base resume (`.docx` only, 5MB). On upload
  it parses into a structured review screen (sections editable inline, each
  section's `kind` reassignable, unclassified content flagged); confirming
  saves it as the source of truth. **Everything is reorderable** via up/down
  arrows — sections, roles, education items, and every bullet/skill/summary
  paragraph/detail line (`moveAt` helper + a `MoveHeader` on each role/education
  card; arrows in `LineList`). Roles also have a **"Sort by date (newest first)"**
  button that parses each role's free-text `dates` (`sortExperienceByDate` in
  `ResumeReview.tsx`; "Present"/"Current" sorts to the top, undated roles sink). Also shows the detected formatting (style
  map) and a saved-answers (Q/A) editor. Re-uploading warns before replacing
  the parsed structure. UI lives in `src/pages/profile.tsx` +
  `src/components/profile/*`.
- **Jobs** — list of tracked jobs with status badges (New / Tailoring /
  Ready / Applied / Not Applying) and a **fit pill** (from the saved
  assessment). Add a job by pasting a URL or the raw posting text. On create,
  `POST /jobs` **auto-generates the fit assessment** from the posting when one
  wasn't supplied (e.g. saved from Discover), so the score shows in the list
  immediately (best-effort — never blocks creation). **Filter cards** at the top
  show counts by status and by fit group (Strong 8–10 / Worth a look 6–7 / Weak
  1–5 / Not scored); clicking a card filters the list (status + fit combine;
  "Clear filters" resets). `GET /jobs` returns `fit_score`/`fit_note` per row.
  **Status is editable inline** on each card via a `Select` (updates through
  `PATCH /jobs/:id`); its wrapper calls `stopPropagation` + `preventDefault` so
  the click neither triggers the card's wouter `Link` nav nor a native anchor
  page load.
- **Job Detail** — full posting text, tailored resume and cover letter(s)
  once generated, document downloads, status control.
- **Discover** — web job search filtered to the user's parameters. A "Search
  now" button plus an editable parameters panel (role levels, office-region
  rule, remote rule, exclusions, extra keywords). Each result is a mobile-first
  card: title, company, location/arrangement + seniority/location-match badges,
  a one-line reason, "Open listing" (new tab), "Tailor for this role" (seeds the
  Add-a-job dialog → posting fetch with paste fallback → Job Detail), "Save"
  (adds to Jobs as `New`), and "Dismiss" (URL never shown again). A standing note
  says results are indicative. UI: `src/pages/discover.tsx` +
  `src/components/discover/{SettingsEditor,ResultCard}.tsx`.

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

## Adding a job + resume tailoring (AI)

**Models:** job extraction uses `claude-sonnet-4-6`; resume tailoring uses
`claude-opus-4-8` (adaptive thinking, streaming). Both via `@anthropic-ai/sdk`.
The client + JSON-response parsing + error→HTTP mapping live in
`src/lib/anthropic.ts`. **The system prompts (including the full senior-recruiter
tailoring prompt with the anti-AI-writing rules, ATS/rejection-risk/bullet
checks, and the JSON contract) live in `src/lib/prompts.ts`** — `TAILOR_SYSTEM`.

### Add a job (`jobs` table gained `location` + `work_arrangement` columns)
- `POST /jobs/extract` `{ url }` or `{ posting_text }`. For a URL: fetches the
  page, extracts the main content with `@mozilla/readability` + `jsdom` (that
  cleaned text becomes `posting_text`), then Sonnet 4.6 classifies
  title/company/location/work_arrangement (`jobExtract.ts`). If the fetch is
  blocked/junk (LinkedIn etc.) it returns `{ fetch_failed: true, message }` and
  the UI offers a paste box. It does **not** save — the UI shows an editable
  review, then `POST /jobs` saves with status `New`.
- **Add from screenshot(s)** (`POST /jobs/extract-image`, multipart field
  `images`, 1–8 PNG/JPEG/GIF/WebP, ≤10MB each): for postings you can't copy
  (LinkedIn especially), the user attaches screenshot(s). Held in memory (multer
  `memoryStorage`, never written to disk), base64'd to the **multimodal extract
  model** (`claude-sonnet-4-6`) with `JOB_IMAGE_EXTRACTION_SYSTEM`, which
  transcribes the posting into `posting_text` AND returns the same
  title/company/location/summary/flags/fit fields in one pass
  (`extractFromImages` in `jobExtract.ts`, `createJsonFromImages` in
  `anthropic.ts`). Flows into the same review screen. The AddJobDialog has three
  input tabs: From URL / Paste text / **Screenshot**.
- **Brief / no full JD yet** — a checkbox at the top of AddJobDialog ("I don't
  have the full job description yet"), for when a recruiter has shared only
  high-level info but wants an up-to-date resume. Checking it swaps the tabs for
  a small form: title (required), company/location (optional), *what you know
  about the role*, and *areas to highlight*. On continue, `buildBriefPosting()`
  (client-side, no AI) composes those into a labelled `posting_text` — a leading
  note tells the tailor it's a brief, to re-emphasise real experience toward the
  highlighted areas, and to **ask rather than invent** where thin. It flows into
  the same review screen and saves via `POST /jobs` with `brief: true`, which
  **skips the auto fit-assessment** (a fit score off a thin brief would mislead).
  Everything downstream (tailoring, cover letters) is unchanged — it just reads
  the composed `posting_text`.

### Tailoring flow (`tailor.ts` — never invents; asks instead)
1. `POST /jobs/:id/tailor` — initial pass. Sends posting + `resume_json` +
   `extra_answers_json` to Opus 4.8. Returns `{ proposed_resume,
   clarifying_questions[], recruiter_feedback }` and sets status `Tailoring`.
2. If there are clarifying questions, the UI asks them one at a time.
   `POST /jobs/:id/qa` `{ question, answer }` saves each answer to **both**
   `qa_log` and `profile.extra_answers_json` (so future sessions know it).
   **Questions are skippable** — each has a "Skip" button plus a "Skip the rest
   and let AI use best judgement" link. Skipped questions are collected and sent
   to finalize as `skipped[]`; the model is told not to re-ask them and to use
   best judgement from the resume/extra answers/coaching notes (still never
   inventing figures/employers/dates). When anything was skipped, the UI routes
   straight to review rather than looping back into questions.
3. `POST /jobs/:id/tailor/finalize` `{ answers, skipped, current_resume }` —
   second pass incorporating the answers (and best-judgement for `skipped`);
   returns an empty `clarifying_questions` array (last pass) and the recruiter
   review runs again.
4. `POST /jobs/:id/tailor/revise` `{ proposed_resume, edit_request }` — apply a
   free-text edit ("make the second MYOB bullet shorter"); review runs again.
5. `POST /jobs/:id/tailor/approve` `{ proposed_resume }` — saves a `documents`
   row (`type: 'resume'`, `content_json`) and sets status `Ready`.

`proposed_resume` uses the **same `resume_json` schema** as the parsed resume
(so it can be diffed against the original). Frontend: `src/pages/jobs.tsx` +
`src/pages/job-detail.tsx` + `src/components/jobs/*` (AddJobDialog, TailorFlow,
ResumeDiff).

## Documents: .docx / PDF generation

- **.docx** is built from JSON on demand in `src/lib/docBuild.ts` (the `docx`
  package): `buildResumeDocx(resume_json, style_map)` and
  `buildCoverLetterDocx(full, name, style_map)`. Single column, real paragraphs
  + text runs, **no tables/text boxes/images** (ATS-safe). Fonts, sizes,
  colours and bold come from the Phase 2 `style_map_json` so it matches the
  original resume. `defaultStyleMap()` is the fallback (Calibri / navy).
- **PDF** = the .docx converted by **headless LibreOffice** (`src/lib/pdf.ts`
  `docxToPdf`), guaranteeing the two files match. `soffice` is resolved at
  runtime — `SOFFICE_PATH` env, then `/usr/bin`, then a glob of
  `/nix/store/*libreoffice*-wrapped/bin/soffice` (LibreOffice ships in the nix
  store here; there is **no `replit.nix`** — the project uses Replit "modules").
  Each conversion uses a throwaway `-env:UserInstallation` profile dir. If
  `soffice` can't be found it falls back to `pdf-lib` rendering from the JSON
  (`buildResumePdfFallback` / `buildCoverLetterPdfFallback`) — functional but
  not a pixel match.
- Download: `GET /documents/:id/download/:format` (`docx`|`pdf`) — only `resume`
  and `cover_letter` documents. Lazy-builds, caches the file under `uploads/`,
  records `docx_path`/`pdf_path`, and serves it with a nice filename
  (`Amy-Gibbons-Resume-Acme-Corp.docx` via `docFilename`).

## Cover letters (three types) + application questions

**Cover letters** (`coverLetters.ts`, `COVER_LETTER_SYSTEM` in `prompts.ts`,
Opus 4.8). One flow → three outputs: `full` (`{ salutation, re, body }` — no
address/date/header; hook opener, no grovelling close), `short` (3–5 sentence
note); the **plain** version is just `full.body`. Writing rules (human, AU
English, banned buzzwords, self-check "would a recruiter suspect AI?") are in
the system prompt. Endpoints (job-scoped, in `generate.ts`):
`POST /jobs/:id/cover-letters` (initial, may return clarifying questions —
reuse `/jobs/:id/qa` to answer), `.../finalize`, `.../revise`
`{ current, edit_request }`, `.../approve` `{ full, short }` → saves **three**
`documents` rows: `cover_letter` (`{salutation,re,body}`), `cover_letter_plain`
(`{text}`), `cover_note` (`{text}`). Only `cover_letter` is downloadable; plain
and note are copy-only (rendered with a copy button from `content_json.text`).

**Application questions** (`appQuestions.ts`, `APP_QUESTIONS_SYSTEM`, Opus 4.8).
Paste questions → answers drafted **only** from resume + extra answers (asks
clarifying questions first if it lacks facts; never guesses).
`POST /jobs/:id/questions` `{ questions }`, `.../questions/finalize`
`{ questions, answers }`, `.../questions/save` `{ answers }` → `qa_log`. Each
drafted answer has a copy button. Frontend: `CoverLetterFlow`, `AppQuestions`,
`CopyButton` (clipboard with a legacy `execCommand` fallback for mobile Safari).

For cover letters / questions the resume passed to the model is the **latest
approved tailored resume** for that job if one exists, else the base
`resume_json`.

## Role-advice chat: attachments

The chat accepts **file uploads** (interview invite, position description,
assessment brief, screenshot…): images, PDF, `.docx`, `.txt`, `.md`, `.csv` —
max 5 files, 15MB each (`lib/chatAttachments.ts`).

**The server owns the transcript.** The client `POST`s only the new question +
files as **multipart** (`message` + `files`) and gets the full transcript back;
it does NOT send the history. That's what makes attachments persist: a
follow-up turn re-sends the stored file, so the model still "sees" it.

- **Images + PDFs** → stored in object storage (`objectKey`), re-fetched and
  re-sent every turn as `image`/`document` content blocks (`buildTurnContent`).
- **`.docx`/`.txt`/`.md`/`.csv`** → extracted to plain text at upload and inlined
  (`docxToText` unzips `word/document.xml` and strips markup — we only need the
  words here, unlike `resumeParser` which also captures run/style detail).
- `ChatTurn` gained `attachments: ChatAttachment[]`; `chatComplete`'s
  `ChatMessage.content` is now `string | unknown[]` (content blocks).
- `publicTurn()` strips `objectKey`/extracted `text` before returning to the
  client. `clearChat` also deletes the attachment objects. A failed AI call
  deletes the just-uploaded objects so they aren't orphaned.
- Attached files also flow into `formatCoachingNotes`, so an uploaded PD informs
  future resume tailoring / cover letters for that role.

## Role-advice chat (persisted + feeds generation)

`RoleChat` (Job Detail) talks to the senior-recruiter persona about one role.
`POST /jobs/:id/chat` `{ messages }` → `{ reply }` (Opus 4.8, `chatComplete`,
`CHAT_SYSTEM`, grounded in posting + resume + extra answers). The transcript is
**persisted server-side** after each reply as a `documents` row (`type: 'chat'`,
`content_json = { messages }`, one per job) via `src/lib/chatStore.ts`
(`loadChat`/`saveChat`/`clearChat`). `GET /jobs/:id/chat` returns the saved
messages (RoleChat seeds from it on mount); `DELETE /jobs/:id/chat` clears it
("New chat"). The saved chat is folded into **future generation for that role**:
`formatCoachingNotes()` renders it into a conservative "PRIOR COACHING
CONVERSATION" grounding block (guidance, not fact; never invent), threaded as an
optional `coachingNotes` field into `runTailor`/`runCoverLetters`/
`runAppQuestions` (from `loadTailorContext` in jobs.ts and `loadGenContext` in
generate.ts). `loadGenContext` selects the newest `type='resume'` doc
specifically, so the `chat`/`assessment`/cover docs never shadow the tailored
resume.

## Discover (web job search)

Finds roles across company career sites + job boards, filtered to the user's
parameters, with one-tap handoff into the tailoring pipeline.

- **Parameters** (`discover_settings`, defaults in `discover.ts`
  `DEFAULT_DISCOVER_SETTINGS`): `roleTitles[]` (Head of Product + equivalents),
  `officeRegion` (Gold Coast↔Brisbane), `remoteRule` (full-time remote from
  Australia), `exclusions[]` (junior/mid PM, <6-month contracts, relocation),
  `extraKeywords`. `GET/PUT /discover/settings`. `normaliseSettings` validates
  and fills defaults on both read and write.
- **Search** (`POST /discover/search`): `buildQueryPlan` builds up to 10 lanes
  (capped): general/company + careers/ATS + recruiter-agency lanes (big job
  boards **and** LinkedIn excluded, so company/recruiter sites surface); a
  **recruiter "we're hiring" shout-out lane** (boards excluded but **LinkedIn
  allowed**); a **LinkedIn lane** (`includeDomains` LinkedIn) that catches
  real postings (`/jobs/view/…`) and member hiring posts; an **ATS lane**
  (`includeDomains` `ATS_DOMAINS` — greenhouse/lever/ashby/workable/
  smartrecruiters/workday/bamboohr/recruitee/livehire/employmenthero/…) that
  hits company career pages directly — companies host careers on ATS, so this is
  the "look at Salesforce/Amazon/… careers" lane done via the platforms they
  post on (live-tested ~20/20 direct postings); and a **named-recruiter lane**
  (`includeDomains` `RECRUITER_DOMAINS` — Six Degrees Executive, Hays, Michael
  Page, Hudson, Robert Walters, Robert Half, Talent Int'l, u&u, …). The two
  include-lanes share query text but differ by domain, so plan de-dup keys on
  query **+ includeDomains** (not text alone); lane cap is 12.
  `isSearchOrIndexPage` drops search/category pages, recruiter
  salary-guide/expertise/blog marketing pages, document files (.pdf/.docx/…),
  and LinkedIn `/in`·`/company`·`/school` profile pages, but keeps `/jobs/view/`
  and `/posts/`. The classifier is deliberately
  lenient (default KEEP): it only discards clear non-postings/blogs/events and
  CLEAR seniority/location breaches — ambiguous-location AU roles, recruiter
  postings with no named employer, and LinkedIn hiring posts are kept as
  `unsure`. Domain lists live in `discover.ts` (`JOB_BOARDS`, `SOCIAL`,
  `LINKEDIN`, `GENERAL_EXCLUDE`, `HIRING_EXCLUDE`). `tavily.ts` runs them via the
  **Tavily API**
  (`search_depth: advanced`), merging + de-duping by URL. Dismissed URLs are
  dropped, results de-duped by host+title, then classified in batches of 8 by
  **`claude-sonnet-4-6`** (`DISCOVER_CLASSIFY_SYSTEM` in `prompts.ts`) which
  returns per-result `company`/`location`/`work_arrangement`, `seniority_match`
  and `location_match` (`yes`/`no`/`unsure`), and a one-line reason. Clear
  non-matches are discarded; **`unsure` results are kept and flagged**, never
  hidden. A final company+title de-dupe runs across batches. Response includes a
  `counts` object and an indicative-coverage `note`.
- **Actions** (frontend): "Tailor for this role" seeds `AddJobDialog`
  (`JobSeed`) which auto-runs the Phase-3 extraction (paste fallback on a blocked
  fetch) then navigates to the Job Detail tailoring flow. "Save" fetches the
  posting (falling back to metadata only) and creates a `New` job. "Dismiss"
  calls `POST /discover/dismiss` and hides the URL forever.
- **De-dupe** happens at three points: Tavily URL merge, pre-classification
  host+title, post-classification company+title.

Non-AI smoke test (tables + `normaliseSettings` + `buildQueries`, no keys):
`pnpm --filter @workspace/api-server exec tsx test/discoverTest.ts`.

## PWA, mobile & resilience (polish)

- **Installable PWA**: `public/manifest.webmanifest` (standalone, navy theme,
  briefcase icons `icon-192/512.png` + `apple-touch-icon.png`), iOS/standalone
  meta + `viewport-fit=cover` in `index.html`. A minimal service worker
  (`public/sw.js`) makes it installable and serves `public/offline.html` for
  navigations when offline — it deliberately does **not** cache app JS/CSS (avoids
  a stale SPA). Registered in `main.tsx` via `${import.meta.env.BASE_URL}sw.js`.
  Icons are produced by a dependency-free Node script kept in the local mirror
  (`scripts-scratch/gen-icons.mjs`, run with `node gen-icons.mjs <publicDir>`) —
  re-run it to regenerate. **The SPA is served at web root (`base = /`), so all
  PWA files live at `/…`.** (`BASE_PATH` is a required build env var; the real
  value is `/`. It also names the API prefix used by the frontend fetch layer.)
- **Offline banner**: `components/OfflineBanner.tsx` (mounted in `App.tsx`) shows
  a slim banner whenever `navigator.onLine` is false.
- **AI loading states**: `components/ui/ai-progress.tsx` cycles plain-English
  statuses ("Reading the posting…", "Comparing against your resume…") with a
  capped progress bar. Wired into every long AI call (TailorFlow, CoverLetterFlow,
  AppQuestions, Discover search) so a 20–60s call never shows a dead screen. Pass
  a **module-scope (stable) `stages` array** so the timer isn't reset each render.
- **Error handling**: frontend `fetchApi`/`fetchMultipart` convert network
  failures into a readable, offline-aware `ApiError`; every AI flow has a
  Try-again path. Backend: **all model JSON parsing retries once** on malformed
  output before surfacing a clean `502` — `parseJsonWithRetry` + `opusJson` /
  `createJson` in `anthropic.ts` (tailoring, cover letters, app questions, job
  extraction, Discover classification). `AiJsonError` → 502 in `aiErrorResponse`.
- **Mobile @390px**: `Button` tap targets are ≥44px on touch (`md:` shrinks them
  on desktop); a `@media (pointer: coarse)` rule in `index.css` enforces a 44px
  min-height on all button-like controls (min-height beats a smaller explicit
  height). Long text uses `break-words`; the content wrapper is
  `overflow-x-hidden`. **Job Detail has a mobile-only bottom action bar** fixed
  above the tab bar (`bottom-[calc(4rem+env(safe-area-inset-bottom))]`) giving
  one-tap résumé .docx/PDF + cover-letter/note actions.
- **Data export**: `GET /profile/export` streams `war-room-backup-<date>.zip` —
  a consistent `db.backup()` SQLite snapshot, a readable `data.json` dump of every
  table, and every file under `uploads/`. Profile page → "Download all my data"
  (same-origin authenticated link, `api.profile.getExportUrl()`).

Non-AI smoke test (JSON retry + export zip):
`pnpm --filter @workspace/api-server exec tsx test/polishTest.ts`.

## Current status

**Done:** Profile pipeline; Add-a-job; resume tailoring; **resume + cover-letter
.docx/PDF generation**; **three cover-letter types**; **application-question
helper**; **Discover web job search** (Tavily + AI screening, save/tailor/dismiss);
**PWA + mobile polish** (installable, offline page, 44px targets, AI progress,
JSON-retry, data export). `documents.docx_path`/`pdf_path` hold cached generated
files.

**Still stubbed:** `POST /jobs/:id/documents/generate` returns `501` (superseded
by the tailoring/cover-letter approve flows). Discover search needs both
`TAVILY_API_KEY` and `ANTHROPIC_API_KEY` set to return live results (otherwise
`503`).

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
