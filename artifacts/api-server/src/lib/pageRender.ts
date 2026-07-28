// Headless-Chromium page renderer. Some career / recruiter sites (e.g.
// blackroc.co) render their job listings entirely client-side, so a plain HTTP
// fetch returns an empty SPA shell and web-search indexes (Tavily) never see the
// individual postings. Rendering the page in headless Chromium runs that JS and
// gives us the real DOM — which is how Discover's "Pages to scan" sources and
// the SPA extraction fallback surface those roles.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { logger } from "./logger";

let cachedChromium: string | null | undefined;

/**
 * Resolve a Chromium binary. Prefers `CHROMIUM_PATH`, then a plain `chromium-*`
 * build in the nix store, then any `*chromium*` build. Result is cached (the
 * lookup scans the nix store, so we only pay it once). Returns null if none.
 */
export function resolveChromium(): string | null {
  if (cachedChromium !== undefined) return cachedChromium;

  const fromEnv = process.env["CHROMIUM_PATH"];
  if (fromEnv && existsSync(fromEnv)) {
    cachedChromium = fromEnv;
    return cachedChromium;
  }

  const store = "/nix/store";
  try {
    const entries = readdirSync(store).filter((n) => /chromium/i.test(n));
    // Prefer plain "chromium-<version>" over "ungoogled-chromium-<version>", and
    // higher versions first, so we render with the newest stable build present.
    const versionOf = (n: string): number => {
      const m = n.match(/chromium-(\d+)/i);
      return m ? Number(m[1]) : 0;
    };
    const ranked = entries.sort((a, b) => {
      const au = /ungoogled/i.test(a) ? 1 : 0;
      const bu = /ungoogled/i.test(b) ? 1 : 0;
      if (au !== bu) return au - bu; // non-ungoogled first
      return versionOf(b) - versionOf(a); // newer first
    });
    for (const name of ranked) {
      const bin = path.join(store, name, "bin", "chromium");
      if (existsSync(bin)) {
        cachedChromium = bin;
        return cachedChromium;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Chromium lookup failed");
  }
  cachedChromium = null;
  return cachedChromium;
}

export type RenderResult =
  | { ok: true; html: string }
  | { ok: false; reason: string };

/**
 * Render a URL in headless Chromium and return the final DOM (after JS runs).
 * `--dump-dom` prints the serialised document once the virtual-time budget is
 * spent. Best-effort: any failure resolves to ok:false rather than throwing, so
 * callers can fall back gracefully.
 */
export async function renderPageDom(
  url: string,
  opts: { timeoutMs?: number; virtualTimeMs?: number } = {},
): Promise<RenderResult> {
  const chromium = resolveChromium();
  if (!chromium) {
    return { ok: false, reason: "No headless browser is available on this host." };
  }
  const timeoutMs = opts.timeoutMs ?? 30000;
  const virtualTimeMs = opts.virtualTimeMs ?? 9000;
  // Isolated profile per call so parallel renders don't fight over a lock.
  const profileDir = path.join(os.tmpdir(), `chrome-${crypto.randomUUID()}`);

  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    `--user-data-dir=${profileDir}`,
    `--virtual-time-budget=${virtualTimeMs}`,
    "--run-all-compositor-stages-before-draw",
    "--dump-dom",
    url,
  ];

  return new Promise<RenderResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(chromium, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch (err) {
      logger.warn({ err, url }, "Chromium spawn failed");
      resolve({ ok: false, reason: "Could not start the headless browser." });
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    const MAX_BYTES = 8 * 1024 * 1024; // guard against a runaway page
    let settled = false;
    const finish = (r: RenderResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      resolve(r);
    };

    const timer = setTimeout(() => {
      logger.info({ url }, "Headless render timed out");
      // Whatever we captured so far is still usable if it's substantial.
      const html = Buffer.concat(chunks).toString("utf8");
      finish(
        html.length > 2000
          ? { ok: true, html }
          : { ok: false, reason: "The page took too long to render." },
      );
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      bytes += d.length;
      if (bytes <= MAX_BYTES) chunks.push(d);
      else finish({ ok: true, html: Buffer.concat(chunks).toString("utf8") });
    });
    child.on("error", (err) => {
      logger.warn({ err, url }, "Chromium process error");
      finish({ ok: false, reason: "The headless browser failed to run." });
    });
    child.on("close", () => {
      const html = Buffer.concat(chunks).toString("utf8");
      finish(
        html.length > 500
          ? { ok: true, html }
          : { ok: false, reason: "The page returned no rendered content." },
      );
    });
  });
}
