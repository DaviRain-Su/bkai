import { createHmac, timingSafeEqual, randomBytes } from "crypto";

const AUTH_SECRET = Bun.env.AUTH_SECRET ?? "dev-secret";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AuthTokenPayload {
  userId: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  exp: number;
}

export function createAuthToken(payload: Omit<AuthTokenPayload, "exp">): string {
  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const fullPayload: AuthTokenPayload = { ...payload, exp };
  const body = base64UrlEncode(fullPayload);
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;

  const expected = sign(`${headerB64}.${payloadB64}`);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as AuthTokenPayload;
    if (!payload || typeof payload !== "object") return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (error) {
    console.warn("Failed to parse auth token", error);
    return null;
  }
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  const cookies: Record<string, string> = {};
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    if (!part) continue;
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

export function buildSetCookie(name: string, value: string, options: CookieOptions = {}) {
  const segments = [`${name}=${value}`];
  segments.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly ?? true) segments.push("HttpOnly");
  if (options.sameSite ?? "Lax") segments.push(`SameSite=${options.sameSite ?? "Lax"}`);
  if (options.secure ?? isProduction()) segments.push("Secure");
  if (options.maxAge != null) segments.push(`Max-Age=${options.maxAge}`);
  if (options.domain) segments.push(`Domain=${options.domain}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  return segments.join("; ");
}

export interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  secure?: boolean;
  maxAge?: number;
  domain?: string;
  expires?: Date;
}

export function getTokenFromRequest(request: Request): AuthTokenPayload | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  return verifyAuthToken(token);
}

function base64UrlEncode(data: unknown) {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function sign(input: string) {
  return createHmac("sha256", AUTH_SECRET).update(input).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}
