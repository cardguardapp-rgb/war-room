import { downloadObject, objectExists, uploadObject } from "./objectStore";
import { logger } from "./logger";

// Login lockout. There's one PIN and one user, so the counter is global rather
// than per IP (an attacker can change IP; they can't change the PIN they're
// guessing). After FREE_ATTEMPTS wrong PINs the login locks; each further wrong
// PIN doubles the wait, up to MAX_LOCK_MS. The right PIN resets it.
//
// The state lives in object storage so it survives restarts and is shared by
// every autoscale instance. If storage fails, an in-memory copy is used.

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 30 * 1000;
export const MAX_LOCK_MS = 60 * 60 * 1000;
/** Failures older than this are forgotten. */
export const FAILURE_MEMORY_MS = 24 * 60 * 60 * 1000;

const OBJECT_KEY = "auth/login-lockout.json";

export interface LockoutState {
  failures: number;
  lastFailureAt: number;
  lockedUntil: number;
}

export const EMPTY_STATE: LockoutState = {
  failures: 0,
  lastFailureAt: 0,
  lockedUntil: 0,
};

/** Milliseconds left on the lock, or 0 when a login may be tried. */
export function lockRemainingMs(state: LockoutState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

/** Wait imposed after the given total number of consecutive failures. */
export function lockDurationMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS;
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** Math.min(doublings, 20));
}

/** State after one more wrong PIN at `now`. */
export function recordFailure(state: LockoutState, now: number): LockoutState {
  const stale = now - state.lastFailureAt > FAILURE_MEMORY_MS;
  const failures = (stale ? 0 : state.failures) + 1;
  const wait = lockDurationMs(failures);
  return {
    failures,
    lastFailureAt: now,
    lockedUntil: wait > 0 ? now + wait : 0,
  };
}

let memoryState: LockoutState = { ...EMPTY_STATE };

function parseState(raw: unknown): LockoutState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  return {
    failures: Math.floor(num(r.failures)),
    lastFailureAt: num(r.lastFailureAt),
    lockedUntil: num(r.lockedUntil),
  };
}

export async function loadLockout(): Promise<LockoutState> {
  try {
    if (!(await objectExists(OBJECT_KEY))) {
      memoryState = { ...EMPTY_STATE };
      return memoryState;
    }
    memoryState = parseState(
      JSON.parse((await downloadObject(OBJECT_KEY)).toString("utf8")),
    );
  } catch (err) {
    logger.warn({ err }, "Couldn't read login lockout state; using memory");
  }
  return memoryState;
}

export async function saveLockout(state: LockoutState): Promise<void> {
  memoryState = state;
  try {
    await uploadObject(
      OBJECT_KEY,
      Buffer.from(JSON.stringify(state)),
      "application/json",
    );
  } catch (err) {
    logger.warn({ err }, "Couldn't save login lockout state; kept in memory");
  }
}
