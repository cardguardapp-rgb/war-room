import type { NextFunction, Request, Response } from "express";

// CORS: the app's own origin, the Replit domains, and (outside production) the
// local dev server on port 5175 by localhost or a LAN address. Any other
// browser origin is refused with a 403 before the request reaches a route —
// not merely left without CORS headers — so a foreign page can't trigger a
// state-changing request either.

const DEV_WEB_PORT = "5175";

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim().toLowerCase() || undefined;
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function replitOrigins(): string[] {
  const domains = [
    ...(process.env["REPLIT_DOMAINS"] ?? "").split(","),
    process.env["REPLIT_DEV_DOMAIN"] ?? "",
  ];
  return domains
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .map((d) => `https://${d}`);
}

export function isAllowedOrigin(
  origin: string,
  requestHosts: Array<string | undefined>,
  production: boolean = process.env.NODE_ENV === "production",
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.host.toLowerCase();

  // Same origin as the request (Replit's router keeps the public host).
  if (requestHosts.some((h) => h === host)) return true;
  if (replitOrigins().includes(url.origin.toLowerCase())) return true;
  if (!production && url.port === DEV_WEB_PORT && isPrivateHost(url.hostname)) {
    return true;
  }
  return false;
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin) {
    next(); // not a cross-origin browser request
    return;
  }
  const hosts = [
    firstHeader(req.headers["x-forwarded-host"]),
    firstHeader(req.headers.host),
  ];
  if (isAllowedOrigin(origin, hosts)) {
    next();
    return;
  }
  req.log.warn({ origin }, "Refused request from a foreign origin");
  res.status(403).json({ error: "Origin not allowed" });
}

// Security headers for every API response. The website preview is HTML shown
// in an <iframe> on the app's own page, so framing is allowed from the same
// origin only, and it gets a CSP that permits its inline styles.

const API_CSP = "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; " +
  "font-src data: https:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  );
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  // Private data: never cached, so Back after logout can't show it again.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    req.path === "/api/website/preview" ? PREVIEW_CSP : API_CSP,
  );
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}
