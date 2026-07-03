import { Router, type IRouter } from "express";
import { db, type JobRow } from "../lib/db";

const router: IRouter = Router();

const VALID_STATUSES = ["New", "Tailoring", "Ready", "Applied"] as const;

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

router.get("/jobs", (_req, res): void => {
  const jobs = db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
    .all() as JobRow[];
  res.json(jobs);
});

router.post("/jobs", (req, res): void => {
  const { title, company, source_url, posting_text } = req.body ?? {};

  if (typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "Job title is required" });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO jobs (title, company, source_url, posting_text, status)
       VALUES (?, ?, ?, ?, 'New')`,
    )
    .run(
      title,
      company ?? null,
      source_url ?? null,
      posting_text ?? null,
    );

  const job = db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .get(result.lastInsertRowid) as JobRow;

  res.status(201).json(job);
});

router.get("/jobs/:id", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | JobRow
    | undefined;

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(job);
});

router.patch("/jobs/:id", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const { title, company, source_url, posting_text, status } =
    req.body ?? {};

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: "Invalid status value" });
    return;
  }

  const existing = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  db.prepare(
    `UPDATE jobs
     SET title = COALESCE(?, title),
         company = COALESCE(?, company),
         source_url = COALESCE(?, source_url),
         posting_text = COALESCE(?, posting_text),
         status = COALESCE(?, status)
     WHERE id = ?`,
  ).run(
    title ?? null,
    company ?? null,
    source_url ?? null,
    posting_text ?? null,
    status ?? null,
    id,
  );

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow;
  res.json(job);
});

router.delete("/jobs/:id", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const result = db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/jobs/:id/tailor", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | JobRow
    | undefined;

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.status(501).json({
    status: "not_implemented",
    message: "Tailoring is not implemented yet",
  });
});

export default router;
