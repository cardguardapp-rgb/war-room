import { api, ApiError } from "./api";

// Live speech-to-text in the browser through AssemblyAI Universal Streaming
// (v3). The server mints a short-lived token (the API key never reaches the
// browser); we open the WebSocket with it and stream the microphone as 16-bit
// PCM in ~100ms chunks from an AudioWorklet. AssemblyAI sends "Turn" messages:
// each turn's transcript grows while it's spoken and is final once
// end_of_turn is true. The answer is every turn joined in order.

export interface LiveTranscript {
  /** Text from finished turns. */
  final: string;
  /** The turn still being spoken (may change). */
  partial: string;
}

export interface Transcriber {
  /** Stop listening, let the last words finish, and return the whole transcript. */
  stop(): Promise<string>;
  /** Stop at once and discard. */
  cancel(): void;
}

// Runs on the audio thread: Float32 samples → Int16 PCM, posted every ~100ms.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Int16Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.size) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm16", Pcm16);
`;

function micError(err: unknown): Error {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new Error("Microphone access is blocked. Allow it for this site in the address bar, then try again.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new Error("No microphone was found.");
  }
  if (name === "NotReadableError") {
    return new Error("The microphone is in use by another app.");
  }
  return new Error("Couldn't start the microphone.");
}

/**
 * Open the microphone and a streaming session. Call from a click handler (the
 * AudioContext needs a user gesture). `onUpdate` fires as words arrive;
 * `onDrop` fires if the connection ends before stop().
 */
export async function startTranscriber(opts: {
  onUpdate: (t: LiveTranscript) => void;
  onDrop: (message: string) => void;
}): Promise<Transcriber> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser can't use the microphone here (it needs https).");
  }
  // Ask for the mic and the token at the same time.
  const tokenPromise = api.speech.token();
  tokenPromise.catch(() => {}); // handled below; avoid an unhandled rejection if the mic fails first
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    throw micError(err);
  }

  let ctx: AudioContext | null = null;
  let ws: WebSocket | null = null;
  const stopMic = () => mic.getTracks().forEach((t) => t.stop());
  try {
    const token = await tokenPromise;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext(); // AssemblyAI is told whatever rate this runs at
    }
    await ctx.resume();
    const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const source = ctx.createMediaStreamSource(mic);
    const node = new AudioWorkletNode(ctx, "pcm16");
    source.connect(node);
    node.connect(ctx.destination); // outputs silence; keeps the node pulled

    // Turns by turn_order: the latest transcript for each, and whether it's final.
    const turns = new Map<number, { text: string; final: boolean }>();
    const ordered = () => [...turns.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
    const all = () => ordered().map((t) => t.text).filter(Boolean).join(" ").trim();
    const update = () => {
      const list = ordered();
      opts.onUpdate({
        final: list.filter((t) => t.final).map((t) => t.text).filter(Boolean).join(" "),
        partial: list.filter((t) => !t.final).map((t) => t.text).filter(Boolean).join(" "),
      });
    };

    const socket = new WebSocket(`${token.ws_url}&sample_rate=${ctx.sampleRate}`);
    ws = socket;
    socket.binaryType = "arraybuffer";
    const pending: ArrayBuffer[] = [];
    let stopping = false;
    let terminated: () => void = () => {};
    const finished = new Promise<void>((resolve) => (terminated = resolve));

    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (stopping) return;
      if (socket.readyState === WebSocket.OPEN) socket.send(e.data);
      else if (socket.readyState === WebSocket.CONNECTING && pending.length < 50) pending.push(e.data);
    };
    socket.onopen = () => {
      for (const chunk of pending.splice(0)) socket.send(chunk);
    };
    socket.onmessage = (e) => {
      let msg: { type?: string; turn_order?: number; transcript?: string; end_of_turn?: boolean };
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "Turn" && typeof msg.turn_order === "number") {
        turns.set(msg.turn_order, { text: (msg.transcript ?? "").trim(), final: !!msg.end_of_turn });
        update();
      } else if (msg.type === "Termination") {
        terminated();
      }
    };
    socket.onclose = (e) => {
      terminated();
      if (!stopping) {
        teardown();
        opts.onDrop(
          e.reason
            ? `Speech-to-text stopped: ${e.reason}`
            : "The speech connection dropped. What was heard so far is kept.",
        );
      }
    };

    const audioCtx = ctx;
    const teardown = () => {
      stopping = true;
      stopMic();
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      void audioCtx.close().catch(() => {});
    };

    return {
      async stop() {
        if (stopping) return all();
        teardown();
        if (socket.readyState === WebSocket.OPEN) {
          // Terminate makes AssemblyAI finish the last turn, then send Termination.
          socket.send(JSON.stringify({ type: "Terminate" }));
          await Promise.race([finished, new Promise((r) => setTimeout(r, 4000))]);
        }
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
        return all();
      },
      cancel() {
        if (stopping) return;
        teardown();
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
        socket.close();
      },
    };
  } catch (err) {
    stopMic();
    ws?.close();
    void ctx?.close().catch(() => {});
    if (err instanceof ApiError) throw err;
    throw err instanceof Error ? err : new Error("Couldn't start speech-to-text.");
  }
}
