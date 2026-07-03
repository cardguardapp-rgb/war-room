---
name: E2E testing behind a PIN/secret gate
description: Automated UI test tools cannot read environment secrets, so apps gated by a secret (PIN, password) need a temporary dev-only bypass to be E2E testable — and it must be removed before finishing.
---

Automated browser-based test tools (e.g. runTest) run without access to the app's real secret env vars (e.g. `APP_PIN`), so they cannot log in to apps that gate all functionality behind a secret credential. To make such an app E2E-testable, add a temporary, clearly-labeled bypass: a fixed non-secret value (e.g. a hardcoded test PIN like "0000") that is only accepted when `NODE_ENV !== "production"`.

**Why:** without this, there is no way to exercise authenticated pages/flows in an automated test, and skipping E2E testing of the main app risks shipping bugs (in one real case, a routing bug that broke a detail page was only caught once the bypass allowed the test to log in and click through).

**How to apply:**
- Mark the bypass clearly in code (comment like "TEMP-E2E-TEST-BYPASS: remove before finishing this task").
- Gate it strictly on `process.env.NODE_ENV !== "production"` so it can never activate in production.
- Use it to unblock full E2E test runs during development.
- Always remove the bypass entirely before considering the task done — re-verify afterward with curl/API checks that the old bypass value now correctly fails (401) and only the real secret works.
