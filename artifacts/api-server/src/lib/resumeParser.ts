/**
 * Resume .docx parser.
 *
 * Deliberately parses the raw WordprocessingML (via JSZip + fast-xml-parser)
 * rather than going through mammoth, because we need run-level formatting
 * (font family, size, bold/italic, colour) to build an accurate style map —
 * mammoth throws that information away. The parse is pure and side-effect
 * free: give it a .docx Buffer, get back { resumeJson, styleMap, warnings }.
 *
 * Nothing is ever silently dropped: any text we cannot confidently classify
 * lands in an "Other" section (with a warning) so the user can reassign it on
 * the review screen.
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// ---------------------------------------------------------------------------
// Public types (mirrored in the frontend + documented in CLAUDE.md)
// ---------------------------------------------------------------------------

export interface StyleEntry {
  fontFamily: string | null;
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  /** Uppercase hex including leading '#', e.g. "#1F3864". null = inherit/auto. */
  color: string | null;
}

export interface StyleMap {
  version: 1;
  defaults: {
    fontFamily: string | null;
    fontSizePt: number | null;
    color: string | null;
  };
  elements: {
    name: StyleEntry;
    sectionHeading: StyleEntry;
    jobTitle: StyleEntry;
    body: StyleEntry;
    bullet: StyleEntry;
  };
}

export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  dates: string;
  location: string;
  bullets: string[];
}

export interface EducationItem {
  id: string;
  institution: string;
  qualification: string;
  dates: string;
  location: string;
  details: string[];
}

export type ResumeSection =
  | {
      id: string;
      kind: "contact";
      heading: string;
      name: string;
      email: string;
      phone: string;
      location: string;
      links: string[];
      otherLines: string[];
    }
  | { id: string; kind: "summary"; heading: string; paragraphs: string[] }
  | { id: string; kind: "experience"; heading: string; items: ExperienceItem[] }
  | { id: string; kind: "education"; heading: string; items: EducationItem[] }
  | { id: string; kind: "skills"; heading: string; items: string[] }
  | {
      id: string;
      kind: "other";
      heading: string;
      paragraphs: string[];
      bullets: string[];
    };

export type SectionKind = ResumeSection["kind"];

export interface ResumeJson {
  version: 1;
  sections: ResumeSection[];
}

export interface ParseResult {
  resumeJson: ResumeJson;
  styleMap: StyleMap;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Low-level XML helpers
// ---------------------------------------------------------------------------

type XmlNode = Record<string, any>;

function toArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Text content of a <w:t> node (string, or object when it carries attributes). */
function nodeText(t: unknown): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  if (typeof t === "object") return String((t as XmlNode)["#text"] ?? "");
  return String(t);
}

function attr(node: unknown, name: string): string | undefined {
  if (node == null || typeof node !== "object") return undefined;
  const v = (node as XmlNode)[`@_${name}`];
  return v == null ? undefined : String(v);
}

function normalizeHex(v: string): string {
  const s = v.startsWith("#") ? v.slice(1) : v;
  return `#${s.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Run-property (rPr) parsing + style resolution
// ---------------------------------------------------------------------------

interface Rpr {
  fontFamily?: string;
  sizeHalfPt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

function hasToggle(n: unknown): boolean | undefined {
  if (n === undefined) return undefined;
  const v = attr(n, "w:val");
  if (v !== undefined) {
    const lower = v.toLowerCase();
    return !(lower === "0" || lower === "false" || lower === "off");
  }
  return true;
}

function parseRpr(rPr: XmlNode | undefined): Rpr {
  if (!rPr || typeof rPr !== "object") return {};
  const out: Rpr = {};
  const rFonts = rPr["w:rFonts"];
  const font =
    attr(rFonts, "w:ascii") ??
    attr(rFonts, "w:hAnsi") ??
    attr(rFonts, "w:cs");
  if (font) out.fontFamily = font;
  const sz = attr(rPr["w:sz"], "w:val");
  if (sz && !Number.isNaN(Number(sz))) out.sizeHalfPt = Number(sz);
  const b = hasToggle(rPr["w:b"]);
  if (b !== undefined) out.bold = b;
  const i = hasToggle(rPr["w:i"]);
  if (i !== undefined) out.italic = i;
  const col = attr(rPr["w:color"], "w:val");
  if (col && col.toLowerCase() !== "auto") out.color = normalizeHex(col);
  return out;
}

function mergeRpr(base: Rpr, over: Rpr): Rpr {
  return {
    fontFamily: over.fontFamily ?? base.fontFamily,
    sizeHalfPt: over.sizeHalfPt ?? base.sizeHalfPt,
    bold: over.bold ?? base.bold,
    italic: over.italic ?? base.italic,
    color: over.color ?? base.color,
  };
}

function rprToStyle(rpr: Rpr): StyleEntry {
  return {
    fontFamily: rpr.fontFamily ?? null,
    fontSizePt: rpr.sizeHalfPt != null ? rpr.sizeHalfPt / 2 : null,
    bold: !!rpr.bold,
    italic: !!rpr.italic,
    color: rpr.color ?? null,
  };
}

interface StyleDef {
  name: string;
  basedOn?: string;
  rpr: Rpr;
}

class StyleResolver {
  private styles = new Map<string, StyleDef>();
  private docDefault: Rpr = {};
  private cache = new Map<string, Rpr>();

  constructor(stylesXml: XmlNode | undefined) {
    if (!stylesXml) return;
    const root = stylesXml["w:styles"] ?? stylesXml;
    const docDefaults = root?.["w:docDefaults"];
    this.docDefault = parseRpr(docDefaults?.["w:rPrDefault"]?.["w:rPr"]);
    for (const s of toArray<XmlNode>(root?.["w:style"])) {
      const id = attr(s, "w:styleId");
      if (!id) continue;
      this.styles.set(id, {
        name: attr(s["w:name"], "w:val") ?? id,
        basedOn: attr(s["w:basedOn"], "w:val"),
        rpr: parseRpr(s["w:rPr"]),
      });
    }
  }

  docDefaultRpr(): Rpr {
    return this.docDefault;
  }

  styleName(styleId: string | undefined): string | undefined {
    return styleId ? this.styles.get(styleId)?.name : undefined;
  }

  /** Effective rPr for a paragraph style, walking the basedOn chain. */
  resolve(styleId: string | undefined): Rpr {
    if (!styleId) return { ...this.docDefault };
    const cached = this.cache.get(styleId);
    if (cached) return cached;
    // Build chain root -> styleId
    const chain: StyleDef[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = styleId;
    let depth = 0;
    while (cur && !seen.has(cur) && depth < 25) {
      seen.add(cur);
      const def = this.styles.get(cur);
      if (!def) break;
      chain.unshift(def);
      cur = def.basedOn;
      depth += 1;
    }
    let merged: Rpr = { ...this.docDefault };
    for (const def of chain) merged = mergeRpr(merged, def.rpr);
    this.cache.set(styleId, merged);
    return merged;
  }
}

// ---------------------------------------------------------------------------
// Paragraph model
// ---------------------------------------------------------------------------

interface Para {
  text: string;
  style: StyleEntry;
  fontSizePt: number | null;
  bold: boolean;
  isBullet: boolean;
  isHeading: boolean;
  headingLevel: number | null;
  styleName: string | undefined;
}

const BULLET_GLYPHS = /^[\s]*[•●▪◦‣·*–—\-]+\s+/;

function stripBulletGlyph(text: string): string {
  return text.replace(BULLET_GLYPHS, "").trim();
}

function collectRuns(p: XmlNode): XmlNode[] {
  const runs: XmlNode[] = [...toArray<XmlNode>(p["w:r"])];
  // Runs nested inside hyperlinks (contact links etc.)
  for (const h of toArray<XmlNode>(p["w:hyperlink"])) {
    runs.push(...toArray<XmlNode>(h["w:r"]));
  }
  return runs;
}

function runText(r: XmlNode): string {
  let out = "";
  for (const t of toArray(r["w:t"])) out += nodeText(t);
  for (const _ of toArray(r["w:tab"])) out += "\t";
  for (const _ of toArray(r["w:br"])) out += " ";
  return out;
}

function buildPara(p: XmlNode, resolver: StyleResolver): Para {
  const pPr = p["w:pPr"];
  const pStyleId = attr(pPr?.["w:pStyle"], "w:val");
  const styleName = resolver.styleName(pStyleId);
  const paraRpr = resolver.resolve(pStyleId);

  const runs = collectRuns(p);
  let text = "";
  let firstMeaningful: Rpr | undefined;
  for (const r of runs) {
    const rt = runText(r);
    text += rt;
    if (firstMeaningful === undefined && rt.trim().length > 0) {
      firstMeaningful = mergeRpr(paraRpr, parseRpr(r["w:rPr"]));
    }
  }
  const effRpr = firstMeaningful ?? paraRpr;
  const style = rprToStyle(effRpr);

  const isList = pPr?.["w:numPr"] !== undefined;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const isBullet = isList || BULLET_GLYPHS.test(text);

  let headingLevel: number | null = null;
  if (styleName) {
    const m = /^heading\s*(\d+)/i.exec(styleName);
    if (m) headingLevel = Number(m[1]);
    else if (/^title$/i.test(styleName)) headingLevel = 0;
  }

  return {
    text: cleaned,
    style,
    fontSizePt: style.fontSizePt,
    bold: style.bold,
    isBullet,
    isHeading: false, // filled in a second pass
    headingLevel,
    styleName,
  };
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function isAllCaps(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase();
}

// ---------------------------------------------------------------------------
// Section classification
// ---------------------------------------------------------------------------

function classifyHeading(h: string): SectionKind {
  const t = h.toLowerCase();
  if (/summary|profile|objective|about\s*me|overview/.test(t)) return "summary";
  if (
    /experience|employment|work\s*history|career|professional\s*background/.test(
      t,
    )
  )
    return "experience";
  if (/education|academic|qualification|training|course/.test(t))
    return "education";
  if (/skill|competenc|technical|expertise|proficienc|technolog/.test(t))
    return "skills";
  return "other";
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE =
  /(\+?\d[\d\s().-]{7,}\d)/;
const URL_RE =
  /((https?:\/\/|www\.)[^\s]+|(?:linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com)\/[^\s]+)/i;

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const MY = `(?:${MONTH}\\s+)?\\d{4}`;
const ENDT = `(?:present|current|now|ongoing|to\\s+date|${MY})`;
const DATE_RANGE = new RegExp(
  `${MY}\\s*(?:\\u2013|\\u2014|-|to|until)\\s*${ENDT}`,
  "i",
);

function extractDates(lines: string[]): { dates: string; lines: string[] } {
  let dates = "";
  const out: string[] = [];
  for (const line of lines) {
    if (!dates) {
      const m = DATE_RANGE.exec(line);
      if (m) {
        dates = m[0].replace(/\s+/g, " ").trim();
        const rest = line.replace(m[0], "").replace(/[|,–—-]\s*$/, "").trim();
        if (rest) out.push(rest);
        continue;
      }
    }
    out.push(line);
  }
  return { dates, lines: out };
}

const FIELD_SPLIT = /\s*(?:\||\t|–|—| - | at | @ )\s*/;

function splitFields(lines: string[]): string[] {
  const fields: string[] = [];
  for (const l of lines) {
    for (const part of l.split(FIELD_SPLIT).map((s) => s.trim())) {
      if (part) fields.push(part);
    }
  }
  return fields;
}

interface EntryBlock {
  headerLines: string[];
  bullets: string[];
  headParas: Para[];
}

function parseEntryBlocks(paras: Para[]): EntryBlock[] {
  const items: EntryBlock[] = [];
  let cur: EntryBlock | null = null;
  for (const p of paras) {
    if (!p.text) continue;
    if (p.isBullet) {
      if (!cur) cur = { headerLines: [], bullets: [], headParas: [] };
      cur.bullets.push(stripBulletGlyph(p.text));
    } else {
      // A header line after we've already collected bullets means a new entry.
      if (cur && cur.bullets.length > 0) {
        items.push(cur);
        cur = null;
      }
      if (!cur) cur = { headerLines: [], bullets: [], headParas: [] };
      cur.headerLines.push(p.text);
      cur.headParas.push(p);
    }
  }
  if (cur) items.push(cur);
  return items;
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

export async function parseResumeDocx(buffer: Buffer): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    throw new Error("Not a valid .docx: word/document.xml is missing");
  }
  const documentXml = await docFile.async("string");
  const stylesFile = zip.file("word/styles.xml");
  const stylesXml = stylesFile ? await stylesFile.async("string") : undefined;

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
  });

  const resolver = new StyleResolver(
    stylesXml ? parser.parse(stylesXml) : undefined,
  );

  const doc = parser.parse(documentXml);
  const body = doc?.["w:document"]?.["w:body"];
  const rawParas = toArray<XmlNode>(body?.["w:p"]);

  const paras: Para[] = rawParas.map((p) => buildPara(p, resolver));

  const warnings: string[] = [];

  // Body font size = most common size among non-empty, non-heading-styled lines.
  const sizeFreq = new Map<number, number>();
  for (const p of paras) {
    if (!p.text || p.headingLevel != null) continue;
    if (p.fontSizePt == null) continue;
    sizeFreq.set(p.fontSizePt, (sizeFreq.get(p.fontSizePt) ?? 0) + 1);
  }
  let bodyFontSizePt: number | null = null;
  let bestFreq = 0;
  for (const [size, freq] of sizeFreq) {
    if (freq > bestFreq) {
      bestFreq = freq;
      bodyFontSizePt = size;
    }
  }

  const firstNonEmpty = paras.findIndex((p) => p.text.length > 0);

  // If the author used real Word "Heading" styles, trust ONLY those as section
  // headings. Otherwise a bold, slightly-larger job-title line (e.g.
  // "Senior Analyst | Acme Corp") would be mistaken for a section heading and
  // shatter the Experience grouping. The bold/size heuristic is a fallback for
  // documents that use no heading styles at all.
  const hasStyledHeadings = paras.some(
    (p) => p.headingLevel != null && p.headingLevel >= 1,
  );

  // Second pass: mark section headings (never the name paragraph).
  paras.forEach((p, idx) => {
    if (!p.text || idx === firstNonEmpty) return;
    if (p.headingLevel != null && p.headingLevel >= 1) {
      p.isHeading = true;
      return;
    }
    if (hasStyledHeadings || p.isBullet) return;
    // Heuristic fallback only. Skip anything that reads like an entry header
    // (a field separator or a date range) rather than a section title.
    if (/\||\sat\s|–|—| - /.test(p.text) || DATE_RANGE.test(p.text)) return;
    const bigger =
      p.fontSizePt != null &&
      bodyFontSizePt != null &&
      p.fontSizePt > bodyFontSizePt;
    if (p.bold && wordCount(p.text) <= 6 && (bigger || isAllCaps(p.text))) {
      p.isHeading = true;
    }
  });

  // Style samples for the style map.
  const samples: {
    name?: StyleEntry;
    sectionHeading?: StyleEntry;
    jobTitle?: StyleEntry;
    body?: StyleEntry;
    bullet?: StyleEntry;
  } = {};
  if (firstNonEmpty >= 0) samples.name = paras[firstNonEmpty].style;
  for (const p of paras) {
    if (!samples.sectionHeading && p.isHeading) samples.sectionHeading = p.style;
    if (!samples.bullet && p.isBullet && p.text) samples.bullet = p.style;
    if (
      !samples.body &&
      p.text &&
      !p.isHeading &&
      !p.isBullet &&
      p.fontSizePt === bodyFontSizePt
    ) {
      samples.body = p.style;
    }
  }

  // --- Split into pre-section region + heading-delimited sections ---
  const sections: ResumeSection[] = [];
  let sid = 0;
  const nextId = () => `sec-${sid++}`;

  const firstHeadingIdx = paras.findIndex((p) => p.isHeading);
  const preRegion =
    firstHeadingIdx === -1 ? paras : paras.slice(0, firstHeadingIdx);

  // Contact section from the pre-region.
  sections.push(buildContactSection(preRegion, firstNonEmpty, nextId(), warnings));

  // Grouped sections.
  interface Group {
    heading: string;
    kind: SectionKind;
    paras: Para[];
  }
  const groups: Group[] = [];
  let curGroup: Group | null = null;
  const startIdx = firstHeadingIdx === -1 ? paras.length : firstHeadingIdx;
  for (let i = startIdx; i < paras.length; i++) {
    const p = paras[i];
    if (p.isHeading) {
      curGroup = { heading: p.text, kind: classifyHeading(p.text), paras: [] };
      groups.push(curGroup);
    } else if (curGroup) {
      curGroup.paras.push(p);
    }
  }

  for (const g of groups) {
    let jobTitleSample: StyleEntry | undefined;
    const section = buildSection(g.kind, g.heading, g.paras, nextId(), warnings, (s) => {
      jobTitleSample = s;
    });
    if (jobTitleSample && !samples.jobTitle) samples.jobTitle = jobTitleSample;
    sections.push(section);
  }

  // Fallbacks so every element has a concrete style.
  const bodyStyle =
    samples.body ??
    samples.bullet ??
    samples.name ?? {
      fontFamily: resolver.docDefaultRpr().fontFamily ?? null,
      fontSizePt:
        resolver.docDefaultRpr().sizeHalfPt != null
          ? resolver.docDefaultRpr().sizeHalfPt! / 2
          : null,
      bold: false,
      italic: false,
      color: null,
    };
  const styleMap: StyleMap = {
    version: 1,
    defaults: {
      fontFamily: resolver.docDefaultRpr().fontFamily ?? bodyStyle.fontFamily,
      fontSizePt:
        resolver.docDefaultRpr().sizeHalfPt != null
          ? resolver.docDefaultRpr().sizeHalfPt! / 2
          : bodyStyle.fontSizePt,
      color: resolver.docDefaultRpr().color ?? null,
    },
    elements: {
      name: samples.name ?? bodyStyle,
      sectionHeading: samples.sectionHeading ?? bodyStyle,
      jobTitle: samples.jobTitle ?? samples.sectionHeading ?? bodyStyle,
      body: bodyStyle,
      bullet: samples.bullet ?? bodyStyle,
    },
  };

  if (firstNonEmpty === -1) {
    warnings.push(
      "The document appears to be empty — no text could be extracted.",
    );
  }
  if (!styleMap.elements.body.fontFamily) {
    warnings.push(
      "Could not detect the base font family from the document. Check the style map.",
    );
  }

  return {
    resumeJson: { version: 1, sections },
    styleMap,
    warnings,
  };
}

function buildContactSection(
  preRegion: Para[],
  firstNonEmpty: number,
  id: string,
  warnings: string[],
): ResumeSection {
  const lines = preRegion.filter((p) => p.text.length > 0).map((p) => p.text);
  let name = "";
  if (firstNonEmpty >= 0 && preRegion[firstNonEmpty]) {
    name = preRegion[firstNonEmpty].text;
  } else if (lines.length > 0) {
    name = lines[0];
  }
  const rest = name && lines[0] === name ? lines.slice(1) : lines;

  // Contact details are usually one line, separator-delimited
  // ("email | phone | City, State | linkedin.com/..."). Tokenise every line
  // and classify each token so nothing is dropped.
  let email = "";
  let phone = "";
  const links: string[] = [];
  const misc: string[] = [];
  for (const line of rest) {
    const tokens = line
      .split(/\s*[|•·•▪\t]+\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const em = EMAIL_RE.exec(token);
      if (em) {
        if (!email) email = em[0];
        continue;
      }
      const url = URL_RE.exec(token);
      if (url) {
        links.push(url[0]);
        continue;
      }
      const ph = PHONE_RE.exec(token);
      if (ph) {
        if (!phone) phone = ph[0].trim();
        continue;
      }
      misc.push(token);
    }
  }

  // location: first leftover token that looks like "City, Region".
  let location = "";
  const locIdx = misc.findIndex(
    (l) => /,\s*[A-Za-z]/.test(l) && wordCount(l) <= 6,
  );
  if (locIdx >= 0) {
    location = misc[locIdx];
    misc.splice(locIdx, 1);
  }
  const otherLines = misc;

  if (!name) warnings.push("Could not detect your name at the top of the resume.");
  if (!email && !phone)
    warnings.push(
      "Could not detect an email or phone number in the contact block — add it in the review screen.",
    );

  return {
    id,
    kind: "contact",
    heading: "Contact",
    name,
    email,
    phone,
    location,
    links,
    otherLines,
  };
}

function buildSection(
  kind: SectionKind,
  heading: string,
  paras: Para[],
  id: string,
  warnings: string[],
  onJobTitleSample: (s: StyleEntry) => void,
): ResumeSection {
  switch (kind) {
    case "summary": {
      const paragraphs = paras
        .map((p) => stripBulletGlyph(p.text))
        .filter(Boolean);
      return { id, kind: "summary", heading, paragraphs };
    }
    case "skills": {
      const items: string[] = [];
      const seen = new Set<string>();
      for (const p of paras) {
        const line = stripBulletGlyph(p.text);
        if (!line) continue;
        const parts = line
          .split(/[•·|,;]|\s{2,}|\t/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const part of parts) {
          const key = part.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            items.push(part);
          }
        }
      }
      return { id, kind: "skills", heading, items };
    }
    case "experience": {
      const blocks = parseEntryBlocks(paras);
      const items: ExperienceItem[] = blocks.map((b, idx) => {
        if (idx === 0 && b.headParas[0]) onJobTitleSample(b.headParas[0].style);
        const { dates, lines } = extractDates(b.headerLines);
        const fields = splitFields(lines);
        const [title = "", company = "", location = "", ...leftover] = fields;
        return {
          id: `exp-${idx}`,
          title,
          company,
          dates,
          location,
          bullets: [...leftover, ...b.bullets],
        };
      });
      if (items.length === 0 && paras.some((p) => p.text)) {
        warnings.push(
          `The "${heading}" section had text but no work entries could be separated — review it.`,
        );
      }
      return { id, kind: "experience", heading, items };
    }
    case "education": {
      const blocks = parseEntryBlocks(paras);
      const items: EducationItem[] = blocks.map((b, idx) => {
        const { dates, lines } = extractDates(b.headerLines);
        const fields = splitFields(lines);
        const [institution = "", qualification = "", location = "", ...leftover] =
          fields;
        return {
          id: `edu-${idx}`,
          institution,
          qualification,
          dates,
          location,
          details: [...leftover, ...b.bullets],
        };
      });
      return { id, kind: "education", heading, items };
    }
    default: {
      const paragraphs: string[] = [];
      const bullets: string[] = [];
      for (const p of paras) {
        if (!p.text) continue;
        if (p.isBullet) bullets.push(stripBulletGlyph(p.text));
        else paragraphs.push(p.text);
      }
      warnings.push(
        `Section "${heading || "(untitled)"}" wasn't recognised and was placed in "Other". Reassign it on the review screen if needed.`,
      );
      return { id, kind: "other", heading, paragraphs, bullets };
    }
  }
}
