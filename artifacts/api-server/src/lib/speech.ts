// Streaming speech-to-text through AssemblyAI (Universal Streaming, API v3).
//
// The API key stays on the server. The browser asks us for a temporary token
// (GET https://streaming.assemblyai.com/v3/token, authorised with the key),
// then opens the WebSocket itself with `?token=…` and streams raw 16-bit PCM.
// The token only works for opening a session within TOKEN_TTL_SECONDS, and the
// session it opens is capped at MAX_SESSION_SECONDS (billing is per second the
// socket is open, so a forgotten tab can't run up hours).

const TOKEN_URL = "https://streaming.assemblyai.com/v3/token";
const STREAM_URL = "wss://streaming.assemblyai.com/v3/ws";

/** How long the browser has to open the socket with the token. */
export const TOKEN_TTL_SECONDS = 60;
/** The longest one answer's session can run. */
export const MAX_SESSION_SECONDS = 900;

// Connection settings for the browser. sample_rate is added by the client
// (it's whatever its AudioContext actually runs at). Turn detection stays on
// its defaults: the client joins every turn into one answer, so where a turn
// ends doesn't matter.
const STREAM_PARAMS = {
  speech_model: "universal-3-6-pro",
  encoding: "pcm_s16le",
};

/** Thrown when ASSEMBLYAI_API_KEY isn't set or AssemblyAI rejects the request. */
export class SpeechError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SpeechError";
  }
}

export interface StreamingToken {
  /** The WebSocket URL with the token and settings; the client adds sample_rate. */
  ws_url: string;
  expires_in_seconds: number;
  max_session_seconds: number;
}

/** Mint a short-lived streaming token. Never returns or logs the API key. */
export async function mintStreamingToken(): Promise<StreamingToken> {
  const apiKey = process.env["ASSEMBLYAI_API_KEY"]?.trim();
  if (!apiKey) {
    throw new SpeechError(
      503,
      "ASSEMBLYAI_API_KEY is not set. Add it and restart the app to use voice.",
    );
  }
  const url = new URL(TOKEN_URL);
  url.search = new URLSearchParams({
    expires_in_seconds: String(TOKEN_TTL_SECONDS),
    max_session_duration_seconds: String(MAX_SESSION_SECONDS),
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SpeechError(502, "Couldn't reach the speech service. Try again.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new SpeechError(503, "The ASSEMBLYAI_API_KEY appears to be invalid.");
    }
    if (response.status === 429) {
      throw new SpeechError(429, "The speech service is rate limited. Try again in a moment.");
    }
    throw new SpeechError(502, `The speech service refused the request (${response.status}).`);
  }
  const body = (await response.json()) as { token?: unknown; expires_in_seconds?: unknown };
  if (typeof body.token !== "string" || !body.token) {
    throw new SpeechError(502, "The speech service didn't return a token.");
  }
  const ws = new URL(STREAM_URL);
  ws.search = new URLSearchParams({ ...STREAM_PARAMS, token: body.token }).toString();
  return {
    ws_url: ws.toString(),
    expires_in_seconds:
      typeof body.expires_in_seconds === "number" ? body.expires_in_seconds : TOKEN_TTL_SECONDS,
    max_session_seconds: MAX_SESSION_SECONDS,
  };
}
