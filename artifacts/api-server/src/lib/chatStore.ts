// Persistence for the per-job role-advice chat. The transcript is stored as a
// single `documents` row (type "chat", contentJson `{ messages }`) per job — the
// same free-text-type trick used for "assessment", so no schema migration is
// needed. Saved chats survive page reloads AND feed context into future resume
// tailoring, cover letters and application answers for that role.
//
// Turns may carry ATTACHMENTS (screenshots, PDs, interview invites…). Binary
// attachments (images/PDFs) live in object storage and are re-sent to the model
// on every turn, so a follow-up question still "sees" the file. Text-like
// attachments (.txt/.md/.csv/.docx) are extracted to text at upload and inlined.

import { and, db, desc, documentsTable, eq } from "./db";
import { deleteObject } from "./objectStore";

const CHAT_TYPE = "chat";

export interface ChatAttachment {
  name: string;
  /** image → vision block; document → PDF block; text → inlined text block. */
  kind: "image" | "document" | "text";
  mediaType: string;
  /** Object-storage key — set for binary attachments (image/document). */
  objectKey?: string;
  /** Extracted text — set for text-like attachments (.txt/.md/.csv/.docx). */
  text?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

function normaliseAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((a) => {
      const o = (a ?? {}) as Record<string, unknown>;
      const kind =
        o["kind"] === "image" || o["kind"] === "document" || o["kind"] === "text"
          ? o["kind"]
          : "text";
      const att: ChatAttachment = {
        name: String(o["name"] ?? "attachment").slice(0, 200),
        kind,
        mediaType: String(o["mediaType"] ?? "application/octet-stream"),
      };
      if (typeof o["objectKey"] === "string" && o["objectKey"]) att.objectKey = o["objectKey"];
      // Cap inlined text so one huge file can't blow up the transcript.
      if (typeof o["text"] === "string" && o["text"]) att.text = o["text"].slice(0, 60000);
      return att;
    })
    .slice(0, 10);
}

/** Coerce stored/inbound chat JSON into safe, bounded turns. */
export function normaliseChatMessages(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const role = o["role"] === "assistant" ? "assistant" : "user";
      const content = String(o["content"] ?? "").trim().slice(0, 8000);
      const attachments = normaliseAttachments(o["attachments"]);
      const turn: ChatTurn = { role, content };
      if (attachments.length) turn.attachments = attachments;
      return turn;
    })
    .filter((m) => m.content.length > 0 || (m.attachments?.length ?? 0) > 0)
    .slice(-40); // keep the saved transcript bounded
}

/** The saved advice-chat transcript for a job (empty array if none saved yet). */
export async function loadChat(jobId: number): Promise<ChatTurn[]> {
  const [row] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.jobId, jobId), eq(documentsTable.type, CHAT_TYPE)))
    .orderBy(desc(documentsTable.id))
    .limit(1);
  const messages = (row?.contentJson as { messages?: unknown } | null)?.messages;
  return normaliseChatMessages(messages);
}

/** Persist (replace) the advice-chat transcript for a job. Empty → clears it. */
export async function saveChat(jobId: number, messages: ChatTurn[]): Promise<void> {
  const clean = normaliseChatMessages(messages);
  await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.jobId, jobId), eq(documentsTable.type, CHAT_TYPE)));
  if (clean.length === 0) return;
  await db
    .insert(documentsTable)
    .values({ jobId, type: CHAT_TYPE, contentJson: { messages: clean } });
}

/** Delete the saved transcript for a job, plus any attachment objects it holds. */
export async function clearChat(jobId: number): Promise<void> {
  const existing = await loadChat(jobId);
  const keys = existing
    .flatMap((t) => t.attachments ?? [])
    .map((a) => a.objectKey)
    .filter((k): k is string => Boolean(k));
  await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.jobId, jobId), eq(documentsTable.type, CHAT_TYPE)));
  // Best-effort — deleteObject already swallows/logs its own failures.
  await Promise.all(keys.map((k) => deleteObject(k)));
}

/**
 * Format a saved chat into a grounding block for the generation prompts. The
 * framing is deliberately conservative: the coach's advice is guidance, not
 * fact, and nothing may be invented beyond the resume. Attached files the
 * candidate shared are included as context too. Returns "" if empty.
 */
export function formatCoachingNotes(messages: ChatTurn[]): string {
  if (!messages.length) return "";
  const transcript = messages
    .map((m) => {
      const who = m.role === "user" ? "CANDIDATE" : "COACH";
      const files = (m.attachments ?? [])
        .map((a) =>
          a.kind === "text" && a.text
            ? `\n[Attached file: ${a.name}]\n${a.text}`
            : `\n[Attached file: ${a.name} (${a.kind})]`,
        )
        .join("");
      return `${who}: ${m.content}${files}`;
    })
    .join("\n\n");
  return [
    "PRIOR COACHING CONVERSATION — the candidate's advice chat with their recruiter/coach about this role, including any files they attached.",
    "Use it ONLY to better understand the candidate's real situation, priorities, and any TRUE facts they stated about themselves (context, motivations, clarifications).",
    "Treat the coach's suggestions as guidance, not as new facts. NEVER invent experience, employers, dates, or achievements the resume doesn't support.",
    "",
    transcript,
  ].join("\n");
}
