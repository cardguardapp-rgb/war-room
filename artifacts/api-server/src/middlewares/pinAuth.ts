import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_COOKIE_NAME = "jsa_session";

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} environment variable is required but was not provided.`,
    );
  }
  return value;
}

function getExpectedSessionToken(): string {
  const secret = getRequiredEnv("SESSION_SECRET");
  const pin = getRequiredEnv("APP_PIN");
  return crypto.createHmac("sha256", secret).update(pin).digest("hex");
}

export function verifyPin(candidatePin: string): boolean {
  const pin = getRequiredEnv("APP_PIN");
  const a = Buffer.from(candidatePin);
  const b = Buffer.from(pin);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function issueSessionCookie(res: Response): void {
  const token = getExpectedSessionToken();
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME);
}

export function hasValidSession(req: Request): boolean {
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieValue !== "string" || cookieValue.length === 0) {
    return false;
  }
  const expected = getExpectedSessionToken();
  const a = Buffer.from(cookieValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
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
