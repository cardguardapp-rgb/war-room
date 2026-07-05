import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const documentsTable = pgTable("documents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  contentJson: jsonb("content_json"),
  docxObjectKey: text("docx_object_key"),
  pdfObjectKey: text("pdf_object_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof documentsTable.$inferSelect;
