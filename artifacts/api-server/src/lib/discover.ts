// Discover: turn the user's editable search parameters into Tavily queries,
// then classify the raw hits against those parameters with the AI.

import { createJson } from "./anthropic";
import { DISCOVER_CLASSIFY_SYSTEM, DISCOVER_MODEL } from "./prompts";
import { tavilySearchSpecs, type TavilyQuerySpec, type TavilyResult } from "./tavily";
import { harvestPostings } from "./pageScan";

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
  /**
   * Career / recruiter listing pages to render + scan directly. Fixes the class
   * of site (JS-rendered SPAs like blackroc.co/jobs) whose postings never appear
   * in web-search indexes. Each is rendered in headless Chromium and its posting
   * links are harvested and screened alongside the search results.
   */
  sources: string[];
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
  sources: ["https://blackroc.co/jobs"],
};

/** Validate the scan-sources list: http(s) URLs only, capped. Distinct from the
 * other fields — an explicit empty array is respected (the user cleared it);
 * only an ABSENT key falls back to the starter sources. */
function normaliseSources(raw: unknown): string[] {
  if (raw === undefined) return DEFAULT_DISCOVER_SETTINGS.sources;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!/^https?:\/\//i.test(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

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
    sources: normaliseSources(o["sources"]),
  };
}

// ATS / hosted-careers platforms — postings here are almost always a single
// direct role. Named in the query TEXT (a soft bias) rather than used as a hard
// include_domains restriction, which starved results.
const ATS_HINT = `(greenhouse OR lever OR workday OR smartrecruiters OR workable OR ashby OR bamboohr OR recruitee OR careers)`;

// Big job-board aggregators. Blacklisted on the general lanes (safe — live-tested
// to still return plenty) so Discover surfaces company career-site and recruiter
// postings instead of aggregator search pages (jobsora/seek/indeed/etc.).
const JOB_BOARDS = [
  "seek.com.au", "au.seek.com", "indeed.com", "au.indeed.com",
  "glassdoor.com", "glassdoor.com.au", "jora.com", "au.jora.com", "adzuna.com.au",
  "careerone.com.au", "gumtree.com.au", "ziprecruiter.com", "simplyhired.com",
  "talent.com", "au.talent.com", "jobstreet.com", "ph.jobstreet.com", "whatjobs.com",
  "neuvoo.com", "trovit.com.au", "workforceaustralia.gov.au", "jobsora.com",
  "au.jobsora.com", "dynamitejobs.com", "builtin.com", "builtinnyc.com",
  "builtinboston.com", "builtinchicago.org", "startup.jobs", "jobactive.gov.au",
  "jobgether.com", "jobeka.com", "au.jobeka.com", "migratemate.co", "4dayweek.io",
];
// Social/noise domains. Excluded on the general/company lanes, but LinkedIn is a
// SEPARATE case (see below) — the user wants LinkedIn postings AND hiring posts,
// so LinkedIn gets its own lane and is allowed on the recruiter lane.
const SOCIAL = [
  "instagram.com", "facebook.com", "twitter.com", "x.com",
  "youtube.com", "reddit.com", "tiktok.com",
];
const LINKEDIN = ["linkedin.com", "au.linkedin.com"];
// General/company lanes: keep it to company career sites + recruiter sites.
const GENERAL_EXCLUDE = [...JOB_BOARDS, ...SOCIAL, ...LINKEDIN];
// Recruiter / hiring-shout-out lane: exclude the big boards, but ALLOW LinkedIn
// (and other socials) so recruiter posts and "we're hiring" shout-outs surface.
const HIRING_EXCLUDE = [...JOB_BOARDS];

// ATS / hosted-careers platforms. Companies host their OWN career postings here
// (Salesforce, carsales, Lendi, Atlassian, etc.), so an include-only sweep of
// these domains is a clean, high-yield way to hit company career pages directly.
// Bare domains match subdomains (e.g. myworkdayjobs.com → acme.wd1.myworkdayjobs.com).
// Live-tested: 20/20 results were direct single postings.
const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com",
  "myworkdayjobs.com", "bamboohr.com", "recruitee.com", "jobvite.com", "teamtailor.com",
  "pinpointhq.com", "livehire.com", "employmenthero.com", "jobadder.com",
];

// Named recruitment agencies / search firms active in AU (exec, tech, product).
// An include-only sweep surfaces their postings directly (Six Degrees, Hays,
// Michael Page, Hudson, Robert Walters, …) rather than relying on ranking luck.
const RECRUITER_DOMAINS = [
  "sixdegreesexecutive.com.au", "hays.com.au", "roberthalf.com.au", "michaelpage.com.au",
  "robertwalters.com.au", "talentinternational.com", "hudson.com", "au.hudson.com",
  "davidsonwp.com", "uandu.com.au", "beaumontpeople.com.au", "peoplebank.com.au",
  "paxus.com.au", "aquent.com", "s2m.com.au", "parityconsulting.com.au",
  "cartermurray.com", "growthtalent.org", "balancerecruitment.com.au", "precisionsourcing.com.au",
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

  const specs: TavilyQuerySpec[] = [];
  if (orTitles) {
    // Company career sites + recruiter sites (LinkedIn + big boards excluded).
    const general = (query: string) => specs.push({ query, excludeDomains: GENERAL_EXCLUDE });
    general(`(${orTitles}) jobs Brisbane OR "Gold Coast" Queensland${extra}`);
    general(`(${orTitles}) remote Australia job${extra}`);
    general(`(${orTitles}) careers Australia ${ATS_HINT}${extra}`);

    // Company career pages hosted on ATS platforms — include-only sweep (highest
    // yield of direct single postings). This is the "look at Salesforce/Amazon/…
    // career pages" lane, via the platforms companies actually post on.
    specs.push({ query: `(${orTitles}) Australia${extra}`, includeDomains: ATS_DOMAINS });

    // Named AU recruitment agencies — include-only sweep so their postings show
    // up directly (Six Degrees Executive, Hays, Michael Page, Hudson, …).
    specs.push({ query: `(${orTitles}) Australia${extra}`, includeDomains: RECRUITER_DOMAINS });

    // Recruiter / agency "we're hiring" shout-outs — LinkedIn ALLOWED here.
    specs.push({
      query: `(${orTitles}) Australia (hiring OR "we're hiring" OR "we are hiring" OR "now hiring" OR "looking for a")${extra}`,
      excludeDomains: HIRING_EXCLUDE,
    });
    // LinkedIn — both real postings (/jobs/view/…) and member posts where a
    // recruiter/founder says they're hiring. Include-only so it's LinkedIn-focused.
    specs.push({
      query: `(${orTitles}) Australia (hiring OR "looking for" OR "join our team" OR "we're growing")${extra}`,
      includeDomains: LINKEDIN,
    });
  }

  // Per-title sweeps to round out coverage for the top titles.
  for (const t of settings.roleTitles.slice(0, 2)) {
    specs.push({
      query: `"${t}" job Brisbane OR "Gold Coast" OR remote Australia${extra}`,
      excludeDomains: GENERAL_EXCLUDE,
    });
  }

  // De-dupe by query text and cap so a search stays quick and affordable. Note:
  // two specs may share query text but differ by domain filter (e.g. the ATS and
  // recruiter lanes) — key on the full spec so both survive.
  const seen = new Set<string>();
  const out: TavilyQuerySpec[] = [];
  for (const s of specs) {
    const key = `${s.query}|inc:${(s.includeDomains ?? []).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 12);
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
  const host = u.host.toLowerCase().replace(/^www\./, "");

  // LinkedIn: keep real postings (/jobs/view/…) and member posts (/posts/,
  // /feed/) but drop personal profiles, company pages and school pages — they're
  // leads at best, not postings, and add noise.
  if (/(^|\.)linkedin\.com$/.test(host) && /^\/(in|pub|company|school)(\/|$)/.test(path)) {
    return true;
  }

  // Search-style query parameters → a results page (e.g. ?q=, ?keywords=).
  if (/[?&](q|query|keywords?|search|searchterm)=/.test(query)) {
    return true;
  }
  // Explicit search / browse / results / advice path segments (not a single role).
  if (
    /\/(search|browse|results?|job-search|jobs-search|find-jobs|find-work|advice|job-description|career-advice|skills)(\/|$)/.test(
      path,
    )
  ) {
    return true;
  }
  // Recruiter marketing / reference pages, not postings (salary guides & surveys,
  // sector/service/expertise landing pages, blogs) — common on Hays/Robert Walters/etc.
  if (
    /\/(salary|salaries|salary-guide|salary-survey|salary-calculator|expertise|our-services|our-expertise|sectors?|disciplines|blog|news|insights?|resources|guides?)(\/|$)/.test(
      path,
    )
  ) {
    return true;
  }
  // Document downloads (salary guides, brochures) are never a live posting.
  if (/\.(pdf|docx?|pptx?|xlsx?)$/.test(path)) {
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
  /** Postings harvested directly from the user's scanned career/recruiter pages. */
  harvestedCount: number;
}

/**
 * Render each "scan source" page in headless Chromium and harvest its posting
 * links, shaped like Tavily results so they screen through the same pipeline.
 * Best-effort and parallel — a source that fails to render just yields nothing.
 */
async function scanSources(sources: string[]): Promise<TavilyResult[]> {
  if (!sources.length) return [];
  const settled = await Promise.allSettled(
    sources.slice(0, 6).map((s) => harvestPostings(s, { cap: 25, timeoutMs: 30000 })),
  );
  const out: TavilyResult[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      out.push({ title: p.title, url: p.url, content: p.content, score: 0.5 });
    }
  }
  return out;
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
  // Run the web search and the direct page scans concurrently.
  const [raw, harvested] = await Promise.all([
    // Bias to the last month at the source, and a higher per-query cap since the
    // posting filter + aggregator exclusion drop a lot of noise.
    tavilySearchSpecs(plan, {
      maxResults: 8,
      searchDepth: "advanced",
      timeRange: "month",
    }),
    scanSources(settings.sources),
  ]);

  const deduped = dedupeRaw(raw);
  // Keep only URLs that look like a specific posting, not a search/index page.
  const postings = deduped.filter((r) => !isSearchOrIndexPage(r.url));
  const droppedNonPostings = deduped.length - postings.length;

  // Merge in the harvested postings (already vetted as individual roles by the
  // page scanner, so they skip the search/index filter) and de-dupe across both.
  const merged = dedupeRaw([...postings, ...harvested]);
  const candidates = merged.filter((r) => !isDismissed(r.url));

  const BATCH = 8;
  const classified: DiscoverResult[] = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const rows = await classifyBatch(settings, batch);
    classified.push(...rows);
  }

  const results = dedupeClassified(classified).filter((r) => !isDismissed(r.url));
  return {
    results,
    rawCount: raw.length + harvested.length,
    screenedCount: candidates.length,
    droppedNonPostings,
    harvestedCount: harvested.length,
  };
}
