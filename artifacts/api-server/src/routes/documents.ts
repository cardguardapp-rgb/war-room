import { Router, type IRouter } from "express";
import { db, eq, documentsTable, jobsTable, profileTable, type Document, type Job, type Profile } from "../lib/db";
import { serializeDocument } from "../lib/serialize";
import { uploadObject, downloadObject, newObjectKey } from "../lib/objectStore";
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

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

router.get("/jobs/:id/documents", async (req, res): Promise<void> => {
  const jobId = parseId(req.params.id);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const documents = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.jobId, jobId))
    .orderBy(documentsTable.createdAt, documentsTable.id);
  res.json(documents.reverse().map(serializeDocument));
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
 * in object storage, and the key recorded on the row.
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

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
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

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, doc.jobId));
  const [profile] = await db.select().from(profileTable).where(eq(profileTable.id, 1));
  const style = (profile?.styleMapJson as StyleMap | null) ?? defaultStyleMap();

  const cachedKey = format === "docx" ? doc.docxObjectKey : doc.pdfObjectKey;
  if (cachedKey) {
    try {
      const buffer = await downloadObject(cachedKey);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${downloadName(doc, job, profile, format)}"`,
      );
      res.send(buffer);
      return;
    } catch {
      // fall through and rebuild
    }
  }

  try {
    const buffer = await buildFile(doc, job, style, profile, format);
    const key = newObjectKey(format);
    await uploadObject(
      key,
      buffer,
      format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    );
    await db
      .update(documentsTable)
      .set(format === "docx" ? { docxObjectKey: key } : { pdfObjectKey: key })
      .where(eq(documentsTable.id, doc.id));

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName(doc, job, profile, format)}"`,
    );
    res.send(buffer);
  } catch (err) {
    req.log.error({ err, documentId: id, format }, "Document render failed");
    res.status(500).json({ error: "Could not generate that file. Please try again." });
  }
});

function downloadName(
  doc: Document,
  job: Job | undefined,
  profile: Profile | undefined,
  format: "docx" | "pdf",
): string {
  const resume = (profile?.resumeJson as ResumeJson | null) ?? null;
  const name =
    doc.type === "resume"
      ? candidateName(doc.contentJson as ResumeJson | null)
      : candidateName(resume);
  return docFilename(name, job?.company ?? null, doc.type === "resume" ? "Resume" : "Cover-Letter", format);
}

async function buildFile(
  doc: Document,
  job: Job | undefined,
  style: StyleMap,
  profile: Profile | undefined,
  format: "docx" | "pdf",
): Promise<Buffer> {
  if (doc.type === "resume") {
    const resume = doc.contentJson as ResumeJson | null;
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
  const full = doc.contentJson as CoverLetterFull | null;
  if (!full || typeof full.body !== "string") throw new Error("Cover letter content is missing.");
  const name = candidateName((profile?.resumeJson as ResumeJson | null) ?? null);
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
