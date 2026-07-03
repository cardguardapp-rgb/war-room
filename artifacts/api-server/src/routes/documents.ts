import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db, type DocumentRow, type JobRow, type ProfileRow } from "../lib/db";
import { uploadsDir } from "../lib/paths";
import {
  buildResumeDocx,
  buildCoverLetterDocx,
  candidateName,
  defaultStyleMap,
  docFilename,
} from "../lib/docBuild";
import {
  docxToPdf,
  SofficeUnavailableError,
  buildResumePdfFallback,
  buildCoverLetterPdfFallback,
} from "../lib/pdf";
import type { ResumeJson, StyleMap } from "../lib/resumeParser";
import type { CoverLetterFull } from "../lib/coverLetters";

const router: IRouter = Router();

fs.mkdirSync(uploadsDir, { recursive: true });

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

function parseJson<T>(value: string | null): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

router.get("/jobs/:id/documents", (req, res): void => {
  const jobId = parseId(req.params.id);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  if (!db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const documents = db
    .prepare("SELECT * FROM documents WHERE job_id = ? ORDER BY created_at DESC, id DESC")
    .all(jobId) as DocumentRow[];
  res.json(documents);
});

// Cover-letter / resume document generation now happens via the tailoring and
// cover-letter flows; the old generic generate endpoint stays stubbed.
router.post("/jobs/:id/documents/generate", (_req, res): void => {
  res.status(501).json({
    status: "not_implemented",
    message: "Use the tailoring / cover-letter flows to create documents.",
  });
});

/**
 * Download a resume or full cover-letter document as .docx or .pdf. Files are
 * built on demand from the stored content_json + the profile style map, cached
 * to disk, and the path recorded on the row.
 */
router.get("/documents/:id/download/:format", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const format = String(req.params.format);
  if (id === null) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }
  if (format !== "docx" && format !== "pdf") {
    res.status(400).json({ error: "Format must be docx or pdf" });
    return;
  }

  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | DocumentRow
    | undefined;
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.type !== "resume" && doc.type !== "cover_letter") {
    res.status(400).json({
      error: "Only the resume and full cover letter can be downloaded as a file.",
    });
    return;
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(doc.job_id) as
    | JobRow
    | undefined;
  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as
    | ProfileRow
    | undefined;
  const style = parseJson<StyleMap>(profile?.style_map_json ?? null) ?? defaultStyleMap();

  // Serve the cached file if we already built it.
  const cachedName = format === "docx" ? doc.docx_path : doc.pdf_path;
  if (cachedName) {
    const cachedPath = path.join(uploadsDir, cachedName);
    if (fs.existsSync(cachedPath)) {
      res.download(cachedPath, downloadName(doc, job, profile, format));
      return;
    }
  }

  try {
    const buffer = await buildFile(doc, job, style, profile, format);
    const stored = `doc-${doc.id}-${doc.type}.${format}`;
    fs.writeFileSync(path.join(uploadsDir, stored), buffer);
    db.prepare(
      `UPDATE documents SET ${format === "docx" ? "docx_path" : "pdf_path"} = ? WHERE id = ?`,
    ).run(stored, doc.id);

    res.download(path.join(uploadsDir, stored), downloadName(doc, job, profile, format));
  } catch (err) {
    req.log.error({ err, documentId: id, format }, "Document render failed");
    res.status(500).json({ error: "Could not generate that file. Please try again." });
  }
});

function downloadName(
  doc: DocumentRow,
  job: JobRow | undefined,
  profile: ProfileRow | undefined,
  format: "docx" | "pdf",
): string {
  const resume = parseJson<ResumeJson>(profile?.resume_json ?? null);
  const name =
    doc.type === "resume"
      ? candidateName(parseJson<ResumeJson>(doc.content_json))
      : candidateName(resume);
  return docFilename(name, job?.company ?? null, doc.type === "resume" ? "Resume" : "Cover-Letter", format);
}

async function buildFile(
  doc: DocumentRow,
  job: JobRow | undefined,
  style: StyleMap,
  profile: ProfileRow | undefined,
  format: "docx" | "pdf",
): Promise<Buffer> {
  if (doc.type === "resume") {
    const resume = parseJson<ResumeJson>(doc.content_json);
    if (!resume || !Array.isArray(resume.sections)) throw new Error("Resume content is missing.");
    const docx = await buildResumeDocx(resume, style);
    if (format === "docx") return docx;
    try {
      return await docxToPdf(docx);
    } catch (err) {
      if (err instanceof SofficeUnavailableError) return buildResumePdfFallback(resume, style);
      throw err;
    }
  }

  // cover_letter
  const full = parseJson<CoverLetterFull>(doc.content_json);
  if (!full || typeof full.body !== "string") throw new Error("Cover letter content is missing.");
  const name = candidateName(parseJson<ResumeJson>(profile?.resume_json ?? null));
  void job;
  const docx = await buildCoverLetterDocx(full, name, style);
  if (format === "docx") return docx;
  try {
    return await docxToPdf(docx);
  } catch (err) {
    if (err instanceof SofficeUnavailableError) return buildCoverLetterPdfFallback(full, name, style);
    throw err;
  }
}

export default router;
