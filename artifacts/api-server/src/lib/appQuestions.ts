import { opusJson } from "./anthropic";
import { APP_QUESTIONS_SYSTEM } from "./prompts";
import type { ResumeJson } from "./resumeParser";
import type { ClarifyingQuestion, QaPair } from "./tailor";

export interface DraftedAnswer {
  question: string;
  answer: string;
}

export interface AppQuestionsResult {
  clarifying_questions: ClarifyingQuestion[];
  answers: DraftedAnswer[];
}

export interface AppQuestionsInput {
  mode: "initial" | "finalize";
  postingText: string;
  resumeJson: ResumeJson;
  extraAnswers: unknown;
  /** The application questions the candidate pasted (may be multi-line). */
  questions: string;
  /** finalize: answers to the clarifying questions the model asked. */
  answers?: QaPair[];
  /** Optional grounding from the saved role-advice chat (see chatStore). */
  coachingNotes?: string;
}

function buildUserContent(input: AppQuestionsInput): string {
  const parts: string[] = [];
  if (input.postingText.trim()) parts.push(`JOB POSTING:\n${input.postingText.trim()}`);
  parts.push(
    `\n\nCANDIDATE RESUME (JSON) — factual ground truth:\n${JSON.stringify(input.resumeJson)}`,
  );
  parts.push(`\n\nEXTRA ANSWERS (JSON):\n${JSON.stringify(input.extraAnswers ?? [])}`);
  if (input.coachingNotes?.trim()) {
    parts.push(`\n\n${input.coachingNotes.trim()}`);
  }
  parts.push(`\n\nAPPLICATION QUESTIONS to answer:\n${input.questions.trim()}`);

  if (input.mode === "finalize" && input.answers?.length) {
    parts.push(
      `\n\nANSWERS to your clarifying questions (new TRUE facts to use):\n${input.answers
        .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
        .join("\n\n")}`,
    );
    parts.push(`\n\nNow draft the application answers using these facts. Do not ask the same questions again.`);
  }

  return parts.join("");
}

function normalise(raw: unknown): AppQuestionsResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ansRaw = Array.isArray(r["answers"]) ? (r["answers"] as Record<string, unknown>[]) : [];
  const answers: DraftedAnswer[] = ansRaw
    .map((a) => ({
      question: String(a?.["question"] ?? "").trim(),
      answer: String(a?.["answer"] ?? "").trim(),
    }))
    .filter((a) => a.question.length > 0 && a.answer.length > 0);

  const cqRaw = Array.isArray(r["clarifying_questions"])
    ? (r["clarifying_questions"] as Record<string, unknown>[])
    : [];
  const clarifying_questions: ClarifyingQuestion[] = cqRaw
    .map((q) => ({
      question: String(q?.["question"] ?? "").trim(),
      why: String(q?.["why"] ?? "").trim(),
      affects: String(q?.["affects"] ?? "").trim(),
    }))
    .filter((q) => q.question.length > 0);

  return { clarifying_questions, answers };
}

export async function runAppQuestions(input: AppQuestionsInput): Promise<AppQuestionsResult> {
  const raw = await opusJson(APP_QUESTIONS_SYSTEM, buildUserContent(input));
  return normalise(raw);
}
