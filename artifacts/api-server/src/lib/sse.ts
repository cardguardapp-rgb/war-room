import type { Request, Response } from "express";

// Server-sent events over a normal POST response. The client reads it with
// fetch + a stream reader (EventSource can't POST or send files).
//
// Proxies (Replit's router, nginx-style buffers) can hold a response back
// until it's "big enough" or finished. To defeat that: no-transform and
// X-Accel-Buffering: no, headers flushed at once, an opening padding comment,
// and a heartbeat comment every 15s.

const HEARTBEAT_MS = 15_000;

export interface SseStream {
  /** Send one event; data is JSON-encoded. No-op once closed. */
  send(event: string, data: unknown): void;
  /** End the response. Safe to call more than once. */
  close(): void;
  /** True once the client has gone away. */
  readonly clientGone: boolean;
}

/** True when the request asked for an event stream. */
export function wantsEventStream(req: Request): boolean {
  return (req.headers.accept ?? "").includes("text/event-stream");
}

export function openSse(req: Request, res: Response): SseStream {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // ~2KB of padding pushes past any small first-chunk buffer.
  res.write(`:${" ".repeat(2048)}\n\n`);

  let closed = false;
  let clientGone = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    res.end();
  };
  // "close" on the response fires when the connection ends before we do.
  res.on("close", () => {
    if (!closed) clientGone = true;
    close();
  });

  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
    get clientGone() {
      return clientGone;
    },
  };
}
