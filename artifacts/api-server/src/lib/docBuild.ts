import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  TabStopType,
  type IParagraphOptions,
} from "docx";
import type { ResumeJson, StyleEntry, StyleMap } from "./resumeParser";
import type { CoverLetterFull } from "./coverLetters";

// ATS-safe: single column, real paragraphs + text runs, no tables/text boxes/
// images. Sizes, colours and bold weights come from the Phase 2 style map so
// the output matches the candidate's original resume, but the font family is
// always overridden to a clean sans-serif (see `SANS_SERIF_FONT`) regardless
// of what the source document used, per user preference for readability.
//
// IMPORTANT: this name must be a font that is actually installed in the
// container LibreOffice runs in (`fc-list`). This box only ships DejaVu Sans
// / DejaVu Serif — no Calibri, Arial, or Helvetica. Requesting a font that
// isn't installed causes LibreOffice to silently substitute *something*
// (which is not guaranteed to be sans-serif), so we point directly at the
// installed sans family rather than a common Windows/Mac font name.
const SANS_SERIF_FONT = "DejaVu Sans";

/** Bullet hanging-indent distance (twips) shared by bullet text and its tab stop. */
const BULLET_INDENT = 320;

/** Skills are capped so the list stays scannable instead of sprawling. */
const MAX_SKILLS = 10;

/** Group items into fixed-size chunks, e.g. for a compact multi-per-line skills layout. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function hex(color: string | null | undefined): string | undefined {
  if (!color) return undefined;
  return color.replace(/^#/, "");
}

function halfPt(sizePt: number | null | undefined, fallback: number): number {
  const pt = sizePt && sizePt > 0 ? sizePt : fallback;
  return Math.round(pt * 2);
}

export function buildResumeDocx(resume: ResumeJson, style: StyleMap): Promise<Buffer> {
  const el = style.elements;

  const runFor = (
    text: string,
    entry: StyleEntry | undefined,
    fallbackPt: number,
    boldOverride?: boolean,
  ): TextRun =>
    new TextRun({
      text,
      font: SANS_SERIF_FONT,
      size: halfPt(entry?.fontSizePt, fallbackPt),
      bold: boldOverride ?? entry?.bold ?? false,
      italics: entry?.italic ?? false,
      color: hex(entry?.color),
    });

  const para = (children: TextRun[], opts?: IParagraphOptions): Paragraph =>
    new Paragraph({ children, ...opts });

  // Section headings are marked `keepNext` so Word never leaves a heading
  // orphaned at the bottom of a page with its content pushed to the next —
  // if it doesn't fit with what follows, the whole heading+content moves
  // together to a fresh page.
  const headingPara = (text: string): Paragraph =>
    new Paragraph({
      children: [runFor(text.toUpperCase(), el.sectionHeading, 13, el.sectionHeading?.bold ?? true)],
      spacing: { before: 420, after: 160 },
      keepNext: true,
      keepLines: true,
      border: {
        bottom: {
          color: hex(el.sectionHeading?.color) ?? "999999",
          size: 6,
          style: BorderStyle.SINGLE,
          space: 1,
        },
      },
    });

  // Bullet lines are always rendered in regular weight, never bold — even if
  // the extracted style map says otherwise. Some source documents put the
  // "•" glyph in its own run with different (often bold) formatting, which
  // can get sampled into `el.bullet` during parsing; a whole bold bullet
  // line is never actually the intent, so we hard-override it here as a
  // defense-in-depth measure independent of parser-side fixes.
  //
  // The bullet glyph and its text are separated by a real tab stop (rather
  // than literal spaces) landing exactly at the hanging-indent distance, so
  // the gap between "•" and the text is always a single, consistent width —
  // literal spaces would drift depending on font metrics and could look like
  // a stray extra space before the text starts.
  const bulletPara = (text: string, opts?: IParagraphOptions): Paragraph =>
    para([runFor(`•\t${text}`, el.bullet, 11, false)], {
      spacing: { after: 140, line: 280 },
      indent: { left: BULLET_INDENT, hanging: BULLET_INDENT },
      tabStops: [{ type: TabStopType.LEFT, position: BULLET_INDENT }],
      keepLines: true,
      ...opts,
    });

  const children: Paragraph[] = [];

  for (const sec of resume.sections) {
    switch (sec.kind) {
      case "contact": {
        if (sec.name) {
          children.push(
            para([runFor(sec.name, el.name, 22, el.name?.bold ?? true)], {
              spacing: { after: 100 },
              keepNext: true,
            }),
          );
        }
        const contact = [sec.email, sec.phone, sec.location, ...sec.links, ...sec.otherLines]
          .filter(Boolean)
          .join("   |   ");
        if (contact) children.push(para([runFor(contact, el.body, 11)], { spacing: { after: 320 } }));
        break;
      }
      case "summary": {
        children.push(headingPara(sec.heading || "Summary"));
        sec.paragraphs.forEach((p, i) =>
          children.push(
            para([runFor(p, el.body, 11)], {
              spacing: { after: i === sec.paragraphs.length - 1 ? 320 : 200, line: 300 },
              keepLines: true,
            }),
          ),
        );
        break;
      }
      case "experience": {
        children.push(headingPara(sec.heading || "Experience"));
        sec.items.forEach((it, idx) => {
          const entryParas: Paragraph[] = [];
          const titleText = [it.title, it.company].filter(Boolean).join("  —  ");
          if (titleText)
            entryParas.push(
              para([runFor(titleText, el.jobTitle, 12, el.jobTitle?.bold ?? true)], {
                spacing: { before: idx === 0 ? 80 : 300, after: 40 },
                keepNext: true,
                keepLines: true,
              }),
            );
          const meta = [it.dates, it.location].filter(Boolean).join("   ·   ");
          if (meta)
            entryParas.push(
              para([runFor(meta, el.body, 10)], {
                spacing: { after: 140 },
                keepNext: it.bullets.length > 0,
                keepLines: true,
              }),
            );
          it.bullets.forEach((b, bIdx) =>
            entryParas.push(bulletPara(b, { keepNext: bIdx < it.bullets.length - 1 })),
          );
          children.push(...entryParas);
        });
        break;
      }
      case "education": {
        children.push(headingPara(sec.heading || "Education"));
        sec.items.forEach((it, idx) => {
          const entryParas: Paragraph[] = [];
          const line = [it.institution, it.qualification].filter(Boolean).join("  —  ");
          if (line)
            entryParas.push(
              para([runFor(line, el.jobTitle, 12, true)], {
                spacing: { before: idx === 0 ? 80 : 300, after: 40 },
                keepNext: true,
                keepLines: true,
              }),
            );
          const meta = [it.dates, it.location].filter(Boolean).join("   ·   ");
          if (meta)
            entryParas.push(
              para([runFor(meta, el.body, 10)], {
                spacing: { after: 140 },
                keepNext: it.details.length > 0,
                keepLines: true,
              }),
            );
          it.details.forEach((d, dIdx) =>
            entryParas.push(bulletPara(d, { keepNext: dIdx < it.details.length - 1 })),
          );
          children.push(...entryParas);
        });
        break;
      }
      case "skills": {
        children.push(headingPara(sec.heading || "Skills"));
        // Items within a row/group are joined with a comma — a plain comma
        // list wraps naturally at any point (a trailing comma at line-end
        // reads normally), unlike a "•" or "·" separator, which can end up
        // stranded alone at the start of a wrapped line and look like a
        // rendering glitch. Still plain paragraphs/text runs (no
        // tables/columns), so it stays ATS-safe.
        const commaRow = (items: string[], isLast: boolean) => items.join(", ") + (isLast ? "." : ",");

        if (sec.groups && sec.groups.length > 0) {
          // Grouped into disciplines: a bold sub-heading line per group,
          // followed by its comma-joined skills — much more scannable than
          // one long undifferentiated list once there are more than a
          // handful of skills.
          sec.groups.forEach((group, gIdx) => {
            const isLastGroup = gIdx === sec.groups!.length - 1;
            if (group.label) {
              children.push(
                para([runFor(group.label, el.jobTitle, 11, el.jobTitle?.bold ?? true)], {
                  spacing: { before: gIdx === 0 ? 0 : 160, after: 60 },
                  keepNext: true,
                  keepLines: true,
                }),
              );
            }
            children.push(
              para([runFor(commaRow(group.items, true), el.body, 11)], {
                spacing: { after: isLastGroup ? 320 : 100, line: 300 },
                keepLines: true,
                keepNext: !isLastGroup,
              }),
            );
          });
        } else {
          // Flat fallback: capped at MAX_SKILLS and laid out as short,
          // evenly-grouped lines (a few skills per line) rather than one
          // bullet per skill or one giant comma-separated paragraph.
          const capped = sec.items.slice(0, MAX_SKILLS);
          const rows = chunk(capped, 3);
          rows.forEach((row, i) => {
            const isLast = i === rows.length - 1;
            children.push(
              para([runFor(commaRow(row, isLast), el.body, 11)], {
                spacing: { after: isLast ? 320 : 140, line: 300 },
                keepLines: true,
                keepNext: !isLast,
              }),
            );
          });
        }
        break;
      }
      case "other": {
        children.push(headingPara(sec.heading || "Other"));
        sec.paragraphs.forEach((p) =>
          children.push(
            para([runFor(p, el.body, 11)], { spacing: { after: 200, line: 300 }, keepLines: true }),
          ),
        );
        sec.bullets.forEach((b) => children.push(bulletPara(b)));
        break;
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 1080, right: 1080 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export function buildCoverLetterDocx(
  full: CoverLetterFull,
  name: string,
  style: StyleMap,
): Promise<Buffer> {
  const el = style.elements;
  const size = halfPt(el.body?.fontSizePt, 11);

  const run = (text: string, bold = false): TextRun =>
    new TextRun({ text, font: SANS_SERIF_FONT, size, bold, color: hex(el.body?.color) });

  const children: Paragraph[] = [];
  if (full.salutation)
    children.push(new Paragraph({ children: [run(full.salutation)], spacing: { after: 240 } }));
  if (full.re)
    children.push(new Paragraph({ children: [run(full.re, true)], spacing: { after: 240 } }));
  full.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((p) =>
      children.push(new Paragraph({ children: [run(p)], spacing: { after: 200, line: 300 } })),
    );
  children.push(new Paragraph({ children: [run("Sincerely,")], spacing: { after: 60 } }));
  if (name) children.push(new Paragraph({ children: [run(name)] }));

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// --- filename helpers ---

function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** e.g. docFilename("Amy Gibbons", "Acme Corp", "Resume", "docx") -> "Amy-Gibbons-Resume-Acme-Corp.docx" */
export function docFilename(
  candidateName: string,
  company: string | null,
  kind: "Resume" | "Cover-Letter",
  ext: "docx" | "pdf",
): string {
  const parts = [slug(candidateName) || "Candidate", kind];
  const c = company ? slug(company) : "";
  if (c) parts.push(c);
  return `${parts.join("-")}.${ext}`;
}

/** Extract the candidate's name from the parsed resume's contact section. */
export function candidateName(resume: ResumeJson | null): string {
  const contact = resume?.sections.find((s) => s.kind === "contact");
  if (contact && contact.kind === "contact" && contact.name) return contact.name;
  return "Candidate";
}

/** Fallback style map when a profile has no captured style (Calibri, navy heads). */
export function defaultStyleMap(): StyleMap {
  const entry = (fontSizePt: number, bold: boolean, color: string | null): StyleEntry => ({
    fontFamily: "Calibri",
    fontSizePt,
    bold,
    italic: false,
    color,
  });
  return {
    version: 1,
    defaults: { fontFamily: "Calibri", fontSizePt: 11, color: null },
    elements: {
      name: entry(22, true, "#1F3864"),
      sectionHeading: entry(13, true, "#1F3864"),
      jobTitle: entry(12, true, null),
      body: entry(11, false, null),
      bullet: entry(11, false, null),
    },
  };
}
