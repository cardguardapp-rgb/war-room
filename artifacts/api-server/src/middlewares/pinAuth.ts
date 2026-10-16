import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE_NAME = "jsa_session";

/** Sessions expire this long after login, checked server-side. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Allow a little clock skew for tokens issued "in the future". */
const CLOCK_SKEW_MS = 60 * 1000;

export const PIN_PATTERN = /^\d{6,8}$/;

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} environment variable is required but was not provided.`,
    );
  }
  return value;
}

/**
 * Problems with APP_PIN / SESSION_SECRET worth logging at startup. Empty when
 * both look right. Never includes the values themselves.
 */
export function authConfigProblems(): string[] {
  const problems: string[] = [];
  const pin = process.env["APP_PIN"];
  const secret = process.env["SESSION_SECRET"];
  if (!pin) problems.push("APP_PIN is not set");
  else if (!PIN_PATTERN.test(pin)) {
    problems.push("APP_PIN must be 6–8 digits; the login screen can't match it");
  }
  if (!secret) problems.push("SESSION_SECRET is not set");
  else if (secret.length < 32) {
    problems.push("SESSION_SECRET is shorter than 32 characters");
  }
  return problems;
}

// --- session tokens -------------------------------------------------------
//
// Token = "<issuedAtMs>.<hex HMAC>". The HMAC covers the issue time and the
// PIN, keyed by SESSION_SECRET, so rotating either the secret or the PIN
// invalidates every session on every device.

function sign(issuedAt: number): string {
  const secret = getRequiredEnv("SESSION_SECRET");
  const pin = getRequiredEnv("APP_PIN");
  return crypto
    .createHmac("sha256", secret)
    .update(`v1|${issuedAt}|${pin}`)
    .digest("hex");
}

export function createSessionToken(issuedAt: number = Date.now()): string {
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function verifySessionToken(
  token: string,
  now: number = Date.now(),
): boolean {
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (!Number.isSafeInteger(issuedAt)) return false;
  if (issuedAt > now + CLOCK_SKEW_MS) return false;
  if (now - issuedAt >= SESSION_TTL_MS) return false;
  const a = Buffer.from(match[2], "hex");
  const b = Buffer.from(sign(issuedAt), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyPin(candidatePin: string): boolean {
  const pin = getRequiredEnv("APP_PIN");
  // Compare fixed-length digests so the PIN's length isn't leaked by timing.
  const a = crypto.createHash("sha256").update(candidatePin).digest();
  const b = crypto.createHash("sha256").update(pin).digest();
  return crypto.timingSafeEqual(a, b);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function issueSessionCookie(res: Response): void {
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(), {
    ...cookieOptions(),
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
}

export function hasValidSession(req: Request): boolean {
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    return false;
  }
  return verifySessionToken(cookieValue);
}

export function requirePin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (hasValidSession(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}
