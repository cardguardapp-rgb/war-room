// Thin client for the Tavily web-search API. Used by the Discover page to find
// job postings across company career sites and job boards.

/** Thrown when Discover search is used but TAVILY_API_KEY isn't configured. */
export class TavilyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TavilyConfigError";
  }
}

/** Thrown when the Tavily API itself returns an error / is unreachable. */
export class TavilyRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TavilyRequestError";
    this.status = status;
  }
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results?: {
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }[];
}

function getKey(): string {
  const key = process.env["TAVILY_API_KEY"];
  if (!key) {
    throw new TavilyConfigError(
      "TAVILY_API_KEY is not set. Add it in Replit Secrets and restart the app to enable Discover search.",
    );
  }
  return key;
}

export interface TavilySearchOptions {
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  includeDomains?: string[];
  excludeDomains?: string[];
}

/** Run a single Tavily search and return its results (empty on soft failure). */
export async function tavilySearch(
  query: string,
  opts: TavilySearchOptions = {},
): Promise<TavilyResult[]> {
  const apiKey = getKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // Send the key both ways so this works against current (Bearer) and
        // legacy (api_key in body) Tavily API versions.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: opts.searchDepth ?? "advanced",
        max_results: opts.maxResults ?? 6,
        include_answer: false,
        include_raw_content: false,
        ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
        ...(opts.excludeDomains?.length ? { exclude_domains: opts.excludeDomains } : {}),
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new TavilyRequestError(
      aborted ? "The search request timed out." : "Could not reach the search service.",
      aborted ? 504 : 502,
    );
  }
  clearTimeout(timer);

  if (res.status === 401 || res.status === 403) {
    throw new TavilyConfigError(
      "The TAVILY_API_KEY appears to be invalid. Check the Replit Secret.",
    );
  }
  if (res.status === 429) {
    throw new TavilyRequestError(
      "The search service is rate limited right now. Please try again in a moment.",
      429,
    );
  }
  if (!res.ok) {
    throw new TavilyRequestError(
      `The search request failed (HTTP ${res.status}).`,
      502,
    );
  }

  const data = (await res.json()) as TavilyResponse;
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter((r): r is Required<NonNullable<typeof r>> => typeof r?.url === "string")
    .map((r) => ({
      title: (r.title ?? "").trim(),
      url: r.url,
      content: (r.content ?? "").trim(),
      score: typeof r.score === "number" ? r.score : 0,
    }));
}

/**
 * Run several queries and merge their results, de-duplicating by URL. A single
 * query failing config/auth propagates (whole search can't work); transient
 * per-query failures are swallowed so one bad query doesn't sink the batch.
 */
export async function tavilySearchMany(
  queries: string[],
  opts: TavilySearchOptions = {},
): Promise<TavilyResult[]> {
  const settled = await Promise.allSettled(
    queries.map((q) => tavilySearch(q, opts)),
  );

  // If every query failed with a config error, surface it (nothing will work).
  const configError = settled.find(
    (s): s is PromiseRejectedResult =>
      s.status === "rejected" && s.reason instanceof TavilyConfigError,
  );
  const anyFulfilled = settled.some((s) => s.status === "fulfilled");
  if (configError && !anyFulfilled) {
    throw configError.reason;
  }

  const byUrl = new Map<string, TavilyResult>();
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value) {
      const existing = byUrl.get(r.url);
      if (!existing || r.score > existing.score) byUrl.set(r.url, r);
    }
  }
  return [...byUrl.values()];
}
