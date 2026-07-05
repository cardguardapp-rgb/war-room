import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";

export const qaLogTable = pgTable("qa_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  jobId: integer("job_id")
    .notNull()
    .references(() => jobsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QaLog = typeof qaLogTable.$inferSelect;
