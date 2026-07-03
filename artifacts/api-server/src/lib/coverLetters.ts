import { opusJson } from "./anthropic";
import { COVER_LETTER_SYSTEM } from "./prompts";
import type { ResumeJson } from "./resumeParser";
import type { ClarifyingQuestion, QaPair } from "./tailor";

export interface CoverLetterFull {
  salutation: string;
  re: string;
  body: string;
}

export interface CoverLetterResult {
  clarifying_questions: ClarifyingQuestion[];
  full: CoverLetterFull;
  short: string;
}

export interface CoverLetterInput {
  mode: "initial" | "finalize" | "revise";
  postingText: string;
  resumeJson: ResumeJson;
  extraAnswers: unknown;
  answers?: QaPair[];
  editRequest?: string;
  current?: CoverLetterResult;
}

function buildUserContent(input: CoverLetterInput): string {
  const parts: string[] = [];
  parts.push(`JOB POSTING:\n${input.postingText.trim()}`);
  parts.push(
    `\n\nCANDIDATE RESUME (JSON) — the candidate's tailored resume; factual ground truth:\n${JSON.stringify(
      input.resumeJson,
    )}`,
  );
  parts.push(`\n\nEXTRA ANSWERS (JSON):\n${JSON.stringify(input.extraAnswers ?? [])}`);

  if (input.mode === "finalize") {
    if (input.answers?.length) {
      parts.push(
        `\n\nANSWERS to your clarifying questions (new TRUE facts):\n${input.answers
          .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
          .join("\n\n")}`,
      );
    }
    if (input.current) {
      parts.push(`\n\nYour CURRENT DRAFT (JSON):\n${JSON.stringify({ full: input.current.full, short: input.current.short })}`);
    }
    parts.push(`\n\nIncorporate the answers and return the finished letters. Run your self-check again.`);
  }

  if (input.mode === "revise") {
    if (input.current) {
      parts.push(`\n\nYour CURRENT DRAFT (JSON):\n${JSON.stringify({ full: input.current.full, short: input.current.short })}`);
    }
    parts.push(
      `\n\nEDIT REQUEST — apply this to the current draft, keeping every rule, then run your self-check again:\n${input.editRequest ?? ""}`,
    );
  }

  return parts.join("");
}

function normalise(raw: unknown, input: CoverLetterInput): CoverLetterResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const fullRaw = (r["full"] ?? {}) as Record<string, unknown>;
  const fallback = input.current;
  const full: CoverLetterFull = {
    salutation: String(fullRaw["salutation"] ?? fallback?.full.salutation ?? "Dear Hiring Manager"),
    re: String(fullRaw["re"] ?? fallback?.full.re ?? ""),
    body: String(fullRaw["body"] ?? fallback?.full.body ?? ""),
  };
  const short = typeof r["short"] === "string" ? (r["short"] as string) : fallback?.short ?? "";

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

  return { clarifying_questions, full, short };
}

export async function runCoverLetters(input: CoverLetterInput): Promise<CoverLetterResult> {
  const raw = await opusJson(COVER_LETTER_SYSTEM, buildUserContent(input));
  return normalise(raw, input);
}
