import { Router, type IRouter, type Response } from "express";
import { inArray } from "drizzle-orm";
import { db, eq, and, desc, jobsTable, profileTable, documentsTable, qaLogTable, type Job } from "../lib/db";
import { serializeDocument } from "../lib/serialize";
import { deleteObject } from "../lib/objectStore";
import { aiErrorResponse, chatComplete, type ChatMessage } from "../lib/anthropic";
import { CHAT_MODEL, CHAT_SYSTEM } from "../lib/prompts";
import { runCoverLetters, type CoverLetterResult } from "../lib/coverLetters";
import { runAppQuestions } from "../lib/appQuestions";
import { clearChat, formatCoachingNotes, loadChat, saveChat } from "../lib/chatStore";
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
): Promise<{
  job: Job;
  resumeJson: ResumeJson;
  extraAnswers: unknown;
  coachingNotes: string;
} | null> {
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

  // Prefer the latest approved tailored resume for this job. Query the newest
  // 'resume' doc specifically so other document types (cover letters, the saved
  // chat, the assessment) never shadow it.
  const [latestResumeDoc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.jobId, id), eq(documentsTable.type, "resume")))
    .orderBy(desc(documentsTable.createdAt), desc(documentsTable.id))
    .limit(1);
  const tailored = (latestResumeDoc?.contentJson as ResumeJson | null) ?? null;
  const base = (profile?.resumeJson as ResumeJson | null) ?? null;
  const resumeJson = tailored && Array.isArray(tailored.sections) ? tailored : base;

  if (!resumeJson || !Array.isArray(resumeJson.sections)) {
    res.status(400).json({
      error: "Add and confirm your base resume on the Profile page first.",
    });
    return null;
  }
  const extraAnswers = profile?.extraAnswersJson ?? [];
  // Fold in the saved role-advice chat so tailoring/letters/answers can draw on
  // context the candidate shared there.
  const coachingNotes = formatCoachingNotes(await loadChat(id));
  return { job, resumeJson, extraAnswers, coachingNotes };
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

// --- Role-advice chat ---------------------------------------------------

/** Coerce a client-supplied message list into a safe, bounded ChatMessage[]. */
function toChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const role = o["role"] === "assistant" ? "assistant" : "user";
      const content = String(o["content"] ?? "").trim().slice(0, 4000);
      return { role, content } as ChatMessage;
    })
    .filter((m) => m.content.length > 0);
  // Keep the conversation bounded (last 20 turns) to control token cost.
  return cleaned.slice(-20);
}

/** Persona system prompt + the grounding context for this specific role. */
function buildChatSystem(job: Job, resumeJson: ResumeJson, extraAnswers: unknown): string {
  return [
    CHAT_SYSTEM,
    "",
    "## CONTEXT FOR THIS CONVERSATION",
    `ROLE: ${job.title}${job.company ? ` at ${job.company}` : ""}${job.location ? ` — ${job.location}` : ""}`,
    "",
    "JOB POSTING:",
    (job.postingText ?? "").slice(0, 40000),
    "",
    "CANDIDATE RESUME (JSON — real, factual):",
    JSON.stringify(resumeJson),
    "",
    "CANDIDATE EXTRA ANSWERS (JSON — additional true facts):",
    JSON.stringify(extraAnswers ?? []),
  ].join("\n");
}

router.post("/jobs/:id/chat", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const messages = toChatMessages((req.body ?? {}).messages);
  if (messages.length === 0 || messages[messages.length - 1]!.role !== "user") {
    res.status(400).json({ error: "Send at least one message, ending with your question." });
    return;
  }
  const ctx = await loadGenContext(id, res);
  if (!ctx) return;
  try {
    const reply = (
      await chatComplete({
        model: CHAT_MODEL,
        system: buildChatSystem(ctx.job, ctx.resumeJson, ctx.extraAnswers),
        messages,
        maxTokens: 2048,
      })
    ).trim();
    // Persist the full transcript (incl. this reply) so it survives reloads and
    // can feed future resume/letter/answer generation for this role.
    await saveChat(id, [...messages, { role: "assistant", content: reply }]);
    res.json({ reply });
  } catch (err) {
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Role chat failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// Load the saved advice-chat transcript for a job (empty array if none).
router.get("/jobs/:id/chat", async (req, res): Promise<void> => {
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
  res.json({ messages: await loadChat(id) });
});

// Clear the saved advice-chat transcript for a job ("New chat").
router.delete("/jobs/:id/chat", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  await clearChat(id);
  res.sendStatus(204);
});

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
      coachingNotes: ctx.coachingNotes,
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
      coachingNotes: ctx.coachingNotes,
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
      coachingNotes: ctx.coachingNotes,
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

  // Replace any previous cover-letter set for this job (+ cached files), so
  // editing and re-saving updates the letters instead of piling up duplicates.
  const coverTypes = ["cover_letter", "cover_letter_plain", "cover_note"] as const;
  const priorCover = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.jobId, id), inArray(documentsTable.type, [...coverTypes])));
  if (priorCover.length > 0) {
    await db
      .delete(documentsTable)
      .where(and(eq(documentsTable.jobId, id), inArray(documentsTable.type, [...coverTypes])));
    const staleKeys = priorCover
      .flatMap((d) => [d.docxObjectKey, d.pdfObjectKey])
      .filter((k): k is string => Boolean(k));
    await Promise.all(
      staleKeys.map((key) =>
        deleteObject(key).catch((err) =>
          req.log.warn({ err, key }, "Failed to delete old cover-letter object"),
        ),
      ),
    );
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
      coachingNotes: ctx.coachingNotes,
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
      coachingNotes: ctx.coachingNotes,
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
