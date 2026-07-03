import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, type JobRow, type ProfileRow } from "../lib/db";
import { aiErrorResponse } from "../lib/anthropic";
import { extractFromText, extractFromUrl } from "../lib/jobExtract";
import { runTailor, type QaPair } from "../lib/tailor";
import type { ResumeJson } from "../lib/resumeParser";

const router: IRouter = Router();

const VALID_STATUSES = ["New", "Tailoring", "Ready", "Applied"] as const;
const WORK_ARRANGEMENTS = ["office", "hybrid", "remote", "unknown"];

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

function getJob(id: number): JobRow | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
    | JobRow
    | undefined;
}

function getProfileRow(): ProfileRow | undefined {
  return db.prepare("SELECT * FROM profile WHERE id = 1").get() as
    | ProfileRow
    | undefined;
}

function parseJson<T>(value: string | null): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// --- CRUD ---------------------------------------------------------------

router.get("/jobs", (_req, res): void => {
  const jobs = db
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC, id DESC")
    .all() as JobRow[];
  res.json(jobs);
});

router.post("/jobs", (req, res): void => {
  const { title, company, location, work_arrangement, source_url, posting_text } =
    req.body ?? {};

  if (typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "Job title is required" });
    return;
  }
  const wa =
    typeof work_arrangement === "string" &&
    WORK_ARRANGEMENTS.includes(work_arrangement)
      ? work_arrangement
      : null;

  const result = db
    .prepare(
      `INSERT INTO jobs (title, company, location, work_arrangement, source_url, posting_text, status)
       VALUES (?, ?, ?, ?, ?, ?, 'New')`,
    )
    .run(
      title.trim(),
      company ?? null,
      location ?? null,
      wa,
      source_url ?? null,
      posting_text ?? null,
    );

  res.status(201).json(getJob(Number(result.lastInsertRowid)));
});

router.get("/jobs/:id", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const job = getJob(id);
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

  const { title, company, location, work_arrangement, source_url, posting_text, status } =
    req.body ?? {};

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: "Invalid status value" });
    return;
  }
  if (
    work_arrangement !== undefined &&
    work_arrangement !== null &&
    !WORK_ARRANGEMENTS.includes(work_arrangement)
  ) {
    res.status(400).json({ error: "Invalid work arrangement" });
    return;
  }

  if (!getJob(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  db.prepare(
    `UPDATE jobs
     SET title = COALESCE(?, title),
         company = COALESCE(?, company),
         location = COALESCE(?, location),
         work_arrangement = COALESCE(?, work_arrangement),
         source_url = COALESCE(?, source_url),
         posting_text = COALESCE(?, posting_text),
         status = COALESCE(?, status)
     WHERE id = ?`,
  ).run(
    title ?? null,
    company ?? null,
    location ?? null,
    work_arrangement ?? null,
    source_url ?? null,
    posting_text ?? null,
    status ?? null,
    id,
  );

  res.json(getJob(id));
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

// --- Extraction (Part A) ------------------------------------------------

router.post("/jobs/extract", async (req, res): Promise<void> => {
  const { url, posting_text } = req.body ?? {};
  const hasUrl = typeof url === "string" && url.trim().length > 0;
  const hasText = typeof posting_text === "string" && posting_text.trim().length > 0;

  if (!hasUrl && !hasText) {
    res.status(400).json({ error: "Provide a URL or paste the posting text." });
    return;
  }

  try {
    if (hasUrl) {
      const trimmed = url.trim();
      const normalised = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const result = await extractFromUrl(normalised);
      if (!result.ok) {
        // Expected for blocked/junk pages — tell the client to offer paste.
        req.log.info({ url: normalised }, "Job URL fetch failed; offering paste");
        res.json({ fetch_failed: true, message: result.reason, source_url: normalised });
        return;
      }
      res.json({ fetch_failed: false, ...result.data });
      return;
    }
    const data = await extractFromText(posting_text);
    res.json({ fetch_failed: false, ...data });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err }, "Job extraction failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// --- Tailoring (Part B) -------------------------------------------------

/** Load the pieces every tailoring call needs, or send an error response. */
function loadTailorContext(
  id: number,
  res: Response,
):
  | { job: JobRow; resumeJson: ResumeJson; extraAnswers: unknown }
  | null {
  const job = getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return null;
  }
  if (!job.posting_text || job.posting_text.trim().length === 0) {
    res.status(400).json({
      error: "This job has no posting text to tailor against. Add the posting first.",
    });
    return null;
  }
  const profile = getProfileRow();
  const resumeJson = parseJson<ResumeJson>(profile?.resume_json ?? null);
  if (!resumeJson || !Array.isArray(resumeJson.sections)) {
    res.status(400).json({
      error: "Add and confirm your base resume on the Profile page before tailoring.",
    });
    return null;
  }
  const extraAnswers = parseJson<unknown>(profile?.extra_answers_json ?? null) ?? [];
  return { job, resumeJson, extraAnswers };
}

// Initial tailoring — may return clarifying questions. Sets status Tailoring.
router.post("/jobs/:id/tailor", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadTailorContext(id, res);
  if (!ctx) return;

  try {
    const result = await runTailor({
      mode: "initial",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
    });
    db.prepare(
      "UPDATE jobs SET status = 'Tailoring' WHERE id = ? AND status = 'New'",
    ).run(id);
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Tailoring failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Record a clarifying-question answer: qa_log + append to extra_answers_json.
router.post("/jobs/:id/qa", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const { question, answer } = req.body ?? {};
  if (typeof question !== "string" || question.trim().length === 0) {
    res.status(400).json({ error: "A question is required" });
    return;
  }
  if (typeof answer !== "string") {
    res.status(400).json({ error: "An answer is required" });
    return;
  }
  if (!getJob(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  db.prepare(
    "INSERT INTO qa_log (job_id, question, answer) VALUES (?, ?, ?)",
  ).run(id, question.trim(), answer);

  db.prepare(
    "INSERT OR IGNORE INTO profile (id, updated_at) VALUES (1, datetime('now'))",
  ).run();
  const profile = getProfileRow();
  const existing = parseJson<{ id: string; question: string; answer: string }[]>(
    profile?.extra_answers_json ?? null,
  );
  const answers = Array.isArray(existing) ? existing : [];
  answers.push({
    id: `qa-${crypto.randomUUID()}`,
    question: question.trim(),
    answer,
  });
  db.prepare(
    "UPDATE profile SET extra_answers_json = ?, updated_at = datetime('now') WHERE id = 1",
  ).run(JSON.stringify(answers));

  res.status(201).json({ extra_answers: answers });
});

// Finalize — second pass incorporating the answers.
router.post("/jobs/:id/tailor/finalize", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadTailorContext(id, res);
  if (!ctx) return;

  const { answers, current_resume } = req.body ?? {};
  const answerPairs: QaPair[] = Array.isArray(answers)
    ? answers
        .map((a: unknown) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return {
            question: String(o["question"] ?? ""),
            answer: String(o["answer"] ?? ""),
          };
        })
        .filter((a) => a.question && a.answer)
    : [];

  try {
    const result = await runTailor({
      mode: "finalize",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      answers: answerPairs,
      currentResume:
        current_resume && Array.isArray(current_resume.sections)
          ? (current_resume as ResumeJson)
          : undefined,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Tailoring finalize failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Revise — apply a specific free-text edit request to the proposed resume.
router.post("/jobs/:id/tailor/revise", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadTailorContext(id, res);
  if (!ctx) return;

  const { proposed_resume, edit_request } = req.body ?? {};
  if (typeof edit_request !== "string" || edit_request.trim().length === 0) {
    res.status(400).json({ error: "Describe the edit you'd like." });
    return;
  }
  if (!proposed_resume || !Array.isArray(proposed_resume.sections)) {
    res.status(400).json({ error: "Missing the current proposed resume." });
    return;
  }

  try {
    const result = await runTailor({
      mode: "revise",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      editRequest: edit_request.trim(),
      currentResume: proposed_resume as ResumeJson,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Tailoring revise failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Approve — save the tailored resume as a document and mark the job Ready.
router.post("/jobs/:id/tailor/approve", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  if (!getJob(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { proposed_resume } = req.body ?? {};
  if (!proposed_resume || !Array.isArray(proposed_resume.sections)) {
    res.status(400).json({ error: "Missing the tailored resume to approve." });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO documents (job_id, type, content_json) VALUES (?, 'resume', ?)`,
    )
    .run(id, JSON.stringify(proposed_resume));
  db.prepare("UPDATE jobs SET status = 'Ready' WHERE id = ?").run(id);

  const document = db
    .prepare("SELECT * FROM documents WHERE id = ?")
    .get(Number(result.lastInsertRowid));

  req.log.info({ jobId: id }, "Tailored resume approved and saved");
  res.status(201).json(document);
});

export default router;
