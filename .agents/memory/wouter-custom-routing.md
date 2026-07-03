---
name: Wouter custom routing pitfalls
description: Manual location-string routing (location.startsWith(...)) instead of wouter's Switch/Route breaks useParams() in child pages.
---

If a page/component calls wouter's `useParams()` to read a dynamic segment (e.g. `/jobs/:id`), it only works when that component is rendered inside a matching `<Route path="/jobs/:id">`. A parent router that manually inspects `location` (e.g. `location.startsWith("/jobs/")`) and renders the detail component directly, without a `<Route>` wrapper, will make `useParams()` return `{}` — so the id comes back `undefined`, silently breaking detail pages (e.g. showing "not found" for a real, existing record) even though the API call itself is correct.

**Why:** discovered when a job detail page always showed "Job not found" despite the backend returning 200 for the exact id in the URL — root cause was a hand-rolled router using string matching instead of wouter's `<Switch>/<Route>`.

**How to apply:** when building routing with wouter (or similar libs), always use the library's own `<Switch>/<Route>` components for any route that needs param extraction. Don't hand-roll `location.startsWith()` matching for parameterized routes.
