import { Router, type IRouter, type Response } from "express";
import {
  PIN_PATTERN,
  clearSessionCookie,
  hasValidSession,
  issueSessionCookie,
  verifyPin,
} from "../middlewares/pinAuth";
import {
  EMPTY_STATE,
  loadLockout,
  lockRemainingMs,
  recordFailure,
  saveLockout,
} from "../lib/loginLockout";

const router: IRouter = Router();

function lockedResponse(res: Response, remainingMs: number): void {
  const seconds = Math.ceil(remainingMs / 1000);
  res.setHeader("Retry-After", String(seconds));
  res.status(429).json({
    error: "Too many incorrect PINs. Try again shortly.",
    retry_after_seconds: seconds,
  });
}

router.get("/auth/status", (req, res): void => {
  res.json({ authenticated: hasValidSession(req) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const pin = req.body?.pin;
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    res.status(400).json({ error: "Enter your 6–8 digit PIN" });
    return;
  }

  const state = await loadLockout();
  const now = Date.now();
  const remaining = lockRemainingMs(state, now);
  if (remaining > 0) {
    // While locked, nothing is checked — not even the right PIN.
    lockedResponse(res, remaining);
    return;
  }

  if (!verifyPin(pin)) {
    const next = recordFailure(state, now);
    await saveLockout(next);
    req.log.warn({ failures: next.failures }, "Incorrect PIN attempt");
    const nextRemaining = lockRemainingMs(next, now);
    if (nextRemaining > 0) {
      lockedResponse(res, nextRemaining);
      return;
    }
    res.status(401).json({ error: "Incorrect PIN" });
    return;
  }

  if (state.failures > 0 || state.lockedUntil > 0) {
    await saveLockout({ ...EMPTY_STATE });
  }
  issueSessionCookie(res);
  res.json({ authenticated: true });
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

export default router;
