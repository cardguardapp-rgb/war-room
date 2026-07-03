import fs from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db, type DocumentRow, type JobRow } from "../lib/db";
import { uploadsDir } from "../lib/paths";

const router: IRouter = Router();

const VALID_TYPES = [
  "resume",
  "cover_letter",
  "cover_letter_plain",
  "cover_note",
] as const;

function parseId(raw: unknown): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = parseInt(String(value), 10);
  return Number.isNaN(id) ? null : id;
}

router.get("/jobs/:id/documents", (req, res): void => {
  const jobId = parseId(req.params.id);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const job = db.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const documents = db
    .prepare(
      "SELECT * FROM documents WHERE job_id = ? ORDER BY created_at DESC",
    )
    .all(jobId) as DocumentRow[];

  res.json(documents);
});

router.post("/jobs/:id/documents/generate", (req, res): void => {
  const jobId = parseId(req.params.id);
  if (jobId === null) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    | JobRow
    | undefined;
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const { type } = req.body ?? {};
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ error: "Invalid document type" });
    return;
  }

  res.status(501).json({
    status: "not_implemented",
    message: "Document generation is not implemented yet",
  });
});

router.get("/documents/:id/download", (req, res): void => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid document id" });
    return;
  }

  const document = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
    | DocumentRow
    | undefined;

  if (!document) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const filePath = document.docx_path ?? document.pdf_path;
  if (!filePath) {
    res.status(501).json({
      status: "not_implemented",
      message: "This document has no generated file yet",
    });
    return;
  }

  const absolutePath = path.join(uploadsDir, filePath);
  if (!fs.existsSync(absolutePath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  res.download(absolutePath);
});

export default router;
