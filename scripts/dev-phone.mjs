// Local development: starts the API and the web app together, serves the web
// app over self-signed https on the local network (so the phone can reach it),
// and prints "War Room dev ready" once both answer.
// Run from the repo root: pnpm run dev:phone
import { spawn, execSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_PORT = 5175; // Amy's other apps use 5173
const API_PORT = 8090;

const children = [];
let shuttingDown = false;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repoRoot, "artifacts", "job-search-assistant");

function start(name, command, args, opts) {
  const child = spawn(command, args, {
    ...opts,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "development", ...opts.env },
  });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .map((line) => `[${name}] ${line}`)
      .join("\n") + "\n";
  child.stdout.on("data", (c) => process.stdout.write(prefix(c)));
  child.stderr.on("data", (c) => process.stderr.write(prefix(c)));
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[${name}] exited with code ${code}. Stopping.`);
    shutdown(1);
  });
  children.push(child);
}

function killTree(child) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // already gone
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function responds(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

async function waitUntilReady() {
  const apiUrl = `http://localhost:${API_PORT}/api/healthz`;
  const webUrl = `https://localhost:${WEB_PORT}/`;
  const startedAt = Date.now();
  let warned = false;
  while (!shuttingDown) {
    const [api, web] = await Promise.all([responds(apiUrl), responds(webUrl)]);
    if (api && web) {
      console.log("");
      console.log("War Room dev ready");
      console.log(`  Laptop: https://localhost:${WEB_PORT}`);
      for (const ip of lanAddresses()) console.log(`  Phone:  https://${ip}:${WEB_PORT}`);
      console.log("  Press Ctrl+C to stop.");
      console.log("");
      return;
    }
    if (!warned && Date.now() - startedAt > 120_000) {
      warned = true;
      console.warn(
        `Still waiting after 2 minutes (api: ${api ? "up" : "down"}, web: ${web ? "up" : "down"}).`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// The API goes through its pnpm "dev" script (build, then start).
start("api", "pnpm --filter @workspace/api-server run dev", [], {
  shell: true,
  cwd: repoRoot,
  env: { PORT: String(API_PORT) },
});
// Vite runs directly under Node, not through the pnpm script shell: Git Bash
// would rewrite BASE_PATH=/ into a Windows path ("C:/Program Files/Git/").
start(
  "web",
  process.execPath,
  [path.join(webDir, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.config.ts", "--host", "0.0.0.0"],
  {
    cwd: webDir,
    env: {
      PORT: String(WEB_PORT),
      BASE_PATH: "/",
      DEV_HTTPS: "1",
      API_PORT: String(API_PORT),
    },
  },
);
waitUntilReady();
