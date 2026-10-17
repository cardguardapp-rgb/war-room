import type { ChatMessage } from "./anthropic";
import { MOCK_INTERVIEW_MODE } from "./prompts";
import type { InterviewPrep } from "./interviewPrep";

// Mock interview sessions (M4). Each session is its own `documents` row with
// type `mock_interview`, updated in place as it goes, so a job can have many
// and any of them can be reopened. The coach is CHAT_SYSTEM (unchanged) + the
// role's grounding + MOCK_INTERVIEW_MODE + the prep pack, all in one cached
// system prompt; the session's turns are the conversation.

export const MOCK_INTERVIEW_TYPE = "mock_interview";

export const MOCK_COUNTS = [3, 5, 8] as const;
const MAX_ANSWER_CHARS = 20_000;

/** One planned question, copied from the prep pack when the session starts. */
export interface MockPlanItem {
  question_id: string;
  question: string;
  story_id: string;
}

export interface MockTurn {
  /** How the coach put the question (spoken aloud). */
  asked: string;
  /** The transcribed (or typed) answer; "" until answered. */
  answer: string;
  answer_seconds: number | null;
  answer_words: number | null;
  /** The coach's feedback; "" until given. */
  feedback: string;
}

export interface MockInterview {
  version: 1;
  status: "in_progress" | "finished";
  started_at: string;
  finished_at: string | null;
  plan: MockPlanItem[];
  /** turns[i] answers plan[i]; only questions that have been asked are here. */
  turns: MockTurn[];
}

function str(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Coerce stored or inbound session JSON into a safe, bounded session. */
export function normaliseMockInterview(value: unknown): MockInterview {
  const o = (value ?? {}) as Record<string, unknown>;
  const plan = (Array.isArray(o["plan"]) ? o["plan"] : [])
    .map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return {
        question_id: str(r["question_id"], 40),
        question: str(r["question"], 1000),
        story_id: str(r["story_id"], 40),
      };
    })
    .filter((p) => p.question)
    .slice(0, 20);
  const turns = (Array.isArray(o["turns"]) ? o["turns"] : [])
    .map((t) => {
      const r = (t ?? {}) as Record<string, unknown>;
      return {
        asked: str(r["asked"], 2000),
        answer: str(r["answer"], MAX_ANSWER_CHARS),
        answer_seconds: num(r["answer_seconds"]),
        answer_words: num(r["answer_words"]),
        feedback: str(r["feedback"], 8000),
      };
    })
    .filter((t) => t.asked)
    .slice(0, plan.length);
  return {
    version: 1,
    status: o["status"] === "finished" ? "finished" : "in_progress",
    started_at: str(o["started_at"], 40) || new Date().toISOString(),
    finished_at: str(o["finished_at"], 40) || null,
    plan,
    turns,
  };
}

/** Pick `count` questions from the pack at random (Fisher–Yates), skipping blanks. */
export function planFromPack(pack: InterviewPrep, count: number, random = Math.random): MockPlanItem[] {
  const pool = pack.questions.filter((q) => q.question.trim());
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((q) => ({
    question_id: q.id,
    question: q.question,
    story_id: q.story_id,
  }));
}

export function newMockInterview(plan: MockPlanItem[]): MockInterview {
  return {
    version: 1,
    status: "in_progress",
    started_at: new Date().toISOString(),
    finished_at: null,
    plan,
    turns: [],
  };
}

/** Where the session is up to. */
export function mockStage(s: MockInterview):
  | { kind: "ask"; index: number }
  | { kind: "answer"; index: number }
  | { kind: "done" } {
  const last = s.turns[s.turns.length - 1];
  if (last && !last.feedback) return { kind: "answer", index: s.turns.length - 1 };
  if (s.turns.length < s.plan.length) return { kind: "ask", index: s.turns.length };
  return { kind: "done" };
}

export function cleanAnswer(raw: unknown): string {
  return str(raw, MAX_ANSWER_CHARS).replace(/\s+/g, " ");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The mode instruction + the prep pack, appended to the coach's system prompt. */
export function mockSystemSuffix(pack: InterviewPrep): string {
  return [
    "",
    MOCK_INTERVIEW_MODE,
    "",
    "INTERVIEW PREP PACK (JSON — built from the candidate's real sources):",
    JSON.stringify({ stories: pack.stories, questions: pack.questions, gaps: pack.gaps }),
  ].join("\n");
}

function askInstruction(s: MockInterview, index: number): string {
  const item = s.plan[index];
  return `[APP] Put question ${index + 1} of ${s.plan.length} to the candidate: "${item.question}"`;
}

function answerMessage(turn: MockTurn): string {
  const length =
    turn.answer_seconds !== null
      ? `${turn.answer_seconds} seconds, ${turn.answer_words ?? wordCount(turn.answer)} words`
      : `${turn.answer_words ?? wordCount(turn.answer)} words, typed`;
  return `[ANSWER] (${length})\n${turn.answer}`;
}

/**
 * The conversation so far, ending with the message the coach answers next:
 * the ask instruction for question `upTo`, or that question's answer.
 */
export function mockMessages(
  s: MockInterview,
  next: { kind: "ask" | "answer"; index: number },
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < next.index; i++) {
    const t = s.turns[i];
    messages.push({ role: "user", content: askInstruction(s, i) });
    messages.push({ role: "assistant", content: t.asked });
    messages.push({ role: "user", content: answerMessage(t) });
    messages.push({ role: "assistant", content: t.feedback });
  }
  messages.push({ role: "user", content: askInstruction(s, next.index) });
  if (next.kind === "answer") {
    const t = s.turns[next.index];
    messages.push({ role: "assistant", content: t.asked });
    messages.push({ role: "user", content: answerMessage(t) });
  }
  return messages;
}
