import { Router, type IRouter } from "express";
import { db, eq, documentsTable, jobsTable, profileTable, type Document, type Job, type Profile } from "../lib/db";
import { serializeDocument } from "../lib/serialize";
import { uploadObject, downloadObject, deleteObject, newObjectKey } from "../lib/objectStore";
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
import { groupSkills } from "../lib/skillGrouping";

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
 * Force a document's cached .docx/.pdf to be rebuilt on the next download.
 * Clears the stored object keys (and best-effort deletes the stale objects)
 * so the next `/download/:format` call re-renders from the current
 * content_json + style map instead of serving the old cached file.
 */
router.post("/documents/:id/regenerate", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.type !== "resume" && doc.type !== "cover_letter") {
    res.status(400).json({
      error: "Only the resume and full cover letter can be regenerated.",
    });
    return;
  }

  const staleKeys = [doc.docxObjectKey, doc.pdfObjectKey].filter((k): k is string => Boolean(k));
  await db
    .update(documentsTable)
    .set({ docxObjectKey: null, pdfObjectKey: null })
    .where(eq(documentsTable.id, doc.id));

  await Promise.all(
    staleKeys.map((key) =>
      deleteObject(key).catch((err) => req.log.warn({ err, key }, "Failed to delete stale document object")),
    ),
  );

  res.json(serializeDocument({ ...doc, docxObjectKey: null, pdfObjectKey: null }));
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

/**
 * Every downloaded resume is a per-job tailored snapshot frozen in
 * `contentJson` at tailoring time, but contact details (name, email, phone,
 * location, links, and extra lines like a headline) are profile-level facts,
 * not something that should be "tailored" per job. Without this, editing or
 * removing a contact line in the profile (e.g. an outdated job title) would
 * never show up in already-tailored documents — the frozen snapshot would
 * keep serving the stale line forever, even after "regenerate". Always
 * overlay the resume's contact section with the current profile contact
 * section so every download reflects the latest profile info.
 */
function withCurrentContact(resume: ResumeJson, profile: Profile | undefined): ResumeJson {
  const baseResume = (profile?.resumeJson as ResumeJson | null) ?? null;
  const currentContact = baseResume?.sections?.find((s) => s.kind === "contact");
  if (!currentContact) return resume;
  const idx = resume.sections.findIndex((s) => s.kind === "contact");
  if (idx === -1) return resume;
  const sections = resume.sections.slice();
  sections[idx] = currentContact;
  return { ...resume, sections };
}

/**
 * Skills are grouped into labelled disciplines for display (see
 * `groupSkills`), but documents tailored before grouping existed only have a
 * flat `items` list. Group them once on first render and persist the result
 * onto the document row (the stored, non-contact-overridden `contentJson`)
 * so it's a one-time AI call per document rather than repeated on every
 * download. Grouping is a nice-to-have — any failure (no API key, bad
 * response, etc.) just falls back to the existing flat rendering.
 */
async function withGroupedSkills(doc: Document, resume: ResumeJson): Promise<ResumeJson> {
  const idx = resume.sections.findIndex((s) => s.kind === "skills");
  if (idx === -1) return resume;
  const skillsSec = resume.sections[idx];
  if (skillsSec.kind !== "skills" || (skillsSec.groups && skillsSec.groups.length > 0)) return resume;

  try {
    const groups = await groupSkills(skillsSec.items);
    if (!groups) return resume;

    const sections = resume.sections.slice();
    sections[idx] = { ...skillsSec, groups };
    const grouped: ResumeJson = { ...resume, sections };

    const stored = doc.contentJson as ResumeJson;
    const storedIdx = stored.sections.findIndex((s) => s.kind === "skills");
    const storedSkillsSec = storedIdx !== -1 ? stored.sections[storedIdx] : undefined;
    if (storedSkillsSec && storedSkillsSec.kind === "skills") {
      const storedSections = stored.sections.slice();
      storedSections[storedIdx] = { ...storedSkillsSec, groups };
      await db
        .update(documentsTable)
        .set({ contentJson: { ...stored, sections: storedSections } })
        .where(eq(documentsTable.id, doc.id));
    }

    return grouped;
  } catch {
    return resume;
  }
}

async function buildFile(
  doc: Document,
  job: Job | undefined,
  style: StyleMap,
  profile: Profile | undefined,
  format: "docx" | "pdf",
): Promise<Buffer> {
  if (doc.type === "resume") {
    const stored = doc.contentJson as ResumeJson | null;
    if (!stored || !Array.isArray(stored.sections)) throw new Error("Resume content is missing.");
    const resume = await withGroupedSkills(doc, withCurrentContact(stored, profile));
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
