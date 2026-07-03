import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  type IParagraphOptions,
} from "docx";
import type { ResumeJson, StyleEntry, StyleMap } from "./resumeParser";
import type { CoverLetterFull } from "./coverLetters";

// ATS-safe: single column, real paragraphs + text runs, no tables/text boxes/
// images. Fonts, sizes, colours and bold weights come from the Phase 2 style
// map so the output matches the candidate's original resume.

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
  const bodyFont = el.body?.fontFamily ?? style.defaults.fontFamily ?? undefined;

  const runFor = (
    text: string,
    entry: StyleEntry | undefined,
    fallbackPt: number,
    boldOverride?: boolean,
  ): TextRun =>
    new TextRun({
      text,
      font: entry?.fontFamily ?? bodyFont,
      size: halfPt(entry?.fontSizePt, fallbackPt),
      bold: boldOverride ?? entry?.bold ?? false,
      italics: entry?.italic ?? false,
      color: hex(entry?.color),
    });

  const para = (children: TextRun[], opts?: IParagraphOptions): Paragraph =>
    new Paragraph({ children, ...opts });

  const headingPara = (text: string): Paragraph =>
    new Paragraph({
      children: [runFor(text.toUpperCase(), el.sectionHeading, 13, el.sectionHeading?.bold ?? true)],
      spacing: { before: 200, after: 60 },
      border: {
        bottom: {
          color: hex(el.sectionHeading?.color) ?? "999999",
          size: 6,
          style: BorderStyle.SINGLE,
          space: 1,
        },
      },
    });

  const bulletPara = (text: string): Paragraph =>
    para([runFor(`•  ${text}`, el.bullet, 11)], {
      spacing: { after: 40 },
      indent: { left: 260, hanging: 180 },
    });

  const children: Paragraph[] = [];

  for (const sec of resume.sections) {
    switch (sec.kind) {
      case "contact": {
        if (sec.name) {
          children.push(para([runFor(sec.name, el.name, 22, el.name?.bold ?? true)], { spacing: { after: 40 } }));
        }
        const contact = [sec.email, sec.phone, sec.location, ...sec.links, ...sec.otherLines]
          .filter(Boolean)
          .join("   |   ");
        if (contact) children.push(para([runFor(contact, el.body, 11)], { spacing: { after: 160 } }));
        break;
      }
      case "summary": {
        children.push(headingPara(sec.heading || "Summary"));
        sec.paragraphs.forEach((p, i) =>
          children.push(
            para([runFor(p, el.body, 11)], {
              spacing: { after: i === sec.paragraphs.length - 1 ? 160 : 100 },
            }),
          ),
        );
        break;
      }
      case "experience": {
        children.push(headingPara(sec.heading || "Experience"));
        sec.items.forEach((it, idx) => {
          const titleText = [it.title, it.company].filter(Boolean).join("  —  ");
          if (titleText)
            children.push(
              para([runFor(titleText, el.jobTitle, 12, el.jobTitle?.bold ?? true)], {
                spacing: { before: idx === 0 ? 40 : 160, after: 0 },
              }),
            );
          const meta = [it.dates, it.location].filter(Boolean).join("   ·   ");
          if (meta) children.push(para([runFor(meta, el.body, 10)], { spacing: { after: 40 } }));
          it.bullets.forEach((b) => children.push(bulletPara(b)));
        });
        break;
      }
      case "education": {
        children.push(headingPara(sec.heading || "Education"));
        sec.items.forEach((it, idx) => {
          const line = [it.institution, it.qualification].filter(Boolean).join("  —  ");
          if (line)
            children.push(
              para([runFor(line, el.jobTitle, 12, true)], {
                spacing: { before: idx === 0 ? 40 : 160, after: 0 },
              }),
            );
          const meta = [it.dates, it.location].filter(Boolean).join("   ·   ");
          if (meta) children.push(para([runFor(meta, el.body, 10)], { spacing: { after: 40 } }));
          it.details.forEach((d) => children.push(bulletPara(d)));
        });
        break;
      }
      case "skills": {
        children.push(headingPara(sec.heading || "Skills"));
        if (sec.items.length)
          children.push(para([runFor(sec.items.join("   •   "), el.body, 11)], { spacing: { after: 160 } }));
        break;
      }
      case "other": {
        children.push(headingPara(sec.heading || "Other"));
        sec.paragraphs.forEach((p) => children.push(para([runFor(p, el.body, 11)], { spacing: { after: 80 } })));
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
  const bodyFont = el.body?.fontFamily ?? style.defaults.fontFamily ?? undefined;
  const size = halfPt(el.body?.fontSizePt, 11);

  const run = (text: string, bold = false): TextRun =>
    new TextRun({ text, font: bodyFont, size, bold, color: hex(el.body?.color) });

  const children: Paragraph[] = [];
  if (full.salutation)
    children.push(new Paragraph({ children: [run(full.salutation)], spacing: { after: 200 } }));
  if (full.re)
    children.push(new Paragraph({ children: [run(full.re, true)], spacing: { after: 200 } }));
  full.body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((p) => children.push(new Paragraph({ children: [run(p)], spacing: { after: 160 } })));
  children.push(new Paragraph({ children: [run("Sincerely,")], spacing: { after: 40 } }));
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
