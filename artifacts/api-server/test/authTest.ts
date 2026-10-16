/**
 * Smoke test for M1 security: session tokens (expiry, tampering, secret and PIN
 * rotation), the login lockout schedule, and the CORS origin rules. Pure
 * functions only — no DB, no network, no keys. Sets its own throwaway
 * APP_PIN / SESSION_SECRET.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx test/authTest.ts
 */
process.env["APP_PIN"] = "123456";
process.env["SESSION_SECRET"] = "test-secret-".padEnd(48, "x");
delete process.env["REPLIT_DOMAINS"];
delete process.env["REPLIT_DEV_DOMAIN"];

const {
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
  verifyPin,
  authConfigProblems,
} = await import("../src/middlewares/pinAuth");
const { EMPTY_STATE, lockDurationMs, lockRemainingMs, recordFailure, FAILURE_MEMORY_MS } =
  await import("../src/lib/loginLockout");
const { isAllowedOrigin } = await import("../src/lib/httpSecurity");

let failed = 0;
function check(name: string, ok: boolean): void {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}\n`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// --- sessions ---
const fresh = createSessionToken(now);
check("fresh token is accepted", verifySessionToken(fresh, now));
check("29-day-old token is accepted", verifySessionToken(createSessionToken(now - 29 * DAY), now));
check("31-day-old token is rejected", !verifySessionToken(createSessionToken(now - 31 * DAY), now));
check("token exactly 30 days old is rejected", !verifySessionToken(createSessionToken(now - SESSION_TTL_MS), now));
check("token from the future is rejected", !verifySessionToken(createSessionToken(now + 10 * 60 * 1000), now));
const [issued, sig] = fresh.split(".");
check("changed issue time is rejected", !verifySessionToken(`${Number(issued) + 1000}.${sig}`, now));
check("changed signature is rejected", !verifySessionToken(`${issued}.${sig!.replace(/^./, sig![0] === "a" ? "b" : "a")}`, now));
check("old static-cookie format is rejected", !verifySessionToken(sig!, now));
check("garbage is rejected", !verifySessionToken("not-a-token", now));

process.env["SESSION_SECRET"] = "rotated-secret-".padEnd(48, "y");
check("rotating SESSION_SECRET invalidates the session", !verifySessionToken(fresh, now));
process.env["SESSION_SECRET"] = "test-secret-".padEnd(48, "x");
check("restoring the secret restores it (sanity)", verifySessionToken(fresh, now));
process.env["APP_PIN"] = "654321";
check("changing APP_PIN invalidates the session", !verifySessionToken(fresh, now));
process.env["APP_PIN"] = "123456";

check("right PIN verifies", verifyPin("123456"));
check("wrong PIN fails", !verifyPin("123457"));
check("prefix of the PIN fails", !verifyPin("12345"));
check("config with 6-digit PIN + long secret is clean", authConfigProblems().length === 0);
process.env["APP_PIN"] = "1234";
check("4-digit APP_PIN is flagged", authConfigProblems().length === 1);
process.env["APP_PIN"] = "123456";

// --- lockout ---
let s = { ...EMPTY_STATE };
for (let i = 1; i <= 4; i++) {
  s = recordFailure(s, now);
  check(`failure ${i}: not locked`, lockRemainingMs(s, now) === 0);
}
s = recordFailure(s, now);
check("failure 5: locked for 30s", lockRemainingMs(s, now) === 30_000);
let t = now + 30_000;
check("lock lifts after 30s", lockRemainingMs(s, t) === 0);
s = recordFailure(s, t);
check("failure 6: locked for 60s", lockRemainingMs(s, t) === 60_000);
t += 60_000;
s = recordFailure(s, t);
check("failure 7: locked for 2 min", lockRemainingMs(s, t) === 120_000);
check("wait is capped at 1 hour", lockDurationMs(50) === 60 * 60 * 1000);
const later = recordFailure(s, t + FAILURE_MEMORY_MS + 1);
check("failures older than a day are forgotten", later.failures === 1 && lockRemainingMs(later, t + FAILURE_MEMORY_MS + 1) === 0);

// --- origins ---
const devHosts = ["localhost:8090"];
check("dev: https://localhost:5175 allowed", isAllowedOrigin("https://localhost:5175", devHosts, false));
check("dev: LAN https://192.168.1.20:5175 allowed", isAllowedOrigin("https://192.168.1.20:5175", devHosts, false));
check("dev: other port refused", !isAllowedOrigin("https://localhost:5173", devHosts, false));
check("dev: public host on 5175 refused", !isAllowedOrigin("https://evil.example:5175", devHosts, false));
check("prod: localhost:5175 refused", !isAllowedOrigin("https://localhost:5175", ["warroom.example.app"], true));
check("prod: same origin allowed", isAllowedOrigin("https://warroom.example.app", ["warroom.example.app"], true));
check("prod: foreign origin refused", !isAllowedOrigin("https://evil.example", ["warroom.example.app"], true));
check("'null' origin refused", !isAllowedOrigin("null", devHosts, false));
process.env["REPLIT_DOMAINS"] = "war-room.replit.app";
check("prod: REPLIT_DOMAINS origin allowed", isAllowedOrigin("https://war-room.replit.app", ["internal:8080"], true));

process.stdout.write(failed === 0 ? "\nAll auth checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
