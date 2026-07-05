---
name: Autoscale deployments have ephemeral disk
description: Data written to local disk in an autoscale-deployed app is lost on every redeploy/restart — always use managed Postgres + Object Storage for anything that must persist.
---

Autoscale deployment targets run from the last git-committed snapshot of the filesystem on every container start/restart. Any writes made to local disk in production (SQLite DB files, uploaded files saved to a local `uploads/` dir, etc.) live only in that container's ephemeral disk and are silently wiped on the next redeploy or scale event — with no warning and no way to recover the data afterward.

**Why:** A user reported profile/job data disappearing after publishing. Root cause: the app used a local SQLite file that had been committed to git as the "seed" DB, and file uploads were saved to local disk. Every redeploy reset the filesystem to that git snapshot, discarding all writes made in the live production container. A confirmed production write (`PATCH /api/profile`) was permanently lost.

**How to apply:** Before deploying any app to autoscale (or any stateless/ephemeral target), check for local file writes — SQLite/file-based DBs, local upload directories, on-disk caches meant to persist. Migrate durable state to Replit-managed Postgres and file storage to Replit Object Storage. Never commit local DB files (e.g. `*.db`, `*.sqlite`) to git — add them to `.gitignore` instead, since a committed snapshot will keep resetting production data.
