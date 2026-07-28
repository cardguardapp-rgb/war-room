// Turn a rendered listing page (a company careers page or recruiter job board)
// into a set of individual posting candidates. Pairs with pageRender.ts: render
// the JS page, then harvest the posting links + their card text so Discover can
// screen them with the same classifier it uses for Tavily hits.

import { JSDOM } from "jsdom";
import { renderPageDom } from "./pageRender";
import { logger } from "./logger";

export interface HarvestedPosting {
  url: string;
  title: string;
  /** Card/anchor text — thin, but enough for the classifier to judge fit. */
  content: string;
}

// A link is a posting if its path has a "section" segment followed by a slug,
// e.g. /jobs/head-of-product, /careers/12345, /vacancies/foo. The listing page
// itself (…/jobs) has no slug after the section, so it's excluded.
const SECTION =
  /\/(jobs?|careers?|vacanc(?:y|ies)|positions?|roles?|opportunit(?:y|ies)|openings?|listings?|job-details?)\/[^/]+/i;

// Slugs that are clearly not a single role even when they sit under a section.
const NON_POSTING_SLUG =
  /^(search|browse|results?|category|categories|all|page|apply|login|register|filter|sort|about|team|contact|faqs?|privacy|terms|employers?|candidates?|clients?|insights?|blog|news|salary|salaries)$/i;

function hostOf(u: string): string {
  try {
    return new URL(u).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function titleFromSlug(pathname: string): string {
  const slug = pathname.split("/").filter(Boolean).pop() ?? "";
  return slug
    .replace(/\.(html?|aspx?|php)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Render a listing URL and harvest its individual posting links. Best-effort:
 * returns [] if the page can't be rendered. `cap` bounds how many we return.
 */
export async function harvestPostings(
  sourceUrl: string,
  opts: { cap?: number; timeoutMs?: number } = {},
): Promise<HarvestedPosting[]> {
  const cap = opts.cap ?? 25;
  const rendered = await renderPageDom(sourceUrl, { timeoutMs: opts.timeoutMs ?? 30000 });
  if (!rendered.ok) {
    logger.info({ sourceUrl, reason: rendered.reason }, "Source scan: render failed");
    return [];
  }

  let doc: Document;
  try {
    doc = new JSDOM(rendered.html, { url: sourceUrl }).window.document;
  } catch {
    return [];
  }

  const sourceHost = hostOf(sourceUrl);
  let sourcePath = "/";
  try {
    sourcePath = new URL(sourceUrl).pathname.replace(/\/+$/, "") || "/";
  } catch {
    /* keep default */
  }

  const seen = new Set<string>();
  const out: HarvestedPosting[] = [];

  for (const a of Array.from(doc.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;

    let abs: URL;
    try {
      abs = new URL(href, sourceUrl);
    } catch {
      continue;
    }
    if (abs.host.replace(/^www\./, "").toLowerCase() !== sourceHost) continue; // same site only

    const cleanPath = abs.pathname.replace(/\/+$/, "");
    if (cleanPath === sourcePath) continue; // the listing page itself
    if (!SECTION.test(abs.pathname)) continue;

    const lastSeg = cleanPath.split("/").filter(Boolean).pop() ?? "";
    if (NON_POSTING_SLUG.test(lastSeg)) continue;

    const normalised = `${abs.origin}${cleanPath}${abs.search}`;
    if (seen.has(normalised)) continue;
    seen.add(normalised);

    const anchorText = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    // Card text gives the classifier location/teaser context beyond the title.
    const card = a.closest("article, li, .card, [class*='card'], [class*='job'], div");
    const cardText = (card?.textContent ?? anchorText).replace(/\s+/g, " ").trim();

    const title = anchorText.length >= 3 ? anchorText : titleFromSlug(abs.pathname);
    out.push({
      url: normalised,
      title: title.slice(0, 160),
      content: (cardText || title).slice(0, 700),
    });
    if (out.length >= cap) break;
  }

  logger.info({ sourceUrl, harvested: out.length }, "Source scan complete");
  return out;
}
