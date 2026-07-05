import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const discoverDismissedTable = pgTable("discover_dismissed", {
  url: text("url").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DiscoverDismissedRow = typeof discoverDismissedTable.$inferSelect;
