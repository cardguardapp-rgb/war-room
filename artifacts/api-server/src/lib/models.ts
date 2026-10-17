import { logger } from "./logger";

// Which Claude model each task uses. Every task reads its own AI_MODEL_*
// variable at call time and falls back to the default below, so setting one
// variable changes only that task. Each resolution is logged (task, model and
// whether it came from the environment), so the logs show what ran.
//
// Ask Amy before changing any default.

export type AiTask =
  | "extract"
  | "tailor"
  | "writing"
  | "chat"
  | "discover"
  | "website"
  | "skillGrouping"
  | "chatCompare";

interface ModelSetting {
  env: string;
  fallback: string;
  /** What the task is, for the startup log. */
  label: string;
}

export const MODEL_SETTINGS: Record<AiTask, ModelSetting> = {
  // Job extraction (URL/text/screenshots) + fit assessment: Amy chose Sonnet 4.6.
  extract: { env: "AI_MODEL_EXTRACT", fallback: "claude-sonnet-4-6", label: "job extraction + fit" },
  // Resume tailoring: the most capable model, for recruiter-review reasoning.
  tailor: { env: "AI_MODEL_TAILOR", fallback: "claude-opus-4-8", label: "resume tailoring" },
  // Cover letters + application-question answers.
  writing: { env: "AI_MODEL_WRITING", fallback: "claude-opus-4-8", label: "cover letters + app answers" },
  // Role-advice chat (the coach).
  chat: { env: "AI_MODEL_CHAT", fallback: "claude-opus-4-8", label: "role chat" },
  // Discover: classifying raw search hits.
  discover: { env: "AI_MODEL_DISCOVER", fallback: "claude-sonnet-4-6", label: "Discover classification" },
  // Personal-website copy.
  website: { env: "AI_MODEL_WEBSITE", fallback: "claude-opus-4-8", label: "website copy" },
  // Grouping skills for the .docx layout.
  skillGrouping: { env: "AI_MODEL_SKILL_GROUPING", fallback: "claude-sonnet-4-6", label: "skill grouping" },
  // Dev only: the faster model the side-by-side compares the coach against.
  chatCompare: { env: "AI_MODEL_CHAT_COMPARE", fallback: "claude-sonnet-5-5", label: "chat compare (dev only)" },
};

function resolve(task: AiTask): { model: string; source: "env" | "default" } {
  const setting = MODEL_SETTINGS[task];
  const fromEnv = process.env[setting.env]?.trim();
  return fromEnv
    ? { model: fromEnv, source: "env" }
    : { model: setting.fallback, source: "default" };
}

/** The model for a task, logged each time it's used. */
export function aiModel(task: AiTask): string {
  const { model, source } = resolve(task);
  logger.info({ task, model, source }, "AI model");
  return model;
}

/** Log every task's model once at startup. */
export function logModelSettings(): void {
  const production = process.env.NODE_ENV === "production";
  for (const task of Object.keys(MODEL_SETTINGS) as AiTask[]) {
    if (task === "chatCompare" && production) continue;
    const { model, source } = resolve(task);
    logger.info(
      { task, model, source, env: MODEL_SETTINGS[task].env },
      `Model for ${MODEL_SETTINGS[task].label}`,
    );
  }
}

/**
 * Extra request fields a chat model needs so that it answers without a long
 * silent think first. Today's coach (Opus 4.8) and Sonnet 4.6 don't think
 * unless asked, so they get nothing. Sonnet 5.5 thinks by default and can't
 * disable it the old way; "between_tools" turns it off.
 */
export function chatModelParams(model: string): Record<string, unknown> {
  if (model.startsWith("claude-sonnet-5-5")) {
    return { thinking: { type: "between_tools" } };
  }
  return {};
}
