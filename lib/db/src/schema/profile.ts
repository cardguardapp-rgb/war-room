import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const profileTable = pgTable("profile", {
  id: integer("id").primaryKey(),
  resumeFilename: text("resume_filename"),
  resumeJson: jsonb("resume_json"),
  styleMapJson: jsonb("style_map_json"),
  extraAnswersJson: jsonb("extra_answers_json"),
  extraContext: text("extra_context"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profileTable.$inferSelect;
