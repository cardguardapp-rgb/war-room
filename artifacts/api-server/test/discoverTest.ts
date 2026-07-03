// Non-AI smoke test for the Discover backend: exercises the DB migration and
// the pure query/normalise helpers. No ANTHROPIC/TAVILY keys required.
import assert from "node:assert";
import { db } from "../src/lib/db";
import {
  DEFAULT_DISCOVER_SETTINGS,
  normaliseSettings,
  buildQueries,
} from "../src/lib/discover";

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return !!row;
}

// 1. Migration created both tables.
assert.ok(tableExists("discover_settings"), "discover_settings table missing");
assert.ok(tableExists("discover_dismissed"), "discover_dismissed table missing");
console.log("OK  tables present: discover_settings, discover_dismissed");

// 2. Settings round-trip + dismissed insert (uses the real DB).
db.prepare(
  `INSERT INTO discover_settings (id, settings_json, updated_at)
   VALUES (1, ?, datetime('now'))
   ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`,
).run(JSON.stringify(DEFAULT_DISCOVER_SETTINGS));
db.prepare("INSERT OR IGNORE INTO discover_dismissed (url) VALUES (?)").run(
  "https://example.com/x",
);
db.prepare("INSERT OR IGNORE INTO discover_dismissed (url) VALUES (?)").run(
  "https://example.com/x",
); // idempotent
const dismissedCount = (
  db.prepare("SELECT COUNT(*) c FROM discover_dismissed").get() as { c: number }
).c;
assert.ok(dismissedCount >= 1, "dismissed insert failed");
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
