import { db } from "@workspace/db";
import {
  profileTable,
  jobsTable,
  documentsTable,
  qaLogTable,
  discoverSettingsTable,
  discoverDismissedTable,
  type Profile,
  type Job,
  type Document,
  type QaLog,
  type DiscoverSettingsRow,
  type DiscoverDismissedRow,
} from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { logger } from "./logger";

export { db, eq, sql, and, desc };
export {
  profileTable,
  jobsTable,
  documentsTable,
  qaLogTable,
  discoverSettingsTable,
  discoverDismissedTable,
};
export type {
  Profile,
  Job,
  Document,
  QaLog,
  DiscoverSettingsRow,
  DiscoverDismissedRow,
};

/** Ensure the single profile row (id = 1) exists. */
export async function ensureProfileRow(): Promise<void> {
  await db
    .insert(profileTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: profileTable.id });
}

logger.info("PostgreSQL database ready");
