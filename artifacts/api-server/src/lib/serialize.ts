import type { Document, Job } from "./db";

/** The frontend expects snake_case field names — bridge Drizzle's camelCase columns. */
export function serializeJob(row: Job) {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    work_arrangement: row.workArrangement,
    source_url: row.sourceUrl,
    posting_text: row.postingText,
    status: row.status,
    created_at: row.createdAt,
  };
}

export function serializeDocument(row: Document) {
  return {
    id: row.id,
    job_id: row.jobId,
    type: row.type,
    content_json: row.contentJson,
    docx_object_key: row.docxObjectKey,
    pdf_object_key: row.pdfObjectKey,
    created_at: row.createdAt,
  };
}
