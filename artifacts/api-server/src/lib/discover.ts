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
// Big job-board aggregators whose results are mostly SEARCH / CATEGORY pages
// (links to search terms, not a specific posting). Excluded from the broad web
// queries so Discover surfaces the company career-site and recruiter postings
// the user actually wants.
const AGGREGATOR_DOMAINS = [
  "seek.com.au", "indeed.com", "au.indeed.com", "linkedin.com",
  "glassdoor.com", "glassdoor.com.au", "jora.com", "au.jora.com",
  "adzuna.com.au", "careerone.com.au", "gumtree.com.au", "ziprecruiter.com",
  "simplyhired.com", "talent.com", "au.talent.com", "jobstreet.com",
  "whatjobs.com", "neuvoo.com", "trovit.com.au", "workforceaustralia.gov.au",
];

// Applicant-tracking / hosted-careers platforms — these URLs are almost always
// a single direct posting. Targeted with include_domains.
const ATS_DOMAINS = [
  "greenhouse.io", "boards.greenhouse.io", "lever.co", "jobs.lever.co",
  "workable.com", "smartrecruiters.com", "myworkdayjobs.com", "ashbyhq.com",
  "jobs.ashbyhq.com", "teamtailor.com", "recruitee.com", "bamboohr.com",
  "jobvite.com", "applytojob.com", "pinpointhq.com", "livehire.com",
  "employmenthero.com", "jobadder.com", "expr3ss.com",
];

// Australian recruitment agencies that place senior / executive product roles.
const RECRUITER_DOMAINS = [
  "hays.com.au", "michaelpage.com.au", "roberthalf.com.au", "robertwalters.com.au",
  "talentinternational.com", "peoplebank.com.au", "davidsonwp.com", "uandu.com",
  "paxus.com.au", "launchrecruitment.com.au",
];

/**
 * Build the query PLAN: a spread of Tavily queries, each with its own domain
 * filter, aimed at DIRECT postings on company career sites, ATS platforms and
 * recruiter sites (not job-board search pages). Groups: ATS-hosted careers,
 * company careers pages, recruiter/agency sites, and a few per-title sweeps —
 * all with the big aggregators excluded. Capped so a search stays quick.
 */
export function buildQueryPlan(settings: DiscoverSettings): TavilyQuerySpec[] {
  const extra = settings.extraKeywords ? ` ${settings.extraKeywords}` : "";
  const orTitles = settings.roleTitles
    .slice(0, 6)
    .map((t) => `"${t}"`)
    .join(" OR ");

  const specs: TavilyQuerySpec[] = [];
  if (orTitles) {
    // 1. ATS / hosted-careers platforms — direct posting URLs.
    specs.push({
      query: `(${orTitles}) Australia${extra}`,
      includeDomains: ATS_DOMAINS,
    });
    specs.push({
      query: `(${orTitles}) Brisbane OR "Gold Coast" OR remote Australia${extra}`,
      includeDomains: ATS_DOMAINS,
    });
    // 2. Company career pages (aggregators excluded).
    specs.push({
      query: `(${orTitles}) careers Brisbane OR "Gold Coast" Queensland${extra}`,
      excludeDomains: AGGREGATOR_DOMAINS,
    });
    specs.push({
      query: `(${orTitles}) careers remote Australia${extra}`,
      excludeDomains: AGGREGATOR_DOMAINS,
    });
    // 3. Recruitment-agency postings.
    specs.push({
      query: `(${orTitles}) recruitment agency Australia${extra}`,
      includeDomains: RECRUITER_DOMAINS,
    });
  }

  // 4. Per-title direct-posting sweeps (aggregators excluded) to fill the budget.
  for (const t of settings.roleTitles.slice(0, 4)) {
    specs.push({
      query: `"${t}" job Brisbane OR "Gold Coast" OR remote Australia${extra}`,
      excludeDomains: AGGREGATOR_DOMAINS,
    });
  }

  // De-dupe on query text + domain filter, then cap the whole plan.
  const seen = new Set<string>();
  const deduped = specs.filter((s) => {
    const key = `${s.query}|${(s.includeDomains ?? []).join(",")}|${(s.excludeDomains ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.slice(0, 11);
}

/** The query texts alone (used by the non-AI smoke test). */
export function buildQueries(settings: DiscoverSettings): string[] {
  return buildQueryPlan(settings).map((s) => s.query);
}

/**
 * True when a URL is a search-results, category, or careers-index page rather
 * than a single job posting — the kind of link that points at search terms, not
 * a role. Conservative: only drops clear non-postings and leaves genuine
 * posting URLs for the classifier to judge.
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

  // Search-style query parameters → a results page.
  if (/[?&](q|query|keywords?|search|searchterm|term|page|start|offset)=/.test(query)) {
    return true;
  }
  // Explicit search / browse / results path segments.
  if (
    /\/(search|browse|results?|find|explore|listings?|job-search|jobs-search|search-results)(\/|$)/.test(
      path,
    )
  ) {
    return true;
  }
  // A jobs/careers hub root with nothing specific after it (an index page).
  if (
    /(^|\/)(jobs?|careers?|vacancies|opportunities|positions|roles|open-roles|current-vacancies|job-search|search-jobs|all-jobs)$/.test(
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
  // Slightly higher per-query cap since the posting filter drops the noise.
  const raw = await tavilySearchSpecs(plan, { maxResults: 8, searchDepth: "advanced" });

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
