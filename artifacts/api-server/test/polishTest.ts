// Non-AI smoke test for the polish phase: JSON parse-retry + export zip.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { parseJsonWithRetry, AiJsonError } from "../src/lib/anthropic";
import { db } from "../src/lib/db";
import { dataDir } from "../src/lib/paths";

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

  // 4. Export zip mechanism: sqlite backup + data.json + round-trip.
  const tmpDb = path.join(dataDir, `polishtest-${Date.now()}.db`);
  try {
    await db.backup(tmpDb);
    const zip = new JSZip();
    zip.file("app.db", fs.readFileSync(tmpDb));
    const dump: Record<string, unknown> = {};
    for (const t of ["profile", "jobs", "documents", "qa_log"]) {
      dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }
    zip.file("data.json", JSON.stringify(dump, null, 2));
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    assert.ok(buf.length > 0, "zip should have bytes");

    const reloaded = await JSZip.loadAsync(buf);
    assert.ok(reloaded.file("app.db"), "app.db missing from zip");
    const dataJson = await reloaded.file("data.json")!.async("string");
    JSON.parse(dataJson); // must be valid JSON
    assert.ok(reloaded.file("app.db")!, "app.db entry present");
    console.log(`OK  export zip builds + round-trips (${buf.length} bytes)`);
  } finally {
    try {
      fs.rmSync(tmpDb, { force: true });
    } catch {
      /* ignore */
    }
  }

  console.log("\nALL POLISH NON-AI CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
