// Persistence for the per-job role-advice chat. The transcript is stored as a
// single `documents` row (type "chat", contentJson `{ messages }`) per job — the
// same free-text-type trick used for "assessment", so no schema migration is
// needed. Saved chats survive page reloads AND feed context into future resume
// tailoring, cover letters and application answers for that role.

import { and, db, desc, documentsTable, eq } from "./db";
import type { ChatMessage } from "./anthropic";

const CHAT_TYPE = "chat";

/** Coerce stored/inbound chat JSON into a safe, bounded ChatMessage[]. */
export function normaliseChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const role = o["role"] === "assistant" ? "assistant" : "user";
      const content = String(o["content"] ?? "").trim().slice(0, 4000);
      return { role, content } as ChatMessage;
    })
    .filter((m) => m.content.length > 0)
    .slice(-40); // keep the saved transcript bounded
}

/** The saved advice-chat transcript for a job (empty array if none saved yet). */
export async function loadChat(jobId: number): Promise<ChatMessage[]> {
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
export async function saveChat(jobId: number, messages: ChatMessage[]): Promise<void> {
  const clean = normaliseChatMessages(messages);
  await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.jobId, jobId), eq(documentsTable.type, CHAT_TYPE)));
  if (clean.length === 0) return;
  await db
    .insert(documentsTable)
    .values({ jobId, type: CHAT_TYPE, contentJson: { messages: clean } });
}

/** Delete the saved advice-chat transcript for a job. */
export async function clearChat(jobId: number): Promise<void> {
  await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.jobId, jobId), eq(documentsTable.type, CHAT_TYPE)));
}

/**
 * Format a saved chat into a grounding block for the generation prompts. The
 * framing is deliberately conservative: the coach's advice is guidance, not
 * fact, and nothing may be invented beyond the resume. Returns "" if empty.
 */
export function formatCoachingNotes(messages: ChatMessage[]): string {
  if (!messages.length) return "";
  const transcript = messages
    .map((m) => `${m.role === "user" ? "CANDIDATE" : "COACH"}: ${m.content}`)
    .join("\n\n");
  return [
    "PRIOR COACHING CONVERSATION — the candidate's advice chat with their recruiter/coach about this role.",
    "Use it ONLY to better understand the candidate's real situation, priorities, and any TRUE facts they stated about themselves (context, motivations, clarifications).",
    "Treat the coach's suggestions as guidance, not as new facts. NEVER invent experience, employers, dates, or achievements the resume doesn't support.",
    "",
    transcript,
  ].join("\n");
}
