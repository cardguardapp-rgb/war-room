import fs from "node:fs";
import path from "node:path";

/** True on Replit (workspace or deployment), where Replit Secrets supply the env. */
export function isReplit(): boolean {
  return Boolean(process.env["REPL_ID"] || process.env["REPLIT_DEPLOYMENT"]);
}

/** True when running on the local machine in development (not Replit, not production). */
export function isLocalDev(): boolean {
  return !isReplit() && process.env["NODE_ENV"] !== "production";
}

/** Walk up from `start` to the monorepo root (the folder holding pnpm-workspace.yaml). */
export function findRepoRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The Neon endpoint a host points at, for comparison: lower-cased, port
 * dropped, and "-pooler" removed from the first label so the pooled and direct
 * hosts of one endpoint match. Accepts a bare host or a full connection string.
 */
export function normaliseDbHost(value: string): string | null {
  let host = value.trim();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.split("/")[0]!.split(":")[0]!.toLowerCase();
  if (!host) return null;
  const [first, ...rest] = host.split(".");
  return [first!.replace(/-pooler$/, ""), ...rest].join(".");
}

let loaded = false;

/**
 * Load the repo-root `.env` in local development only. Production and Replit
 * keep reading Replit Secrets. Variables already set in the environment win.
 */
export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;
  if (!isLocalDev()) return;
  const root = findRepoRoot();
  if (!root) return;
  const file = path.join(root, ".env");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

/**
 * Locally, refuse any database except the warroom-dev Neon endpoint named by
 * DEV_DATABASE_HOST, so nothing run on the laptop (server, smoke tests,
 * drizzle-kit, backup import) can touch the production database. Database
 * names can't tell them apart (both are Neon's default "neondb"); the endpoint
 * host can. Missing DEV_DATABASE_HOST also refuses.
 */
export function assertLocalDatabase(url: string | undefined): void {
  if (!isLocalDev() || !url) return;
  const expected = normaliseDbHost(process.env["DEV_DATABASE_HOST"] ?? "");
  if (!expected) {
    throw new Error(
      "DEV_DATABASE_HOST is not set in .env. Locally, the database host must be named there before anything connects.",
    );
  }
  const actual = normaliseDbHost(url);
  if (actual !== expected) {
    throw new Error(
      `DATABASE_URL points at host "${actual ?? "unknown"}", not the warroom-dev host in DEV_DATABASE_HOST. Refusing to connect.`,
    );
  }
}

loadLocalEnv();
