---
name: ORM migration field casing mismatches
description: When migrating a hand-rolled DB layer to an ORM, raw ORM rows can silently break frontends expecting the old field casing/shape.
---

When migrating from a raw SQL / hand-rolled DB layer (e.g. SQLite with manual snake_case columns) to an ORM like Drizzle, the ORM's default camelCase JS field names differ from any snake_case API contract the frontend already relies on. Returning raw ORM rows directly from routes silently changes the response shape.

**Why:** This caused a real production incident — one route (`profile.ts`) got a serializer bridging camelCase→snake_case during the migration, but sibling routes (`jobs.ts`, `documents.ts`) were missed, causing the frontend to crash (blank screen) whenever it rendered jobs or documents. No server error was logged; the API returned 200/201 with wrong-shaped data, so backend logs looked clean and only the frontend broke.

**How to apply:** When migrating any route file to a new ORM/DB layer, grep the frontend's API client/types file for the exact field names it expects on that resource, and add an explicit serializer (snake_case bridge) for every response point returning a row from that resource — not just the first route file you touch. Audit sibling route files in the same migration, not just the one you're actively editing.
