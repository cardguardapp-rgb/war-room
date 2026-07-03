import { Router, type IRouter } from "express";
import { db, type DiscoverSettingsRow } from "../lib/db";
import { aiErrorResponse } from "../lib/anthropic";
import {
  DEFAULT_DISCOVER_SETTINGS,
  normaliseSettings,
  runDiscover,
  type DiscoverSettings,
} from "../lib/discover";
import { TavilyConfigError, TavilyRequestError } from "../lib/tavily";

const router: IRouter = Router();

function loadSettings(): DiscoverSettings {
  const row = db
    .prepare("SELECT * FROM discover_settings WHERE id = 1")
    .get() as DiscoverSettingsRow | undefined;
  if (!row?.settings_json) return DEFAULT_DISCOVER_SETTINGS;
  try {
    return normaliseSettings(JSON.parse(row.settings_json));
  } catch {
    return DEFAULT_DISCOVER_SETTINGS;
  }
}

function saveSettings(settings: DiscoverSettings): void {
  db.prepare(
    `INSERT INTO discover_settings (id, settings_json, updated_at)
     VALUES (1, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = datetime('now')`,
  ).run(JSON.stringify(settings));
}

function dismissedSet(): Set<string> {
  const rows = db.prepare("SELECT url FROM discover_dismissed").all() as {
    url: string;
  }[];
  return new Set(rows.map((r) => r.url));
}

/** Map Discover-specific errors (Tavily) to HTTP, falling back to the AI mapper. */
function discoverErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof TavilyConfigError) return { status: 503, error: err.message };
  if (err instanceof TavilyRequestError) return { status: err.status, error: err.message };
  return aiErrorResponse(err);
}

// --- Settings -----------------------------------------------------------

router.get("/discover/settings", (_req, res): void => {
  res.json(loadSettings());
});

router.put("/discover/settings", (req, res): void => {
  const settings = normaliseSettings(req.body);
  saveSettings(settings);
  res.json(settings);
});

// --- Search -------------------------------------------------------------

router.post("/discover/search", async (req, res): Promise<void> => {
  // Optional inline settings override; otherwise use what's saved.
  const settings =
    req.body && typeof req.body === "object" && Object.keys(req.body).length > 0
      ? normaliseSettings(req.body)
      : loadSettings();

  const dismissed = dismissedSet();

  try {
    const run = await runDiscover(settings, (url) => dismissed.has(url));
    res.json({
      results: run.results,
      counts: { raw: run.rawCount, screened: run.screenedCount, kept: run.results.length },
      note: "Search results are indicative — Tavily and AI screening won't surface every listing, and some matches may still be off. Always open the original posting to confirm.",
    });
  } catch (err) {
    const mapped = discoverErrorResponse(err);
    req.log.error({ err }, "Discover search failed");
    res.status(mapped.status).json({ error: mapped.error });
  }
});

// --- Dismiss ------------------------------------------------------------

router.post("/discover/dismiss", (req, res): void => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || url.trim().length === 0) {
    res.status(400).json({ error: "A url is required" });
    return;
  }
  db.prepare(
    "INSERT OR IGNORE INTO discover_dismissed (url) VALUES (?)",
  ).run(url.trim());
  res.status(201).json({ dismissed: true });
});

export default router;
