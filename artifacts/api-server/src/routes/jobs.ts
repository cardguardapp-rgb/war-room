import crypto from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { inArray } from "drizzle-orm";
import { db, eq, and, desc, jobsTable, profileTable, documentsTable, qaLogTable, discoverSettingsTable, type Job, type Profile } from "../lib/db";
import { serializeJob, serializeDocument } from "../lib/serialize";
import { deleteObject } from "../lib/objectStore";
import { aiErrorResponse } from "../lib/anthropic";
import { loadChat, formatCoachingNotes } from "../lib/chatStore";
import { extractFromImages, extractFromText, extractFromUrl, type JobCriteria } from "../lib/jobExtract";
import { normaliseSettings } from "../lib/discover";
import { runTailor, type QaPair } from "../lib/tailor";
import type { ResumeJson } from "../lib/resumeParser";

const router: IRouter = Router();

const VALID_STATUSES = [
  "New",
  "Tailoring",
  "Ready",
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Not Applying",
] as const;
const WORK_ARRANGEMENTS = ["office", "hybrid", "remote", "unknown"];

// Job-posting screenshots (e.g. LinkedIn, which blocks copying) — held in memory
// and base64'd straight to the vision model; never written to disk.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 8;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPEG, GIF or WebP images are accepted."));
  },
});

/** Run multer for the screenshots, turning its errors into clean 400s. */
function uploadImages(req: Request, res: Response, next: NextFunction): void {
  imageUpload.array("images", MAX_IMAGES)(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Each image must be 10MB or smaller."
          : err instanceof multer.MulterError && err.code === "LIMIT_FILE_COUNT"
            ? `Attach at most ${MAX_IMAGES} images.`
            : err instanceof Error
              ? err.message
              : "Could not read the uploaded images.";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

interface JobAssessment {
  fit_score: number;
  fit_note: string;
  summary: string;
  flags: string[];
}

/** Validate the optional fit assessment sent with a new job; null if empty/absent. */
function normaliseAssessment(raw: unknown): JobAssessment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const scoreRaw = typeof o["fit_score"] === "number" ? o["fit_score"] : Number(o["fit_score"]);
  const fit_score = Number.isFinite(scoreRaw)
    ? Math.min(10, Math.max(1, Math.round(scoreRaw as number)))
    : 0;
  const fit_note = typeof o["fit_note"] === "string" ? o["fit_note"].trim() : "";
  const summary = typeof o["summary"] === "string" ? o["summary"].trim() : "";
  const flags = Array.isArray(o["flags"])
    ? o["flags"].map((f) => String(f ?? "").trim()).filter((f) => f.length > 0)
    : [];
  // Nothing worth persisting.
  if (!fit_score && !fit_note && !summary && flags.length === 0) return null;
  return { fit_score, fit_note, summary, flags };
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
  const ids = jobs.map((j) => j.id);

  // Attach each job's fit score (from its saved `assessment` document) so the
  // Jobs list can show it at a glance. At most one assessment per job, but keep
  // the newest if duplicates ever exist.
  const assessments = ids.length
    ? await db
        .select()
        .from(documentsTable)
        .where(and(inArray(documentsTable.jobId, ids), eq(documentsTable.type, "assessment")))
    : [];
  const byJob = new Map<number, (typeof assessments)[number]>();
  for (const d of assessments) {
    const prev = byJob.get(d.jobId);
    if (!prev || d.id > prev.id) byJob.set(d.jobId, d);
  }

  res.json(
    jobs.map((j) => {
      const a = byJob.get(j.id)?.contentJson as
        | { fit_score?: number; fit_note?: string }
        | undefined;
      return {
        ...serializeJob(j),
        fit_score: typeof a?.fit_score === "number" ? a.fit_score : null,
        fit_note: typeof a?.fit_note === "string" ? a.fit_note : null,
      };
    }),
  );
});

router.post("/jobs", async (req, res): Promise<void> => {
  const { title, company, location, work_arrangement, source_url, posting_text, assessment } =
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

  // Persist the fit assessment (from extraction) as an `assessment` document so
  // it's visible later on the Job Detail page and the Jobs list, not just on the
  // add-review screen.
  const normalisedAssessment = normaliseAssessment(assessment);
  if (normalisedAssessment) {
    await db.insert(documentsTable).values({
      jobId: row.id,
      type: "assessment",
      contentJson: normalisedAssessment,
    });
  } else if (row.postingText && row.postingText.trim().length > 0) {
    // No assessment supplied (e.g. saved from Discover, or added without a
    // review step) — auto-generate one from the posting so the fit score shows
    // immediately in the list. Never block job creation if the AI call fails.
    try {
      const criteria = await loadCriteria();
      const meta = await extractFromText(row.postingText, criteria);
      const auto = normaliseAssessment({
        fit_score: meta.fit_score,
        fit_note: meta.fit_note,
        summary: meta.summary,
        flags: meta.flags,
      });
      if (auto) {
        await db.insert(documentsTable).values({
          jobId: row.id,
          type: "assessment",
          contentJson: auto,
        });
      }
    } catch (err) {
      req.log.warn({ err, jobId: row.id }, "Auto fit-assessment on create failed");
    }
  }

  res.status(201).json(serializeJob(row));
});

// Generate (or refresh) the fit assessment for an EXISTING job from its stored
// posting text — so jobs added before this feature can get a score too.
router.post("/jobs/:id/assess", async (req, res): Promise<void> => {
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
  if (!job.postingText || job.postingText.trim().length === 0) {
    res.status(400).json({ error: "This job has no posting text to assess. Add the posting first." });
    return;
  }
  try {
    const criteria = await loadCriteria();
    const meta = await extractFromText(job.postingText, criteria);
    const assessment = normaliseAssessment({
      fit_score: meta.fit_score,
      fit_note: meta.fit_note,
      summary: meta.summary,
      flags: meta.flags,
    });
    if (!assessment) {
      res.status(502).json({ error: "Couldn't produce an assessment for this posting." });
      return;
    }
    // Replace any prior assessment for this job.
    await db
      .delete(documentsTable)
      .where(and(eq(documentsTable.jobId, id), eq(documentsTable.type, "assessment")));
    const [doc] = await db
      .insert(documentsTable)
      .values({ jobId: id, type: "assessment", contentJson: assessment })
      .returning();
    req.log.info({ jobId: id }, "Fit assessment generated");
    res.status(201).json(serializeDocument(doc));
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Fit assessment failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
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
  res.json(serializeJob(job));
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

  res.json(serializeJob((await getJob(id))!));
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

/** The candidate's Discover criteria, so extraction can flag mismatches. Never throws. */
async function loadCriteria(): Promise<JobCriteria | undefined> {
  try {
    const [row] = await db
      .select()
      .from(discoverSettingsTable)
      .where(eq(discoverSettingsTable.id, 1));
    if (!row?.settingsJson) return undefined;
    const s = normaliseSettings(row.settingsJson);
    return {
      roleTitles: s.roleTitles,
      officeRegion: s.officeRegion,
      remoteRule: s.remoteRule,
      exclusions: s.exclusions,
    };
  } catch {
    return undefined; // criteria are a bonus — never block extraction on them
  }
}

router.post("/jobs/extract", async (req, res): Promise<void> => {
  const { url, posting_text } = req.body ?? {};
  const hasUrl = typeof url === "string" && url.trim().length > 0;
  const hasText = typeof posting_text === "string" && posting_text.trim().length > 0;

  if (!hasUrl && !hasText) {
    res.status(400).json({ error: "Provide a URL or paste the posting text." });
    return;
  }

  try {
    const criteria = await loadCriteria();
    if (hasUrl) {
      const trimmed = url.trim();
      const normalised = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      const result = await extractFromUrl(normalised, criteria);
      if (!result.ok) {
        // Expected for blocked/junk pages — tell the client to offer paste.
        req.log.info({ url: normalised }, "Job URL fetch failed; offering paste");
        res.json({ fetch_failed: true, message: result.reason, source_url: normalised });
        return;
      }
      res.json({ fetch_failed: false, ...result.data });
      return;
    }
    const data = await extractFromText(posting_text, criteria);
    res.json({ fetch_failed: false, ...data });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err }, "Job extraction failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Extract from SCREENSHOT(S) — for postings you can't copy (LinkedIn especially).
// Multipart field `images` (1..MAX_IMAGES). The vision model transcribes the
// posting into posting_text and classifies it in one pass. Does not save.
router.post("/jobs/extract-image", uploadImages, async (req, res): Promise<void> => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "Attach at least one screenshot of the posting." });
    return;
  }
  try {
    const criteria = await loadCriteria();
    const images = files.map((f) => ({
      mediaType: f.mimetype,
      dataBase64: f.buffer.toString("base64"),
    }));
    const data = await extractFromImages(images, criteria);
    res.json({ fetch_failed: false, ...data });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err }, "Job image extraction failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// --- Tailoring (Part B) -------------------------------------------------

/** Load the pieces every tailoring call needs, or send an error response. */
async function loadTailorContext(
  id: number,
  res: Response,
): Promise<{
  job: Job;
  resumeJson: ResumeJson;
  extraAnswers: unknown;
  coachingNotes: string;
} | null> {
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
  // Fold in the saved role-advice chat so tailoring can draw on what the
  // candidate shared there (context only — never invented experience).
  const coachingNotes = formatCoachingNotes(await loadChat(id));
  return { job, resumeJson, extraAnswers, coachingNotes };
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
      coachingNotes: ctx.coachingNotes,
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
      coachingNotes: ctx.coachingNotes,
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
      coachingNotes: ctx.coachingNotes,
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
// Re-tailoring is supported: any previous tailored resume for this job (and its
// cached .docx/.pdf objects) is replaced, so re-doing a resume never piles up
// duplicates — the job always has exactly one current tailored resume.
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

  // Remove any previous tailored resume(s) for this job first, plus their
  // cached files in object storage. Only 'resume' docs are touched — cover
  // letters and notes are left alone.
  const priorResumes = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.jobId, id), eq(documentsTable.type, "resume")));
  if (priorResumes.length > 0) {
    await db
      .delete(documentsTable)
      .where(and(eq(documentsTable.jobId, id), eq(documentsTable.type, "resume")));
    const staleKeys = priorResumes
      .flatMap((d) => [d.docxObjectKey, d.pdfObjectKey])
      .filter((k): k is string => Boolean(k));
    await Promise.all(
      staleKeys.map((key) =>
        deleteObject(key).catch((err) =>
          req.log.warn({ err, key }, "Failed to delete old resume object"),
        ),
      ),
    );
  }

  const [document] = await db
    .insert(documentsTable)
    .values({ jobId: id, type: "resume", contentJson: proposed_resume })
    .returning();
  await db.update(jobsTable).set({ status: "Ready" }).where(eq(jobsTable.id, id));

  req.log.info(
    { jobId: id, replaced: priorResumes.length },
    "Tailored resume approved and saved",
  );
  res.status(201).json(serializeDocument(document));
});

export default router;
