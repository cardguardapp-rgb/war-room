import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, eq, and, desc, jobsTable, profileTable, documentsTable, qaLogTable, type Job, type Profile } from "../lib/db";
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

async function getJob(id: number): Promise<Job | undefined> {
  const [row] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  return row;
}

async function getProfileRow(): Promise<Profile | undefined> {
  const [row] = await db.select().from(profileTable).where(eq(profileTable.id, 1));
  return row;
}

// --- CRUD ---------------------------------------------------------------

router.get("/jobs", async (_req, res): Promise<void> => {
  const jobs = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt), desc(jobsTable.id));
  res.json(jobs);
});

router.post("/jobs", async (req, res): Promise<void> => {
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

  const [row] = await db
    .insert(jobsTable)
    .values({
      title: title.trim(),
      company: company ?? null,
      location: location ?? null,
      workArrangement: wa,
      sourceUrl: source_url ?? null,
      postingText: posting_text ?? null,
      status: "New",
    })
    .returning();

  res.status(201).json(row);
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const job = await getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
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

  if (!(await getJob(id))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const updates: Partial<typeof jobsTable.$inferInsert> = {};
  if (title !== undefined) updates.title = title;
  if (company !== undefined) updates.company = company;
  if (location !== undefined) updates.location = location;
  if (work_arrangement !== undefined) updates.workArrangement = work_arrangement;
  if (source_url !== undefined) updates.sourceUrl = source_url;
  if (posting_text !== undefined) updates.postingText = posting_text;
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length > 0) {
    await db.update(jobsTable).set(updates).where(eq(jobsTable.id, id));
  }

  res.json(await getJob(id));
});

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const deleted = await db.delete(jobsTable).where(eq(jobsTable.id, id)).returning({ id: jobsTable.id });
  if (deleted.length === 0) {
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
async function loadTailorContext(
  id: number,
  res: Response,
): Promise<{ job: Job; resumeJson: ResumeJson; extraAnswers: unknown } | null> {
  const job = await getJob(id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return null;
  }
  if (!job.postingText || job.postingText.trim().length === 0) {
    res.status(400).json({
      error: "This job has no posting text to tailor against. Add the posting first.",
    });
    return null;
  }
  const profile = await getProfileRow();
  const resumeJson = (profile?.resumeJson as ResumeJson | null) ?? null;
  if (!resumeJson || !Array.isArray(resumeJson.sections)) {
    res.status(400).json({
      error: "Add and confirm your base resume on the Profile page before tailoring.",
    });
    return null;
  }
  const extraAnswers = profile?.extraAnswersJson ?? [];
  return { job, resumeJson, extraAnswers };
}

// Initial tailoring — may return clarifying questions. Sets status Tailoring.
router.post("/jobs/:id/tailor", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = await loadTailorContext(id, res);
  if (!ctx) return;

  try {
    const result = await runTailor({
      mode: "initial",
      postingText: ctx.job.postingText!,
      resumeJson: ctx.resumeJson,
      extraAnswers: ctx.extraAnswers,
    });
    await db
      .update(jobsTable)
      .set({ status: "Tailoring" })
      .where(and(eq(jobsTable.id, id), eq(jobsTable.status, "New")));
    res.json(result);
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Tailoring failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Record a clarifying-question answer: qa_log + append to extra_answers_json.
router.post("/jobs/:id/qa", async (req, res): Promise<void> => {
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
  if (!(await getJob(id))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  await db.insert(qaLogTable).values({ jobId: id, question: question.trim(), answer });

  await db
    .insert(profileTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: profileTable.id });
  const profile = await getProfileRow();
  const existing = profile?.extraAnswersJson as
    | { id: string; question: string; answer: string }[]
    | null;
  const answers = Array.isArray(existing) ? existing : [];
  answers.push({
    id: `qa-${crypto.randomUUID()}`,
    question: question.trim(),
    answer,
  });
  await db
    .update(profileTable)
    .set({ extraAnswersJson: answers, updatedAt: new Date() })
    .where(eq(profileTable.id, 1));

  res.status(201).json({ extra_answers: answers });
});

// Finalize — second pass incorporating the answers.
router.post("/jobs/:id/tailor/finalize", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const ctx = await loadTailorContext(id, res);
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
      postingText: ctx.job.postingText!,
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
  const ctx = await loadTailorContext(id, res);
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
      postingText: ctx.job.postingText!,
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
router.post("/jobs/:id/tailor/approve", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  if (!(await getJob(id))) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { proposed_resume } = req.body ?? {};
  if (!proposed_resume || !Array.isArray(proposed_resume.sections)) {
    res.status(400).json({ error: "Missing the tailored resume to approve." });
    return;
  }

  const [document] = await db
    .insert(documentsTable)
    .values({ jobId: id, type: "resume", contentJson: proposed_resume })
    .returning();
  await db.update(jobsTable).set({ status: "Ready" }).where(eq(jobsTable.id, id));

  req.log.info({ jobId: id }, "Tailored resume approved and saved");
  res.status(201).json(document);
});

export default router;
