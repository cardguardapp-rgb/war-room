// Non-AI smoke test for the polish phase: JSON parse-retry + export zip.
// Run: pnpm --filter @workspace/api-server exec tsx test/polishTest.ts
import assert from "node:assert";
import JSZip from "jszip";
import { parseJsonWithRetry, AiJsonError } from "../src/lib/anthropic";
import { db, profileTable, jobsTable, documentsTable, qaLogTable } from "../src/lib/db";

async function main() {
  // 1. Retries once on malformed JSON, then succeeds.
  let calls = 0;
  const recovered = await parseJsonWithRetry<{ ok: boolean }>(async (attempt) => {
    calls++;
    return attempt === 0 ? "not json {" : '{"ok": true}';
  });
  assert.deepStrictEqual(recovered, { ok: true });
  assert.strictEqual(calls, 2, "should have retried exactly once");
  console.log("OK  parseJsonWithRetry recovers after one bad response");

  // 2. Succeeds first time — no retry.
  calls = 0;
  await parseJsonWithRetry(async () => {
    calls++;
    return '{"a":1}';
  });
  assert.strictEqual(calls, 1, "should not retry on valid JSON");
  console.log("OK  parseJsonWithRetry does not retry when the first response is valid");

  // 3. Always malformed → throws AiJsonError after 2 attempts.
  calls = 0;
  await assert.rejects(
    () =>
      parseJsonWithRetry(async () => {
        calls++;
        return "still not json";
      }),
    (err: unknown) => err instanceof AiJsonError,
  );
  assert.strictEqual(calls, 2, "should try exactly twice before giving up");
  console.log("OK  parseJsonWithRetry throws AiJsonError after two failures");

  // 4. Export zip mechanism: table dump (Postgres via Drizzle) + data.json round-trip.
  const [profile, jobs, documents, qaLog] = await Promise.all([
    db.select().from(profileTable),
    db.select().from(jobsTable),
    db.select().from(documentsTable),
    db.select().from(qaLogTable),
  ]);
  const zip = new JSZip();
  const dump = { profile, jobs, documents, qa_log: qaLog };
  zip.file("data.json", JSON.stringify(dump, null, 2));
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  assert.ok(buf.length > 0, "zip should have bytes");

  const reloaded = await JSZip.loadAsync(buf);
  const dataJson = await reloaded.file("data.json")!.async("string");
  JSON.parse(dataJson); // must be valid JSON
  console.log(`OK  export zip builds + round-trips (${buf.length} bytes)`);

  console.log("\nALL POLISH NON-AI CHECKS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
