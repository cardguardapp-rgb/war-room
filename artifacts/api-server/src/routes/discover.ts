import { Router, type IRouter } from "express";
import { db, eq, discoverSettingsTable, discoverDismissedTable } from "../lib/db";
import { aiErrorResponse } from "../lib/anthropic";
import {
  DEFAULT_DISCOVER_SETTINGS,
  normaliseSettings,
  runDiscover,
  type DiscoverSettings,
} from "../lib/discover";
import { TavilyConfigError, TavilyRequestError } from "../lib/tavily";

const router: IRouter = Router();

async function loadSettings(): Promise<DiscoverSettings> {
  const [row] = await db
    .select()
    .from(discoverSettingsTable)
    .where(eq(discoverSettingsTable.id, 1));
  if (!row?.settingsJson) return DEFAULT_DISCOVER_SETTINGS;
  try {
    return normaliseSettings(row.settingsJson);
  } catch {
    return DEFAULT_DISCOVER_SETTINGS;
  }
}

async function saveSettings(settings: DiscoverSettings): Promise<void> {
  await db
    .insert(discoverSettingsTable)
    .values({ id: 1, settingsJson: settings, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: discoverSettingsTable.id,
      set: { settingsJson: settings, updatedAt: new Date() },
    });
}

async function dismissedSet(): Promise<Set<string>> {
  const rows = await db.select({ url: discoverDismissedTable.url }).from(discoverDismissedTable);
  return new Set(rows.map((r) => r.url));
}

/** Map Discover-specific errors (Tavily) to HTTP, falling back to the AI mapper. */
function discoverErrorResponse(err: unknown): { status: number; error: string } {
  if (err instanceof TavilyConfigError) return { status: 503, error: err.message };
  if (err instanceof TavilyRequestError) return { status: err.status, error: err.message };
  return aiErrorResponse(err);
}

// --- Settings -----------------------------------------------------------

router.get("/discover/settings", async (_req, res): Promise<void> => {
  res.json(await loadSettings());
});

router.put("/discover/settings", async (req, res): Promise<void> => {
  const settings = normaliseSettings(req.body);
  await saveSettings(settings);
  res.json(settings);
});

// --- Search -------------------------------------------------------------

router.post("/discover/search", async (req, res): Promise<void> => {
  // Optional inline settings override; otherwise use what's saved.
  const settings =
    req.body && typeof req.body === "object" && Object.keys(req.body).length > 0
      ? normaliseSettings(req.body)
      : await loadSettings();

  const dismissed = await dismissedSet();

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

router.post("/discover/dismiss", async (req, res): Promise<void> => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || url.trim().length === 0) {
    res.status(400).json({ error: "A url is required" });
    return;
  }
  await db.insert(discoverDismissedTable).values({ url: url.trim() }).onConflictDoNothing();
  res.status(201).json({ dismissed: true });
});

export default router;
