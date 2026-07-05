import { integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";

export const discoverSettingsTable = pgTable("discover_settings", {
  id: integer("id").primaryKey(),
  settingsJson: jsonb("settings_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DiscoverSettingsRow = typeof discoverSettingsTable.$inferSelect;
