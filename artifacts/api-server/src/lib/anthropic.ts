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
 * Run a single request (adaptive thinking, streaming, effort high) whose
 * response should be a JSON object, and return the parsed value. Retries once
 * on malformed JSON. Used by the cover-letter and application-question flows.
 */
export async function opusJson(
  system: string,
  userContent: string,
  model: string,
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

/** A base64-encoded image to send to a vision model. */
export interface ImageInput {
  /** e.g. "image/png", "image/jpeg", "image/webp", "image/gif". */
  mediaType: string;
  /** The image bytes, base64-encoded (no data: prefix). */
  dataBase64: string;
}

/**
 * Non-streaming JSON request over one or more IMAGES plus an instruction. Used
 * to transcribe + classify a job posting from screenshot(s). Retries once on
 * malformed JSON.
 */
export async function createJsonFromImages<T = unknown>(opts: {
  model: string;
  system: string;
  user: string;
  images: ImageInput[];
  maxTokens?: number;
}): Promise<T> {
  const client = getAnthropic();
  const content = [
    ...opts.images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mediaType,
        data: img.dataBase64,
      },
    })),
    { type: "text" as const, text: opts.user },
  ];
  return parseJsonWithRetry<T>(async () => {
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      // Cast: the mixed image/text content block array is valid at the API but
      // trips the SDK's overloaded typing here.
      messages: [{ role: "user", content: content as unknown as string }],
    });
    return messageText(message);
  });
}

export interface ChatMessage {
  role: "user" | "assistant";
  /** Plain text, or an array of content blocks (image/document/text). */
  content: string | unknown[];
}

/**
 * Run a plain-text (non-JSON) multi-turn chat completion and return the reply
 * text. The system prompt is cached (ephemeral) since the grounding context is
 * re-sent on every turn. Used by the role-advice chat.
 */
export async function chatComplete(opts: {
  system: string;
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getAnthropic();
  const message = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    // Cast: `content` may be a mixed image/document/text block array, which is
    // valid at the API but trips the SDK's overloaded typing here.
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content as unknown as string,
    })),
  });
  return messageText(message);
}

/** Thrown when the model declines to answer (stop_reason "refusal"). */
export class AiRefusalError extends Error {
  constructor() {
    super("The AI declined to answer that. Try rephrasing the question.");
    this.name = "AiRefusalError";
  }
}

export interface ChatStreamResult {
  text: string;
  model: string;
  /** Milliseconds from sending the request to the first word of the reply. */
  firstWordMs: number | null;
  totalMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/**
 * Stream a plain-text multi-turn chat reply, calling `onText` with each piece
 * as it's written. Caching: the system prompt (persona + grounding context)
 * has its own breakpoint, and top-level automatic caching covers the growing
 * conversation, so from the second message on both are read from the cache.
 * `extraParams` carries model-specific fields (see chatModelParams).
 */
export async function streamChat(opts: {
  system: string;
  messages: ChatMessage[];
  model: string;
  maxTokens?: number;
  extraParams?: Record<string, unknown>;
  onText: (text: string) => void;
}): Promise<ChatStreamResult> {
  const client = getAnthropic();
  const started = Date.now();
  let firstWordMs: number | null = null;
  const params = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    cache_control: { type: "ephemeral" },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    ...opts.extraParams,
  } as unknown as Anthropic.MessageStreamParams;
  const stream = client.messages.stream(params);
  stream.on("text", (delta) => {
    if (firstWordMs === null && delta.trim() !== "") firstWordMs = Date.now() - started;
    opts.onText(delta);
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new AiRefusalError();
  const usage = message.usage as Anthropic.Usage;
  return {
    text: messageText(message),
    model: message.model,
    firstWordMs,
    totalMs: Date.now() - started,
    inputTokens: usage.input_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    outputTokens: usage.output_tokens,
  };
}

/**
 * Pull the human-readable message out of an Anthropic API error body. The SDK
 * stores the parsed response body on `err.error`, which is shaped like
 * `{ type: "error", error: { type, message } }`. Returns "" if nothing usable.
 */
function anthropicApiMessage(err: unknown): string {
  const body = (err as { error?: unknown }).error as
    | { message?: unknown; error?: { message?: unknown } }
    | undefined;
  const msg = body?.error?.message ?? body?.message;
  return typeof msg === "string" ? msg.trim() : "";
}

/** Map an error from the AI layer to an HTTP status + user-facing message. */
export function aiErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof AiConfigError) {
    return { status: 503, error: err.message };
  }
  if (err instanceof AiJsonError || err instanceof AiRefusalError) {
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
    const apiMessage = anthropicApiMessage(err);
    // A low-balance/billing 400 isn't a code problem — surface it plainly so the
    // user knows to top up their Anthropic credits rather than debug the app.
    if (/credit|billing|balance|quota/i.test(apiMessage)) {
      return {
        status: 503,
        error: `Anthropic API: ${apiMessage}`,
      };
    }
    // Otherwise pass through the API's own explanation when we have one.
    return {
      status: 502,
      error: apiMessage
        ? `The AI request failed: ${apiMessage}`
        : `The AI request failed (${err.status ?? "network error"}). Please try again.`,
    };
  }
  if (err instanceof Error) return { status: 500, error: err.message };
  return { status: 500, error: "An unexpected error occurred." };
}
