# Job Search Assistant

Personal (single-user) job search "war room" — track job postings, tailor resumes and cover letters with AI, and generate application answers, all backed by a PIN-gated web app.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/job-search-assistant run dev` — run the web frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `APP_PIN` / `SESSION_SECRET` — PIN-gate auth, `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` / `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — Object Storage

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- File storage: Replit Object Storage (`@google-cloud/storage` via the Replit sidecar) — resumes and generated resume/cover-letter docx+pdf files
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — Drizzle table definitions: `profile` (single row, id=1), `jobs`, `documents` (resume/cover-letter content + object storage keys), `qaLog`, `discoverSettings`, `discoverDismissed`
- `artifacts/api-server/src/lib/db.ts` — re-exports the shared drizzle client + tables for API routes
- `artifacts/api-server/src/lib/objectStore.ts` — thin GCS helper (upload/download/exists/delete) for storing resumes and generated documents
- `artifacts/api-server/src/routes/` — `profile.ts` (profile + resume upload/confirm/export), `jobs.ts` (CRUD + AI tailoring), `generate.ts` (cover letters + application questions), `documents.ts` (docx/pdf generation & download), `discover.ts` (AI-assisted job search via Tavily)

## Architecture decisions

- All durable state lives in managed Postgres + Object Storage — nothing is written to local disk in production. This app deploys to `autoscale`, which resets local disk to the last git snapshot on every redeploy/restart.
- Documents (resumes, cover letters) store their generated docx/pdf as object storage keys (`docxObjectKey`/`pdfObjectKey`) and are rendered on first download, then cached; the object key is `null` until first generated.
- The `/api/profile/export` endpoint bundles a full Postgres table dump plus every referenced object storage file into a single downloadable zip, giving the user a self-serve backup.

## Product

- Add job postings (via URL fetch or pasted text) and track status through New → Tailoring → Ready → Applied.
- AI-assisted resume tailoring per job, with clarifying Q&A that's saved back to the user's profile for reuse.
- AI-generated cover letters (full + short note) and draft answers to application questions.
- Resume upload (.docx) is parsed into structured JSON + a style map, reviewed before being confirmed as the base resume.
- Discover: AI + Tavily-powered search for new matching roles based on saved criteria, with dismiss-to-hide.
- Full-data export as a zip (Postgres data + stored files) for backup.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- This app deploys to `autoscale` — never write durable data to local disk (no local SQLite files, no local `uploads/` dir). Use Postgres (`@workspace/db`) and Object Storage (`src/lib/objectStore.ts`) instead.
- Do not commit database snapshot files (e.g. `*.db`, `*.sqlite`) to git — a committed snapshot resets production data on every redeploy. `artifacts/api-server/data/` and `artifacts/api-server/uploads/` are gitignored for this reason.
- After changing `lib/db/src/schema/*`, run `pnpm --filter @workspace/db run push` to apply the change to Postgres.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
