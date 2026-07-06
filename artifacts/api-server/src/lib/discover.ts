// Discover: turn the user's editable search parameters into Tavily queries,
// then classify the raw hits against those parameters with the AI.

import { createJson } from "./anthropic";
import { DISCOVER_CLASSIFY_SYSTEM, DISCOVER_MODEL } from "./prompts";
import { tavilySearchSpecs, type TavilyQuerySpec, type TavilyResult } from "./tavily";

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
  /** Overall fit for the candidate, 1–10 — so they can decide whether to apply. */
  fit_score: number;
  /** One line on what drives the fit score. */
  fit_note: string;
  /** Posting date/age if the snippet reveals it (e.g. "Posted 2 weeks ago"); "" if unknown. */
  posted: string;
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

// ATS / hosted-careers platforms — postings here are almost always a single
// direct role. Named in the query TEXT (a soft bias) rather than used as a hard
// include_domains restriction, which starved results.
const ATS_HINT = `(greenhouse OR lever OR workday OR smartrecruiters OR workable OR ashby OR bamboohr OR recruitee OR careers)`;

// Big job-board aggregators + social/noise domains. EXCLUDED from every query
// (a blacklist — safe, doesn't starve results) so Discover surfaces company
// career-site and recruiter postings instead of aggregator search pages
// (jobsora/seek/indeed/etc.). Live-tested: excluding these still returns plenty.
const AGGREGATOR_DOMAINS = [
  "seek.com.au", "indeed.com", "au.indeed.com", "linkedin.com", "au.linkedin.com",
  "glassdoor.com", "glassdoor.com.au", "jora.com", "au.jora.com", "adzuna.com.au",
  "careerone.com.au", "gumtree.com.au", "ziprecruiter.com", "simplyhired.com",
  "talent.com", "au.talent.com", "jobstreet.com", "whatjobs.com", "neuvoo.com",
  "trovit.com.au", "workforceaustralia.gov.au", "jobsora.com", "au.jobsora.com",
  "dynamitejobs.com", "builtin.com", "builtinnyc.com", "startup.jobs",
  "jobactive.gov.au", "instagram.com", "facebook.com", "twitter.com", "x.com",
  "youtube.com", "reddit.com", "tiktok.com",
];

/**
 * Build the query PLAN: a spread of Tavily queries that BIAS toward direct
 * postings on company career sites, ATS platforms and recruiter sites — via
 * query wording — with the big job-board aggregators EXCLUDED on every query
 * (blacklist) so results aren't dominated by aggregator search pages. The
 * `isSearchOrIndexPage` filter + the classifier keep results to direct
 * postings. Capped so a search stays quick and affordable.
 */
export function buildQueryPlan(settings: DiscoverSettings): TavilyQuerySpec[] {
  const extra = settings.extraKeywords ? ` ${settings.extraKeywords}` : "";
  const orTitles = settings.roleTitles
    .slice(0, 6)
    .map((t) => `"${t}"`)
    .join(" OR ");

  const queries: string[] = [];
  if (orTitles) {
    // Broad baseline for coverage — office region and remote-Australia.
    queries.push(`(${orTitles}) jobs Brisbane OR "Gold Coast" Queensland${extra}`);
    queries.push(`(${orTitles}) remote Australia job${extra}`);
    // Careers-page biased (company career sites + ATS platforms).
    queries.push(`(${orTitles}) careers Australia ${ATS_HINT}${extra}`);
    // Recruiter / agency biased.
    queries.push(`(${orTitles}) Australia (recruitment OR recruiter OR "talent acquisition")${extra}`);
  }

  // Per-title sweeps to fill the budget (region + remote each).
  for (const t of settings.roleTitles.slice(0, 3)) {
    queries.push(`"${t}" job Brisbane OR "Gold Coast" OR remote Australia${extra}`);
  }

  // De-dupe, cap, and attach the aggregator blacklist to every query.
  const unique = [...new Set(queries)].slice(0, 10);
  return unique.map((query) => ({ query, excludeDomains: AGGREGATOR_DOMAINS }));
}

/** The query texts alone (used by the non-AI smoke test). */
export function buildQueries(settings: DiscoverSettings): string[] {
  return buildQueryPlan(settings).map((s) => s.query);
}

/**
 * True when a URL is clearly a SEARCH-RESULTS or CATEGORY page rather than a
 * single job posting — the kind of link that points at search terms, not a
 * role. Deliberately CONSERVATIVE: it only drops the obvious offenders (search
 * query strings, /search|/browse|/results paths, aggregator "…-jobs" category
 * slugs) and leaves everything else — including company careers landing pages —
 * for the classifier to judge, so we don't starve results.
 */
export function isSearchOrIndexPage(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return true; // unparseable → not a usable posting link
  }
  const path = u.pathname.toLowerCase().replace(/\/+$/, "");
  const query = u.search.toLowerCase();

  // Search-style query parameters → a results page (e.g. ?q=, ?keywords=).
  if (/[?&](q|query|keywords?|search|searchterm)=/.test(query)) {
    return true;
  }
  // Explicit search / browse / results / advice path segments (not a single role).
  if (
    /\/(search|browse|results?|job-search|jobs-search|find-jobs|advice|job-description|career-advice|skills)(\/|$)/.test(
      path,
    )
  ) {
    return true;
  }
  // Aggregator "…-jobs" category slugs with no posting id (e.g. /head-of-product-jobs).
  if (/-jobs?(\/|$)/.test(path) && !/\d{4,}/.test(path)) {
    return true;
  }
  return false;
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

/** Clamp the model's fit score to an integer in 1–10; default mid on junk. */
function coerceScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
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
      fit_score: coerceScore(o["fit_score"]),
      fit_note: String(o["fit_note"] ?? "").trim(),
      posted: String(o["posted"] ?? "").trim(),
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
  /** Direct-posting candidates left after dropping search/index pages + dismissed. */
  screenedCount: number;
  /** Raw hits dropped for being search / category / index pages (not postings). */
  droppedNonPostings: number;
}

/**
 * Full Discover run: build the domain-targeted query plan → Tavily → drop
 * search/index pages (keep only direct postings) → drop dismissed → de-dupe →
 * classify in batches → de-dupe again. `isDismissed` decides what to hide.
 */
export async function runDiscover(
  settings: DiscoverSettings,
  isDismissed: (url: string) => boolean,
): Promise<DiscoverRun> {
  const plan = buildQueryPlan(settings);
  // Bias to the last month at the source, and a higher per-query cap since the
  // posting filter + aggregator exclusion drop a lot of noise.
  const raw = await tavilySearchSpecs(plan, {
    maxResults: 8,
    searchDepth: "advanced",
    timeRange: "month",
  });

  const deduped = dedupeRaw(raw);
  // Keep only URLs that look like a specific posting, not a search/index page.
  const postings = deduped.filter((r) => !isSearchOrIndexPage(r.url));
  const droppedNonPostings = deduped.length - postings.length;
  const candidates = postings.filter((r) => !isDismissed(r.url));

  const BATCH = 8;
  const classified: DiscoverResult[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const rows = await classifyBatch(settings, batch);
    classified.push(...rows);
  }

  const results = dedupeClassified(classified).filter((r) => !isDismissed(r.url));
  return { results, rawCount: raw.length, screenedCount: candidates.length, droppedNonPostings };
}
