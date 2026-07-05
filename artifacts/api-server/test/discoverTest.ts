// Non-AI smoke test for the Discover backend: exercises the DB tables and the
// pure query/normalise helpers. No ANTHROPIC/TAVILY keys required.
// Run: pnpm --filter @workspace/api-server exec tsx test/discoverTest.ts
import assert from "node:assert";
import { sql } from "drizzle-orm";
import { db, discoverSettingsTable, discoverDismissedTable } from "../src/lib/db";
import {
  DEFAULT_DISCOVER_SETTINGS,
  normaliseSettings,
  buildQueries,
} from "../src/lib/discover";

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT to_regclass(${"public." + name}) AS reg`,
  );
  const row = rows.rows[0] as { reg: string | null } | undefined;
  return !!row?.reg;
}

async function main() {
  // 1. Both tables exist (pushed via drizzle-kit).
  assert.ok(await tableExists("discover_settings"), "discover_settings table missing");
  assert.ok(await tableExists("discover_dismissed"), "discover_dismissed table missing");
  console.log("OK  tables present: discover_settings, discover_dismissed");

  // 2. Settings round-trip + dismissed insert (uses the real DB).
  await db
    .insert(discoverSettingsTable)
    .values({ id: 1, settingsJson: DEFAULT_DISCOVER_SETTINGS, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: discoverSettingsTable.id,
      set: { settingsJson: DEFAULT_DISCOVER_SETTINGS, updatedAt: new Date() },
    });
  await db
    .insert(discoverDismissedTable)
    .values({ url: "https://example.com/x" })
    .onConflictDoNothing();
  await db
    .insert(discoverDismissedTable)
    .values({ url: "https://example.com/x" })
    .onConflictDoNothing(); // idempotent
  const dismissedRows = await db.select().from(discoverDismissedTable);
  assert.ok(dismissedRows.length >= 1, "dismissed insert failed");
  console.log("OK  settings row + idempotent dismissed insert");

  // 3. normaliseSettings fills defaults and clamps junk.
  const n1 = normaliseSettings({});
  assert.deepStrictEqual(n1.roleTitles, DEFAULT_DISCOVER_SETTINGS.roleTitles);
  assert.strictEqual(n1.extraKeywords, "");
  const n2 = normaliseSettings({
    roleTitles: ["  Head of Product  ", "", 42],
    officeRegion: "  Brisbane  ",
    extraKeywords: "fintech",
  });
  assert.deepStrictEqual(n2.roleTitles, ["Head of Product"]);
  assert.strictEqual(n2.officeRegion, "Brisbane");
  assert.strictEqual(n2.extraKeywords, "fintech");
  console.log("OK  normaliseSettings: defaults + trim + junk-drop");

  // 4. buildQueries: capped, deduped, includes region + remote + careers sweeps.
  const q = buildQueries(normaliseSettings({ extraKeywords: "SaaS" }));
  assert.ok(q.length > 0 && q.length <= 10, `query count out of range: ${q.length}`);
  assert.strictEqual(new Set(q).size, q.length, "queries not deduped");
  assert.ok(q.some((s) => /Brisbane|Gold Coast/.test(s)), "no office-region query");
  assert.ok(q.some((s) => /remote Australia/i.test(s)), "no remote-Australia query");
  assert.ok(q.some((s) => /careers/i.test(s)), "no careers-page query");
  assert.ok(q.every((s) => s.includes("SaaS")), "extraKeywords not appended");
  console.log(`OK  buildQueries: ${q.length} queries, region+remote+careers+keywords`);

  console.log("\nALL DISCOVER NON-AI CHECKS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
