// Non-AI smoke test for the fetch + Readability pipeline (no ANTHROPIC_API_KEY
// needed). Proves jsdom + @mozilla/readability resolve and extract at runtime.
// Run: pnpm --filter @workspace/api-server exec tsx test/fetchTest.ts
import { fetchAndClean } from "../src/lib/jobExtract";

async function run(url: string) {
  const r = await fetchAndClean(url);
  if (r.ok) {
    console.log(`OK   ${url}\n     ${r.text.length} chars — "${r.text.slice(0, 140).replace(/\n/g, " ")}…"`);
  } else {
    console.log(`FAIL ${url}\n     reason: ${r.reason}`);
  }
}

async function main() {
  // A stable content page — exercises jsdom + Readability end to end.
  await run("https://en.wikipedia.org/wiki/Recruitment");
  // A page too short to be a posting — should be reported as failed, not crash.
  await run("https://example.com");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
