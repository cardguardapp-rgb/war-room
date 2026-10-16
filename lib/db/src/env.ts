import fs from "node:fs";
import path from "node:path";

/** The local development database. Locally, nothing else may be used. */
export const DEV_DATABASE_NAME = "warroom-dev";

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

/** The database name in a Postgres connection string, or null if it can't be read. */
export function databaseNameFromUrl(url: string): string | null {
  try {
    const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return name || null;
  } catch {
    return null;
  }
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
 * Locally, refuse any database other than warroom-dev, so nothing run on the
 * laptop (server, smoke tests, drizzle-kit) can touch the production database.
 */
export function assertLocalDatabase(url: string | undefined): void {
  if (!isLocalDev() || !url) return;
  const name = databaseNameFromUrl(url);
  if (name !== DEV_DATABASE_NAME) {
    throw new Error(
      `Local development only uses the "${DEV_DATABASE_NAME}" database, but DATABASE_URL points at "${name ?? "unknown"}". Fix DATABASE_URL in .env.`,
    );
  }
}

loadLocalEnv();
