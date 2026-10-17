// AssemblyAI streaming: mint a token the way the server does, open a session
// with it, stream 1s of silence and terminate. Needs ASSEMBLYAI_API_KEY and the
// network; no DB. Prints message types only, never the key or the token.
// Run: pnpm --filter @workspace/api-server exec tsx test/speechTest.ts
import "@workspace/db/env";
import { mintStreamingToken } from "../src/lib/speech";

if (!process.env["ASSEMBLYAI_API_KEY"]?.trim()) {
  console.log("SKIP  ASSEMBLYAI_API_KEY isn't set");
  process.exit(0);
}
const token = await mintStreamingToken();
console.log(`OK  token minted (redeem within ${token.expires_in_seconds}s, session cap ${token.max_session_seconds}s)`);

const seen: string[] = [];
const ws = new WebSocket(`${token.ws_url}&sample_rate=16000`);
ws.binaryType = "arraybuffer";
ws.onopen = () => {
  let n = 0;
  const iv = setInterval(() => {
    ws.send(new Int16Array(1600).buffer); // 100ms of silence
    if (++n === 10) {
      clearInterval(iv);
      ws.send(JSON.stringify({ type: "Terminate" }));
    }
  }, 100);
};
ws.onmessage = (e) => {
  const msg = JSON.parse(String(e.data)) as { type: string; configuration?: { model?: string } };
  seen.push(msg.type);
  if (msg.type === "Begin") console.log(`OK  session began (model ${msg.configuration?.model ?? "?"})`);
};
ws.onclose = (e) => {
  if (!seen.includes("Begin") || !seen.includes("Termination")) {
    console.error(`FAIL  closed ${e.code} ${e.reason}; saw ${seen.join(", ") || "nothing"}`);
    process.exit(1);
  }
  console.log("OK  session terminated cleanly");
  process.exit(0);
};
setTimeout(() => {
  console.error("FAIL  timed out");
  process.exit(1);
}, 20_000);
