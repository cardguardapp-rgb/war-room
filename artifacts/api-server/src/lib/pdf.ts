import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { ResumeJson, ResumeSection, StyleEntry, StyleMap } from "./resumeParser";
import type { CoverLetterFull } from "./coverLetters";

export class SofficeUnavailableError extends Error {
  constructor() {
    super("LibreOffice (soffice) is not available for PDF conversion.");
    this.name = "SofficeUnavailableError";
  }
}

let sofficeResolved: string | null | undefined;

function resolveSoffice(): string | null {
  if (sofficeResolved !== undefined) return sofficeResolved;
  const candidates: string[] = [];
  if (process.env["SOFFICE_PATH"]) candidates.push(process.env["SOFFICE_PATH"]!);
  candidates.push("/usr/bin/soffice", "/usr/bin/libreoffice");
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        sofficeResolved = c;
        return c;
      }
    } catch {
      /* ignore */
    }
  }
  // Nix store: /nix/store/<hash>-libreoffice-<ver>-wrapped/bin/soffice
  try {
    const base = "/nix/store";
    for (const entry of fs.readdirSync(base)) {
      if (/libreoffice.*wrapped$/i.test(entry)) {
        const p = path.join(base, entry, "bin", "soffice");
        if (fs.existsSync(p)) {
          sofficeResolved = p;
          return p;
        }
      }
    }
  } catch {
    /* ignore */
  }
  sofficeResolved = null;
  return null;
}

/** Convert a .docx buffer to PDF using headless LibreOffice. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const soffice = resolveSoffice();
  if (!soffice) throw new SofficeUnavailableError();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loconv-"));
  const inPath = path.join(tmp, "doc.docx");
  const outPath = path.join(tmp, "doc.pdf");
  const userDir = path.join(tmp, "profile");
  fs.writeFileSync(inPath, docx);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        soffice,
        [
          `-env:UserInstallation=file://${userDir}`,
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          tmp,
          inPath,
        ],
        { stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("PDF conversion timed out."));
      }, 60000);
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(outPath)) resolve();
        else reject(new Error(`soffice exited with code ${code}`));
      });
    });
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// pdf-lib fallback — used only if LibreOffice can't be resolved. Not a pixel
// match for the .docx (Calibri -> Helvetica), but a clean single-column PDF.
// --------------------------------------------------------------------------

interface Block {
  text: string;
  sizePt: number;
  bold: boolean;
  color: [number, number, number];
  gapAfter: number;
  indent: number;
  /** Force a new page before this block (used for section headings). */
  breakBefore?: boolean;
  /** This block belongs to the same "keep together" group as the next block(s). */
  groupId?: number;
}

function hexToRgb(hex: string | null, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

function styleSize(entry: StyleEntry | undefined, fallback: number): number {
  return entry?.fontSizePt && entry.fontSizePt > 0 ? entry.fontSizePt : fallback;
}

function wrapLines(text: string, font: PDFFont, sizePt: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(trial, sizePt) > width && current) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");
  return lines;
}

async function blocksToPdf(blocks: Block[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const maxWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const blockHeight = (b: Block): number => {
    const font = b.bold ? bold : regular;
    const lineHeight = b.sizePt * 1.3;
    const lines = wrapLines(b.text, font, b.sizePt, maxWidth - b.indent);
    return lines.length * lineHeight + b.gapAfter;
  };

  // Group consecutive blocks that share a `groupId` (a heading + its entry,
  // or a full job/education entry) so a page break never lands in the
  // middle of one — if the whole group doesn't fit in the remaining space
  // but does fit on a fresh page, start a new page before the group.
  let i = 0;
  while (i < blocks.length) {
    let j = i;
    const gid = blocks[i].groupId;
    if (gid !== undefined) {
      while (j + 1 < blocks.length && blocks[j + 1].groupId === gid) j++;
    }
    const group = blocks.slice(i, j + 1);
    const groupHeight = group.reduce((sum, b) => sum + blockHeight(b), 0);

    if (groupHeight <= usableHeight && y - groupHeight < margin && y !== pageHeight - margin) {
      newPage();
    }

    for (const b of group) {
      const font = b.bold ? bold : regular;
      const lineHeight = b.sizePt * 1.3;
      const lines = wrapLines(b.text, font, b.sizePt, maxWidth - b.indent);

      for (const line of lines) {
        if (y - lineHeight < margin) newPage();
        page.drawText(line, {
          x: margin + b.indent,
          y: y - b.sizePt,
          size: b.sizePt,
          font,
          color: rgb(b.color[0], b.color[1], b.color[2]),
        });
        y -= lineHeight;
      }
      y -= b.gapAfter;
    }

    i = j + 1;
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

const BLACK: [number, number, number] = [0, 0, 0];

function resumeBlocks(resume: ResumeJson, style: StyleMap): Block[] {
  const el = style.elements;
  const bodySize = styleSize(el.body, 11);
  const blocks: Block[] = [];

  let nextGroupId = 1;

  // A section heading is grouped with the entry that immediately follows it
  // (or its own content, for flat sections) so a heading is never left
  // orphaned at the bottom of a page — see `blocksToPdf`'s grouping logic.
  const heading = (text: string, groupId?: number) =>
    blocks.push({
      text: text.toUpperCase(),
      sizePt: styleSize(el.sectionHeading, 13),
      bold: el.sectionHeading?.bold ?? true,
      color: hexToRgb(el.sectionHeading?.color ?? null, BLACK),
      gapAfter: 8,
      indent: 0,
      groupId,
    });
  const line = (text: string, opts: Partial<Block> = {}) =>
    blocks.push({
      text,
      sizePt: bodySize,
      bold: false,
      color: BLACK,
      gapAfter: 4,
      indent: 0,
      ...opts,
    });

  for (const sec of resume.sections) {
    switch (sec.kind) {
      case "contact":
        if (sec.name)
          blocks.push({
            text: sec.name,
            sizePt: styleSize(el.name, 22),
            bold: el.name?.bold ?? true,
            color: hexToRgb(el.name?.color ?? null, BLACK),
            gapAfter: 6,
            indent: 0,
          });
        line([sec.email, sec.phone, sec.location, ...sec.links, ...sec.otherLines].filter(Boolean).join("  |  "), { gapAfter: 16 });
        break;
      case "summary": {
        const gid = nextGroupId++;
        heading(sec.heading || "Summary", gid);
        sec.paragraphs.forEach((p) => line(p, { gapAfter: 10, groupId: gid }));
        blocks[blocks.length - 1].gapAfter = 16;
        break;
      }
      case "experience": {
        heading(sec.heading || "Experience");
        sec.items.forEach((it) => {
          const gid = nextGroupId++;
          line([it.title, it.company].filter(Boolean).join(" — "), {
            bold: el.jobTitle?.bold ?? true,
            sizePt: styleSize(el.jobTitle, bodySize),
            color: hexToRgb(el.jobTitle?.color ?? null, BLACK),
            groupId: gid,
          });
          const meta = [it.dates, it.location].filter(Boolean).join("  ·  ");
          if (meta) line(meta, { groupId: gid });
          it.bullets.forEach((b) => line(`•  ${b}`, { indent: 14, gapAfter: 4, groupId: gid }));
          if (blocks.length) blocks[blocks.length - 1].gapAfter = 14;
        });
        break;
      }
      case "education": {
        heading(sec.heading || "Education");
        sec.items.forEach((it) => {
          const gid = nextGroupId++;
          line([it.institution, it.qualification].filter(Boolean).join(" — "), { bold: true, groupId: gid });
          const meta = [it.dates, it.location].filter(Boolean).join("  ·  ");
          if (meta) line(meta, { groupId: gid });
          it.details.forEach((d) => line(`•  ${d}`, { indent: 14, groupId: gid }));
          if (blocks.length) blocks[blocks.length - 1].gapAfter = 14;
        });
        break;
      }
      case "skills":
        heading(sec.heading || "Skills");
        line(sec.items.join("  •  "), { gapAfter: 16 });
        break;
      case "other":
        heading(sec.heading || "Other");
        sec.paragraphs.forEach((p) => line(p, { gapAfter: 4 }));
        sec.bullets.forEach((b) => line(`•  ${b}`, { indent: 14 }));
        if (blocks.length) blocks[blocks.length - 1].gapAfter = 10;
        break;
    }
  }
  return blocks;
}

export async function buildResumePdfFallback(resume: ResumeJson, style: StyleMap): Promise<Buffer> {
  return blocksToPdf(resumeBlocks(resume, style));
}

export async function buildCoverLetterPdfFallback(
  full: CoverLetterFull,
  name: string,
  style: StyleMap,
): Promise<Buffer> {
  const bodySize = styleSize(style.elements.body, 11);
  const blocks: Block[] = [];
  const p = (text: string, gapAfter = 10, bold = false) =>
    blocks.push({ text, sizePt: bodySize, bold, color: BLACK, gapAfter, indent: 0 });

  if (full.salutation) p(full.salutation, 12);
  if (full.re) p(full.re, 12, true);
  full.body.split(/\n{2,}/).forEach((para) => p(para.trim(), 10));
  p("Sincerely,", 4);
  if (name) p(name, 0);
  return blocksToPdf(blocks);
}
