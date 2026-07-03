import { Router, type IRouter, type Response } from "express";
import { db, type DocumentRow, type JobRow, type ProfileRow } from "../lib/db";
import { aiErrorResponse } from "../lib/anthropic";
import { runCoverLetters, type CoverLetterResult } from "../lib/coverLetters";
import { runAppQuestions } from "../lib/appQuestions";
import type { ResumeJson } from "../lib/resumeParser";
import type { QaPair } from "../lib/tailor";

const router: IRouter = Router();

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

function parseJson<T>(value: string | null): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** Load posting + the best available resume (latest approved tailored, else base) + extra answers. */
function loadGenContext(
  id: number,
  res: Response,
): { job: JobRow; resumeJson: ResumeJson; extraAnswers: unknown } | null {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return null;
  }
  if (!job.posting_text || job.posting_text.trim().length === 0) {
    res.status(400).json({ error: "This job has no posting text. Add the posting first." });
    return null;
  }
  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow | undefined;

  // Prefer the latest approved tailored resume for this job.
  const latestResumeDoc = db
    .prepare(
      "SELECT * FROM documents WHERE job_id = ? AND type = 'resume' ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .get(id) as DocumentRow | undefined;
  const tailored = latestResumeDoc ? parseJson<ResumeJson>(latestResumeDoc.content_json) : null;
  const base = parseJson<ResumeJson>(profile?.resume_json ?? null);
  const resumeJson = tailored && Array.isArray(tailored.sections) ? tailored : base;

  if (!resumeJson || !Array.isArray(resumeJson.sections)) {
    res.status(400).json({
      error: "Add and confirm your base resume on the Profile page first.",
    });
    return null;
  }
  const extraAnswers = parseJson<unknown>(profile?.extra_answers_json ?? null) ?? [];
  return { job, resumeJson, extraAnswers };
}

function toQaPairs(value: unknown): QaPair[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      return { question: String(o["question"] ?? ""), answer: String(o["answer"] ?? "") };
    })
    .filter((a) => a.question && a.answer);
}

// --- Cover letters ------------------------------------------------------

router.post("/jobs/:id/cover-letters", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runCoverLetters({
      mode: "initial",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Cover letters failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/jobs/:id/cover-letters/finalize", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadGenContext(id, res);
  if (!ctx) return;
  const { answers, current } = req.body ?? {};
  try {
    const result = await runCoverLetters({
      mode: "finalize",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      answers: toQaPairs(answers),
      current: (current ?? undefined) as CoverLetterResult | undefined,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Cover letters finalize failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/jobs/:id/cover-letters/revise", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = loadGenContext(id, res);
  if (!ctx) return;
  const { current, edit_request } = req.body ?? {};
  if (typeof edit_request !== "string" || edit_request.trim().length === 0) {
    res.status(400).json({ error: "Describe the edit you'd like." });
    return;
  }
  try {
    const result = await runCoverLetters({
      mode: "revise",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      editRequest: edit_request.trim(),
      current: (current ?? undefined) as CoverLetterResult | undefined,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Cover letters revise failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/jobs/:id/cover-letters/approve", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  if (!db.prepare("SELECT id FROM jobs WHERE id = ?").get(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { full, short } = req.body ?? {};
  if (!full || typeof full.body !== "string" || full.body.trim().length === 0) {
    res.status(400).json({ error: "Missing the cover letter to save." });
    return;
  }

  const insert = db.prepare(
    "INSERT INTO documents (job_id, type, content_json) VALUES (?, ?, ?)",
  );
  const fullDoc = insert.run(
    id,
    "cover_letter",
    JSON.stringify({
      salutation: String(full.salutation ?? "Dear Hiring Manager"),
      re: String(full.re ?? ""),
      body: String(full.body),
    }),
  );
  const plainDoc = insert.run(id, "cover_letter_plain", JSON.stringify({ text: String(full.body) }));
  const noteDoc = insert.run(
    id,
    "cover_note",
    JSON.stringify({ text: String(short ?? "") }),
  );

  const ids = [fullDoc, plainDoc, noteDoc].map((r) => Number(r.lastInsertRowid));
  const documents = db
    .prepare(`SELECT * FROM documents WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids);

  req.log.info({ jobId: id }, "Cover letters approved and saved");
  res.status(201).json({ documents });
});

// --- Application questions -----------------------------------------------

router.post("/jobs/:id/questions", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const { questions } = req.body ?? {};
  if (typeof questions !== "string" || questions.trim().length === 0) {
    res.status(400).json({ error: "Paste at least one application question." });
    return;
  }
  const ctx = loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runAppQuestions({
      mode: "initial",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      questions,
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "App questions failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

router.post("/jobs/:id/questions/finalize", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const { questions, answers } = req.body ?? {};
  if (typeof questions !== "string" || questions.trim().length === 0) {
    res.status(400).json({ error: "Missing the application questions." });
    return;
  }
  const ctx = loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runAppQuestions({
      mode: "finalize",
      postingText: ctx.job.posting_text!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
      questions,
      answers: toQaPairs(answers),
    });
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "App questions finalize failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Save drafted application answers to qa_log.
router.post("/jobs/:id/questions/save", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  if (!db.prepare("SELECT id FROM jobs WHERE id = ?").get(id)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const pairs = toQaPairs((req.body ?? {}).answers);
  if (pairs.length === 0) {
    res.status(400).json({ error: "Nothing to save." });
    return;
  }
  const insert = db.prepare("INSERT INTO qa_log (job_id, question, answer) VALUES (?, ?, ?)");
  const tx = db.transaction((rows: QaPair[]) => {
    for (const r of rows) insert.run(id, r.question, r.answer);
  });
  tx(pairs);
  req.log.info({ jobId: id, count: pairs.length }, "Application answers saved to qa_log");
  res.status(201).json({ saved: pairs.length });
});

export default router;
