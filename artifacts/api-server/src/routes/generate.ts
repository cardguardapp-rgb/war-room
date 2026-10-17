import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { inArray } from "drizzle-orm";
import { db, eq, and, desc, jobsTable, profileTable, documentsTable, qaLogTable, type Job } from "../lib/db";
import { serializeDocument } from "../lib/serialize";
import { deleteObject } from "../lib/objectStore";
import { aiErrorResponse, streamChat, type ChatMessage } from "../lib/anthropic";
import { aiModel, chatModelParams } from "../lib/models";
import { openSse, wantsEventStream } from "../lib/sse";
import { CHAT_SYSTEM } from "../lib/prompts";
import { runCoverLetters, type CoverLetterResult } from "../lib/coverLetters";
import { runAppQuestions } from "../lib/appQuestions";
import {
  clearChat,
  formatCoachingNotes,
  loadChat,
  saveChat,
  type ChatAttachment,
  type ChatTurn,
} from "../lib/chatStore";
import {
  buildTurnContent,
  ingestAttachment,
  isAcceptedAttachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from "../lib/chatAttachments";
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

// Chat attachments — held in memory, then stored/extracted by chatAttachments.
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedAttachment(file.mimetype, file.originalname)) cb(null, true);
    else cb(new Error("Attach an image, PDF, .docx, .txt, .md or .csv file."));
  },
});

/** Run multer for chat attachments, turning its errors into clean 400s. */
function uploadChatFiles(req: Request, res: Response, next: NextFunction): void {
  chatUpload.array("files", MAX_ATTACHMENTS)(req, res, (err: unknown) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Each file must be 15MB or smaller."
          : err instanceof multer.MulterError && err.code === "LIMIT_FILE_COUNT"
            ? `Attach at most ${MAX_ATTACHMENTS} files.`
            : err instanceof Error
              ? err.message
              : "Could not read the attached files.";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

/** The client-safe view of a turn — never leaks object keys or extracted text. */
function publicTurn(t: ChatTurn) {
  return {
    role: t.role,
    content: t.content,
    ...(t.attachments?.length
      ? {
          attachments: t.attachments.map((a) => ({
            name: a.name,
            kind: a.kind,
            mediaType: a.mediaType,
          })),
        }
      : {}),
  };
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

// The SERVER owns the transcript: the client sends only the new question (+ any
// attached files), and we append to what's saved. That's what lets attachments
// persist — a follow-up turn re-sends the stored image/PDF so the model still
// sees it, without the client having to round-trip binary data.
router.post("/jobs/:id/chat", uploadChatFiles, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const message = String((req.body ?? {}).message ?? "").trim().slice(0, 8000);
  if (!message && files.length === 0) {
    res.status(400).json({ error: "Type a question or attach a file." });
    return;
  }

  const ctx = await loadGenContext(id, res);
  if (!ctx) return;

  // Store/extract the attachments up-front so we can clean them up if the AI
  // call fails (otherwise they'd be orphaned in object storage).
  let attachments: ChatAttachment[] = [];
  try {
    attachments = await Promise.all(files.map((f) => ingestAttachment(f)));
  } catch (err) {
    req.log.error({ err, jobId: id }, "Chat attachment ingest failed");
    res.status(400).json({ error: "Could not read one of the attached files." });
    return;
  }

  const history = await loadChat(id);
  const userTurn: ChatTurn = {
    role: "user",
    content: message,
    ...(attachments.length ? { attachments } : {}),
  };
  // Bound what we send to the model (last 20 turns) to control token cost.
  const turns = [...history, userTurn].slice(-20);

  // With Accept: text/event-stream the reply is streamed as "text" events and
  // ends with "done" (the saved transcript) or "error"; otherwise plain JSON.
  // Even if the client drops mid-reply, the reply is finished and saved.
  const sse = wantsEventStream(req) ? openSse(req, res) : null;
  try {
    const messages: ChatMessage[] = await Promise.all(
      turns.map(async (t) => ({ role: t.role, content: await buildTurnContent(t) })),
    );
    const model = aiModel("chat");
    const result = await streamChat({
      model,
      extraParams: chatModelParams(model),
      system: buildChatSystem(ctx.job, ctx.resumeJson, ctx.extraAnswers),
      messages,
      maxTokens: 2048,
      onText: (text) => sse?.send("text", { text }),
    });
    const { text: _text, ...timing } = result;
    req.log.info({ jobId: id, streamed: !!sse, ...timing }, "Role chat reply");
    const reply = result.text.trim();

    const saved: ChatTurn[] = [...history, userTurn, { role: "assistant", content: reply }];
    await saveChat(id, saved);
    const body = { reply, messages: saved.map(publicTurn) };
    if (sse) {
      sse.send("done", body);
      sse.close();
    } else {
      res.json(body);
    }
  } catch (err) {
    // Don't strand the just-uploaded objects — nothing was saved.
    await Promise.all(
      attachments.map((a) => (a.objectKey ? deleteObject(a.objectKey) : Promise.resolve())),
    );
    const mapped = aiErrorResponse(err);
    req.log.error({ err, jobId: id }, "Role chat failed");
    if (sse) {
      sse.send("error", mapped);
      sse.close();
    } else {
      res.status(mapped.status).json({ error: mapped.error });
    }
  }
});

// Dev only (the route doesn't exist in production): send one question to the
// current coach model and to AI_MODEL_CHAT_COMPARE side by side, with the same
// system prompt and history, so Amy can judge whether the faster model still
// sounds like the coach. Nothing is saved. Streams "text" { lane, text },
// "lane_done" { lane, ...timing } / "lane_error" { lane, error }, then "done".
if (process.env.NODE_ENV !== "production") {
  router.post("/jobs/:id/chat/compare", async (req, res): Promise<void> => {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: "Invalid job id" });
      return;
    }
    const message = String((req.body ?? {}).message ?? "").trim().slice(0, 8000);
    if (!message) {
      res.status(400).json({ error: "Type a question." });
      return;
    }
    const ctx = await loadGenContext(id, res);
    if (!ctx) return;

    const history = await loadChat(id);
    const turns: ChatTurn[] = [...history, { role: "user" as const, content: message }].slice(-20);
    const system = buildChatSystem(ctx.job, ctx.resumeJson, ctx.extraAnswers);
    const sse = openSse(req, res);
    try {
      const messages: ChatMessage[] = await Promise.all(
        turns.map(async (t) => ({ role: t.role, content: await buildTurnContent(t) })),
      );
      const lanes = [
        { lane: "current", model: aiModel("chat") },
        { lane: "compare", model: aiModel("chatCompare") },
      ];
      await Promise.all(
        lanes.map(async ({ lane, model }) => {
          try {
            const result = await streamChat({
              model,
              extraParams: chatModelParams(model),
              system,
              messages,
              maxTokens: 2048,
              onText: (text) => sse.send("text", { lane, text }),
            });
            const { text: _text, ...timing } = result;
            req.log.info({ jobId: id, lane, ...timing }, "Chat compare reply");
            sse.send("lane_done", { lane, ...timing });
          } catch (err) {
            const mapped = aiErrorResponse(err);
            req.log.error({ err, jobId: id, lane, model }, "Chat compare lane failed");
            sse.send("lane_error", { lane, model, error: mapped.error });
          }
        }),
      );
      sse.send("done", {});
    } catch (err) {
      sse.send("error", aiErrorResponse(err));
    }
    sse.close();
  });
}

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
  res.json({ messages: (await loadChat(id)).map(publicTurn) });
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
