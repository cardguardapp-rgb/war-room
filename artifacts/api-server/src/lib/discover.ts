// Discover: turn the user's editable search parameters into Tavily queries,
// then classify the raw hits against those parameters with the AI.

import { createJson } from "./anthropic";
import { DISCOVER_CLASSIFY_SYSTEM, DISCOVER_MODEL } from "./prompts";
import { tavilySearchMany, type TavilyResult } from "./tavily";

export type WorkArrangement = "office" | "hybrid" | "remote" | "unknown";
export type MatchVerdict = "yes" | "no" | "unsure";

export interface DiscoverSettings {
  /** Target role titles / seniority levels to search for. */
  roleTitles: string[];
  /** Where an office/hybrid role must be located. */
  officeRegion: string;
  /** The rule for remote roles. */
  remoteRule: string;
  /** Things to exclude (junior roles, short contracts, relocation, …). */
  exclusions: string[];
  /** Optional extra keywords appended to every query. */
  extraKeywords: string;
}

export interface DiscoverResult {
  url: string;
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  seniority_match: MatchVerdict;
  location_match: MatchVerdict;
  reason: string;
}

// The defaults the user asked to be seeded with. Editable on the Discover page.
export const DEFAULT_DISCOVER_SETTINGS: DiscoverSettings = {
  roleTitles: [
    "Head of Product",
    "Director of Product",
    "Product Director",
    "VP Product",
    "Group Product Manager",
    "Chief Product Officer",
  ],
  officeRegion: "Between the Gold Coast and Brisbane, Queensland, Australia",
  remoteRule: "Full-time remote work from anywhere in Australia",
  exclusions: [
    "Junior or mid-level product manager roles",
    "Contract-only roles shorter than 6 months",
    "Roles requiring relocation",
  ],
  extraKeywords: "",
};

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0);
  return cleaned.length ? cleaned : fallback;
}

/** Validate/normalise a settings object coming from the DB or the client. */
export function normaliseSettings(raw: unknown): DiscoverSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    roleTitles: asStringArray(o["roleTitles"], DEFAULT_DISCOVER_SETTINGS.roleTitles).slice(0, 12),
    officeRegion:
      typeof o["officeRegion"] === "string" && o["officeRegion"].trim()
        ? (o["officeRegion"] as string).trim()
        : DEFAULT_DISCOVER_SETTINGS.officeRegion,
    remoteRule:
      typeof o["remoteRule"] === "string" && o["remoteRule"].trim()
        ? (o["remoteRule"] as string).trim()
        : DEFAULT_DISCOVER_SETTINGS.remoteRule,
    exclusions: asStringArray(o["exclusions"], DEFAULT_DISCOVER_SETTINGS.exclusions).slice(0, 12),
    extraKeywords:
      typeof o["extraKeywords"] === "string" ? (o["extraKeywords"] as string).trim() : "",
  };
}

/**
 * Build a spread of Tavily queries from the settings: for each role title, an
 * office-region variant and a remote-Australia variant, plus a couple of
 * careers-page-targeted queries. Capped so a search stays quick and affordable.
 */
export function buildQueries(settings: DiscoverSettings): string[] {
  const extra = settings.extraKeywords ? ` ${settings.extraKeywords}` : "";
  // Per-title queries for the first few titles (region + remote each).
  const perTitle = settings.roleTitles.slice(0, 4);
  const titleQueries: string[] = [];
  for (const t of perTitle) {
    titleQueries.push(`"${t}" jobs (Brisbane OR "Gold Coast") Queensland${extra}`);
    titleQueries.push(`"${t}" remote Australia job${extra}`);
  }

  // Site-agnostic careers-page sweeps across the whole title set — always kept.
  const orTitles = settings.roleTitles
    .slice(0, 6)
    .map((t) => `"${t}"`)
    .join(" OR ");
  const careersQueries = orTitles
    ? [
        `(${orTitles}) careers Brisbane OR "Gold Coast"${extra}`,
        `(${orTitles}) careers remote Australia${extra}`,
      ]
    : [];

  // Cap the per-title set so careers sweeps always survive the 10-query budget.
  const queries = [
    ...titleQueries.slice(0, Math.max(0, 10 - careersQueries.length)),
    ...careersQueries,
  ];
  return [...new Set(queries)].slice(0, 10);
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Pre-classification de-dupe: same host + near-identical title is one posting. */
function dedupeRaw(results: TavilyResult[]): TavilyResult[] {
  const seen = new Set<string>();
  const out: TavilyResult[] = [];
  for (const r of results) {
    const key = `${hostOf(r.url)}|${normaliseText(r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function coerceArrangement(value: unknown): WorkArrangement {
  return value === "office" || value === "hybrid" || value === "remote"
    ? value
    : "unknown";
}

function coerceVerdict(value: unknown): MatchVerdict {
  return value === "yes" || value === "no" || value === "unsure" ? value : "unsure";
}

/** Classify one batch of raw hits against the settings. */
async function classifyBatch(
  settings: DiscoverSettings,
  batch: TavilyResult[],
): Promise<DiscoverResult[]> {
  const userContent = [
    "SEARCH PARAMETERS (JSON):",
    JSON.stringify(
      {
        target_role_levels: settings.roleTitles,
        location_rule: {
          office_or_hybrid_must_be_in: settings.officeRegion,
          otherwise_remote_rule: settings.remoteRule,
        },
        exclude: settings.exclusions,
      },
      null,
      2,
    ),
    "",
    "RESULTS (JSON array):",
    JSON.stringify(
      batch.map((r, i) => ({
        index: i,
        title: r.title,
        url: r.url,
        content: r.content.slice(0, 1200),
      })),
    ),
  ].join("\n");

  const parsed = await createJson<{ results?: unknown[] }>({
    model: DISCOVER_MODEL,
    maxTokens: 4096,
    system: DISCOVER_CLASSIFY_SYSTEM,
    user: userContent,
  });
  const rows = Array.isArray(parsed.results) ? parsed.results : [];
  const validUrls = new Set(batch.map((r) => r.url));

  const out: DiscoverResult[] = [];
  for (const row of rows) {
    const o = (row ?? {}) as Record<string, unknown>;
    const url = typeof o["url"] === "string" ? o["url"] : "";
    if (!validUrls.has(url)) continue; // never let the model invent a URL
    out.push({
      url,
      title: String(o["title"] ?? "").trim(),
      company: String(o["company"] ?? "").trim(),
      location: String(o["location"] ?? "").trim(),
      work_arrangement: coerceArrangement(o["work_arrangement"]),
      seniority_match: coerceVerdict(o["seniority_match"]),
      location_match: coerceVerdict(o["location_match"]),
      reason: String(o["reason"] ?? "").trim(),
    });
  }
  return out;
}

/** Final de-dupe across batches by company + title similarity. */
function dedupeClassified(results: DiscoverResult[]): DiscoverResult[] {
  const seen = new Set<string>();
  const byUrl = new Set<string>();
  const out: DiscoverResult[] = [];
  for (const r of results) {
    if (byUrl.has(r.url)) continue;
    byUrl.add(r.url);
    const key = `${normaliseText(r.company)}|${normaliseText(r.title)}`;
    // An empty company+title key can't be judged similar — keep it.
    if (key !== " " && key !== "|" && seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface DiscoverRun {
  results: DiscoverResult[];
  rawCount: number;
  screenedCount: number;
}

/**
 * Full Discover run: build queries → Tavily → drop dismissed → de-dupe →
 * classify in batches → de-dupe again. `isDismissed` decides what to hide.
 */
export async function runDiscover(
  settings: DiscoverSettings,
  isDismissed: (url: string) => boolean,
): Promise<DiscoverRun> {
  const queries = buildQueries(settings);
  const raw = await tavilySearchMany(queries, { maxResults: 6, searchDepth: "advanced" });

  const candidates = dedupeRaw(raw).filter((r) => !isDismissed(r.url));

  const BATCH = 8;
  const classified: DiscoverResult[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const rows = await classifyBatch(settings, batch);
    classified.push(...rows);
  }

  const results = dedupeClassified(classified).filter((r) => !isDismissed(r.url));
  return { results, rawCount: raw.length, screenedCount: candidates.length };
}
