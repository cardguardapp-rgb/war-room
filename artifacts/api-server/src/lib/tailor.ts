import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, messageText, parseJsonFromText } from "./anthropic";
import { TAILOR_MODEL, TAILOR_SYSTEM } from "./prompts";
import type { ResumeJson } from "./resumeParser";

export interface ClarifyingQuestion {
  question: string;
  why: string;
  affects: string;
}

export interface RecruiterFeedback {
  rejection_risks: string[];
  ats_gaps: string[];
  overall: string;
}

export interface TailorResult {
  proposed_resume: ResumeJson;
  clarifying_questions: ClarifyingQuestion[];
  recruiter_feedback: RecruiterFeedback;
}

export interface QaPair {
  question: string;
  answer: string;
}

export interface TailorInput {
  mode: "initial" | "finalize" | "revise";
  postingText: string;
  /** The candidate's real, factual base resume — always ground truth. */
  resumeJson: ResumeJson;
  extraAnswers: unknown;
  /** finalize: answers to the clarifying questions. */
  answers?: QaPair[];
  /** revise: the free-text edit the candidate asked for. */
  editRequest?: string;
  /** finalize/revise: the current proposed resume to refine. */
  currentResume?: ResumeJson;
}

function buildUserContent(input: TailorInput): string {
  const parts: string[] = [];
  parts.push(`JOB POSTING:\n${input.postingText.trim()}`);
  parts.push(
    `\n\nCANDIDATE RESUME (JSON) — the candidate's real, factual resume; this is ground truth. Never contradict or exceed it, EXTRA ANSWERS, or the candidate's ANSWERS:\n${JSON.stringify(
      input.resumeJson,
    )}`,
  );
  parts.push(
    `\n\nEXTRA ANSWERS (JSON) — additional true facts about the candidate:\n${JSON.stringify(
      input.extraAnswers ?? [],
    )}`,
  );

  if (input.mode === "finalize") {
    if (input.answers?.length) {
      parts.push(
        `\n\nANSWERS to your clarifying questions (new TRUE facts to incorporate):\n${input.answers
          .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
          .join("\n\n")}`,
      );
    }
    if (input.currentResume) {
      parts.push(
        `\n\nYour CURRENT PROPOSED RESUME (JSON) to refine:\n${JSON.stringify(
          input.currentResume,
        )}`,
      );
    }
    parts.push(
      `\n\nIncorporate the answers, then reword to the writing-quality standard (clean, grammatical, one idea per bullet, no run-on sentences or comma splices) and run the RECRUITER REVIEW PASS — including the final PROOFREAD step — again on this version. Do not ask the same questions again.`,
    );
  }

  if (input.mode === "revise") {
    if (input.currentResume) {
      parts.push(
        `\n\nYour CURRENT PROPOSED RESUME (JSON):\n${JSON.stringify(
          input.currentResume,
        )}`,
      );
    }
    parts.push(
      `\n\nEDIT REQUEST — apply this specific change to the current proposed resume, keeping every rule, then run the RECRUITER REVIEW PASS (including the final PROOFREAD step) again so the result stays clean and grammatical:\n${input.editRequest ?? ""}`,
    );
  }

  return parts.join("");
}

function normaliseResult(raw: unknown, input: TailorInput): TailorResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const proposedRaw = r["proposed_resume"] as
    | { version?: number; sections?: unknown }
    | undefined;
  const sections =
    proposedRaw && Array.isArray(proposedRaw.sections)
      ? (proposedRaw.sections as ResumeJson["sections"])
      : (input.currentResume ?? input.resumeJson).sections;

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

  const rf = (r["recruiter_feedback"] ?? {}) as Record<string, unknown>;
  const toStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

  return {
    proposed_resume: { version: 1, sections },
    clarifying_questions,
    recruiter_feedback: {
      rejection_risks: toStrArr(rf["rejection_risks"]),
      ats_gaps: toStrArr(rf["ats_gaps"]),
      overall: typeof rf["overall"] === "string" ? (rf["overall"] as string) : "",
    },
  };
}

export async function runTailor(input: TailorInput): Promise<TailorResult> {
  const client = getAnthropic();
  const params = {
    model: TAILOR_MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [
      {
        type: "text",
        text: TAILOR_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildUserContent(input) }],
    // `thinking` / `output_config` are current-model params; cast to keep the
    // build resilient to SDK typing drift.
  } as unknown as Anthropic.MessageStreamParams;

  const stream = client.messages.stream(params);
  const message = await stream.finalMessage();
  const raw = parseJsonFromText<unknown>(messageText(message));
  return normaliseResult(raw, input);
}
