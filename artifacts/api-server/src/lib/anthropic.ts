import Anthropic from "@anthropic-ai/sdk";

/** Thrown when AI features are used but ANTHROPIC_API_KEY isn't configured. */
export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

/** Thrown when the model's response can't be parsed as JSON even after a retry. */
export class AiJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiJsonError";
  }
}

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new AiConfigError(
      "ANTHROPIC_API_KEY is not set. Add it in Replit Secrets and restart the app to enable AI features.",
    );
  }
  if (!cached) cached = new Anthropic({ apiKey });
  return cached;
}

/** Concatenate the text blocks of a Message, ignoring thinking/other blocks. */
export function messageText(message: Anthropic.Message): string {
  return message.content
    .filter(
      (b): b is Anthropic.TextBlock =>
        b.type === "text" && typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("");
}

/**
 * Pull a JSON value out of a model response that should be pure JSON but might
 * arrive wrapped in ```json fences or with stray leading/trailing prose.
 */
export function parseJsonFromText<T>(text: string): T {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    const start = s.search(/[{[]/);
    const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1)) as T;
    }
    throw new Error("The AI response was not valid JSON.");
  }
}

/**
 * Call a model that should return JSON, parse it, and — if the model returns
 * malformed JSON — retry the call ONCE before giving up. `getText` performs one
 * fresh model request and returns its raw text. Throws `AiJsonError` if both
 * attempts fail to parse (so callers/`aiErrorResponse` can surface a clean 502).
 */
export async function parseJsonWithRetry<T>(
  getText: (attempt: number) => Promise<string>,
): Promise<T> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const text = await getText(attempt);
    try {
      return parseJsonFromText<T>(text);
    } catch {
      // Malformed JSON — loop to retry once, then fall through to the throw.
    }
  }
  throw new AiJsonError(
    "The AI returned a response we couldn't read. Please try again.",
  );
}

/**
 * Run a single Opus 4.8 request (adaptive thinking, streaming, effort high)
 * whose response should be a JSON object, and return the parsed value. Retries
 * once on malformed JSON. Used by the tailoring, cover-letter, and
 * application-question flows.
 */
export async function opusJson(
  system: string,
  userContent: string,
  model = "claude-opus-4-8",
): Promise<unknown> {
  const client = getAnthropic();
  const params = {
    model,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  } as unknown as Anthropic.MessageStreamParams;
  return parseJsonWithRetry<unknown>(async () => {
    const stream = client.messages.stream(params);
    const message = await stream.finalMessage();
    return messageText(message);
  });
}

/**
 * Non-streaming JSON request (used by the Sonnet extraction + Discover
 * classification). Retries once on malformed JSON.
 */
export async function createJson<T = unknown>(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  const client = getAnthropic();
  return parseJsonWithRetry<T>(async () => {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    return messageText(message);
  });
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Run a plain-text (non-JSON) multi-turn chat completion and return the reply
 * text. The system prompt is cached (ephemeral) since the grounding context is
 * re-sent on every turn. Used by the role-advice chat.
 */
export async function chatComplete(opts: {
  system: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getAnthropic();
  const message = await client.messages.create({
    model: opts.model ?? "claude-opus-4-8",
    max_tokens: opts.maxTokens ?? 2048,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return messageText(message);
}

/** Map an error from the AI layer to an HTTP status + user-facing message. */
export function aiErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof AiConfigError) {
    return { status: 503, error: err.message };
  }
  if (err instanceof AiJsonError) {
    return { status: 502, error: err.message };
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) {
      return {
        status: 503,
        error: "The ANTHROPIC_API_KEY appears to be invalid. Check the Replit Secret.",
      };
    }
    if (err.status === 429) {
      return {
        status: 429,
        error: "The AI service is rate limited right now. Please try again in a moment.",
      };
    }
    return {
      status: 502,
      error: `The AI request failed (${err.status ?? "network error"}). Please try again.`,
    };
  }
  if (err instanceof Error) return { status: 500, error: err.message };
  return { status: 500, error: "An unexpected error occurred." };
}
