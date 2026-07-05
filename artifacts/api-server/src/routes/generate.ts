import { Router, type IRouter, type Response } from "express";
import { db, eq, desc, jobsTable, profileTable, documentsTable, qaLogTable, type Job } from "../lib/db";
import { serializeDocument } from "../lib/serialize";
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

/** Load posting + the best available resume (latest approved tailored, else base) + extra answers. */
async function loadGenContext(
  id: number,
  res: Response,
): Promise<{ job: Job; resumeJson: ResumeJson; extraAnswers: unknown } | null> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return null;
  }
  if (!job.postingText || job.postingText.trim().length === 0) {
    res.status(400).json({ error: "This job has no posting text. Add the posting first." });
    return null;
  }
  const [profile] = await db.select().from(profileTable).where(eq(profileTable.id, 1));

  // Prefer the latest approved tailored resume for this job.
  const [latestResumeDoc] = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.jobId, id))
    .orderBy(desc(documentsTable.createdAt), desc(documentsTable.id))
    .limit(1);
  const tailored =
    latestResumeDoc?.type === "resume"
      ? (latestResumeDoc.contentJson as ResumeJson | null)
      : null;
  const base = (profile?.resumeJson as ResumeJson | null) ?? null;
  const resumeJson = tailored && Array.isArray(tailored.sections) ? tailored : base;

  if (!resumeJson || !Array.isArray(resumeJson.sections)) {
    res.status(400).json({
      error: "Add and confirm your base resume on the Profile page first.",
    });
    return null;
  }
  const extraAnswers = profile?.extraAnswersJson ?? [];
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
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runCoverLetters({
      mode: "initial",
      postingText: ctx.job.postingText!,
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
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  const { answers, current } = req.body ?? {};
  try {
    const result = await runCoverLetters({
      mode: "finalize",
      postingText: ctx.job.postingText!,
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
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  const { current, edit_request } = req.body ?? {};
  if (typeof edit_request !== "string" || edit_request.trim().length === 0) {
    res.status(400).json({ error: "Describe the edit you'd like." });
    return;
  }
  try {
    const result = await runCoverLetters({
      mode: "revise",
      postingText: ctx.job.postingText!,
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

router.post("/jobs/:id/cover-letters/approve", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { full, short } = req.body ?? {};
  if (!full || typeof full.body !== "string" || full.body.trim().length === 0) {
    res.status(400).json({ error: "Missing the cover letter to save." });
    return;
  }

  const documents = await db
    .insert(documentsTable)
    .values([
      {
        jobId: id,
        type: "cover_letter",
        contentJson: {
          salutation: String(full.salutation ?? "Dear Hiring Manager"),
          re: String(full.re ?? ""),
          body: String(full.body),
        },
      },
      { jobId: id, type: "cover_letter_plain", contentJson: { text: String(full.body) } },
      { jobId: id, type: "cover_note", contentJson: { text: String(short ?? "") } },
    ])
    .returning();

  req.log.info({ jobId: id }, "Cover letters approved and saved");
  res.status(201).json({ documents: documents.map(serializeDocument) });
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
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runAppQuestions({
      mode: "initial",
      postingText: ctx.job.postingText!,
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
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  try {
    const result = await runAppQuestions({
      mode: "finalize",
      postingText: ctx.job.postingText!,
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
router.post("/jobs/:id/questions/save", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const pairs = toQaPairs((req.body ?? {}).answers);
  if (pairs.length === 0) {
    res.status(400).json({ error: "Nothing to save." });
    return;
  }
  await db.insert(qaLogTable).values(pairs.map((r) => ({ jobId: id, question: r.question, answer: r.answer })));
  req.log.info({ jobId: id, count: pairs.length }, "Application answers saved to qa_log");
  res.status(201).json({ saved: pairs.length });
});

export default router;
