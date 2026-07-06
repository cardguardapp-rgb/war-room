import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { createJson } from "./anthropic";
import { EXTRACT_MODEL, JOB_EXTRACTION_SYSTEM } from "./prompts";

export type WorkArrangement = "office" | "hybrid" | "remote" | "unknown";

export interface ExtractedJob {
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  /** 2–3 sentence high-level orientation on the role. */
  summary: string;
  /** Reasons the candidate might not want to continue — [] if a clean fit. */
  flags: string[];
  /** Overall fit for the candidate, 1–10 — so they can decide whether to apply. */
  fit_score: number;
  /** One line on what drives the fit score. */
  fit_note: string;
  posting_text: string;
}

/**
 * The candidate's search criteria, passed through so the extraction can judge
 * seniority/location/exclusion mismatches when raising flags. All optional.
 */
export interface JobCriteria {
  roleTitles?: string[];
  officeRegion?: string;
  remoteRule?: string;
  exclusions?: string[];
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type FetchResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/** Fetch a URL and extract the main article text (nav/ads stripped). */
export async function fetchAndClean(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-AU,en;q=0.9",
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: aborted
        ? "The page took too long to respond."
        : "Could not reach that URL.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `The site returned HTTP ${res.status}. Many job boards (LinkedIn especially) block automated requests.`,
    };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) {
    return { ok: false, reason: "That URL did not return a readable web page." };
  }

  const html = await res.text();
  let text = "";
  try {
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    text = (article?.textContent ?? "").trim();
    if (!text) {
      text = (dom.window.document.body?.textContent ?? "").trim();
    }
  } catch {
    return { ok: false, reason: "Could not parse the page content." };
  }

  text = text
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length < 200) {
    return {
      ok: false,
      reason:
        "The page didn't contain a readable posting — it may be behind a login or bot wall (this is common on LinkedIn).",
    };
  }
  return { ok: true, text };
}

/** Build the user message: the posting text, plus the candidate's criteria if given. */
function extractUserContent(rawText: string, criteria?: JobCriteria): string {
  const posting = `JOB POSTING TEXT:\n${rawText.slice(0, 60000)}`;
  const hasCriteria =
    criteria &&
    ((criteria.roleTitles && criteria.roleTitles.length) ||
      criteria.officeRegion ||
      criteria.remoteRule ||
      (criteria.exclusions && criteria.exclusions.length));
  if (!hasCriteria) return posting;
  const crit = [
    "CANDIDATE SEARCH CRITERIA (JSON) — judge seniority/location/exclusions against this when flagging:",
    JSON.stringify(
      {
        target_role_levels: criteria!.roleTitles ?? [],
        office_or_hybrid_must_be_in: criteria!.officeRegion ?? "",
        otherwise_remote_rule: criteria!.remoteRule ?? "",
        exclude: criteria!.exclusions ?? [],
      },
      null,
      2,
    ),
  ].join("\n");
  return `${crit}\n\n${posting}`;
}

/** Ask the model for the metadata fields, plus a summary and honest flags. */
async function extractMeta(
  rawText: string,
  criteria?: JobCriteria,
): Promise<{
  title: string;
  company: string;
  location: string;
  work_arrangement: WorkArrangement;
  summary: string;
  flags: string[];
  fit_score: number;
  fit_note: string;
}> {
  const p = await createJson<Partial<ExtractedJob>>({
    model: EXTRACT_MODEL,
    maxTokens: 1500,
    system: JOB_EXTRACTION_SYSTEM,
    user: extractUserContent(rawText, criteria),
  });
  const wa = p.work_arrangement;
  const flags = Array.isArray(p.flags)
    ? p.flags.map((f) => String(f ?? "").trim()).filter((f) => f.length > 0)
    : [];
  const scoreRaw =
    typeof p.fit_score === "number" ? p.fit_score : Number(p.fit_score);
  const fit_score = Number.isFinite(scoreRaw)
    ? Math.min(10, Math.max(1, Math.round(scoreRaw)))
    : 5;
  return {
    title: (p.title ?? "").trim(),
    company: (p.company ?? "").trim(),
    location: (p.location ?? "").trim(),
    work_arrangement:
      wa === "office" || wa === "hybrid" || wa === "remote" ? wa : "unknown",
    summary: (p.summary ?? "").trim(),
    flags,
    fit_score,
    fit_note: (p.fit_note ?? "").trim(),
  };
}

/**
 * Extract from a URL. The cleaned article text becomes posting_text; the model
 * classifies the metadata. Returns ok:false with a reason if the fetch is
 * blocked or the page is junk (caller then offers the paste fallback).
 */
export async function extractFromUrl(
  url: string,
  criteria?: JobCriteria,
): Promise<
  | { ok: true; data: ExtractedJob & { source_url: string } }
  | { ok: false; reason: string }
> {
  const fetched = await fetchAndClean(url);
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  const meta = await extractMeta(fetched.text, criteria);
  return {
    ok: true,
    data: { ...meta, posting_text: fetched.text, source_url: url },
  };
}

/** Extract from pasted text — the pasted text IS the posting_text. */
export async function extractFromText(
  text: string,
  criteria?: JobCriteria,
): Promise<ExtractedJob> {
  const meta = await extractMeta(text, criteria);
  return { ...meta, posting_text: text.trim() };
}
