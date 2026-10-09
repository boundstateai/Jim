// Single-student login for Calculus Lab.
//
// The password is never stored: CALCULUS_PASSWORD_HASH holds a scrypt digest as
// "scrypt$<saltHex>$<hashHex>". A successful login returns an HMAC-signed,
// HttpOnly session cookie; nothing sensitive reaches browser JavaScript.
//
// This gates the API (progress, chats, voice, study, tutoring). The static
// bundle is served by Vercel and stays public, which is fine because it holds
// no secrets. This is a family-grade gate for one student's records, not a
// multi-user identity system.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "calculus_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_PASSWORD_LENGTH = 256;
const KEY_LENGTH = 32;

export function expectedUsername() {
  return `${process.env.CALCULUS_USERNAME || "student"}`.trim().toLowerCase();
}

// Signing key falls back to a digest of the password hash so that changing the
// password invalidates every outstanding session.
function signingKey() {
  const explicit = process.env.SESSION_SECRET || "";
  if (explicit) return Buffer.from(explicit, "utf8");
  const stored = process.env.CALCULUS_PASSWORD_HASH || "";
  return stored ? createHash("sha256").update(`calculus-session:${stored}`).digest() : null;
}

export function loginConfigured() {
  return Boolean(process.env.CALCULUS_PASSWORD_HASH) && Boolean(signingKey());
}

export function hashPassword(password, salt = randomBytes(16)) {
  const digest = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(username, password) {
  const stored = process.env.CALCULUS_PASSWORD_HASH || "";
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;
  if (username.trim().toLowerCase() !== expectedUsername()) return false;

  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  if (!/^[a-f0-9]+$/i.test(parts[1]) || !/^[a-f0-9]+$/i.test(parts[2])) return false;

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (!salt.length || !expected.length) return false;

  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

function sign(payload, key) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(username = expectedUsername(), now = Date.now()) {
  const key = signingKey();
  if (!key) return "";
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: now + MAX_AGE_SECONDS * 1000 }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function readSessionToken(token, now = Date.now()) {
  const key = signingKey();
  if (!key || typeof token !== "string" || token.length > 1024) return null;

  const cut = token.lastIndexOf(".");
  if (cut <= 0) return null;
  const payload = token.slice(0, cut);
  const provided = Buffer.from(token.slice(cut + 1), "base64url");
  const expected = Buffer.from(sign(payload, key), "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!claims || typeof claims.exp !== "number" || claims.exp <= now) return null;
    if (`${claims.u}`.toLowerCase() !== expectedUsername()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function parseCookies(header = "") {
  const jar = {};
  for (const part of `${header || ""}`.split(";")) {
    const cut = part.indexOf("=");
    if (cut < 1) continue;
    const name = part.slice(0, cut).trim();
    if (name) jar[name] = decodeURIComponent(part.slice(cut + 1).trim());
  }
  return jar;
}

export function sessionCookie(token, maxAge = MAX_AGE_SECONDS) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// An unconfigured deployment stays open rather than locking everyone out.
export function isLoggedIn(req) {
  if (!loginConfigured()) return true;
  const jar = parseCookies(req?.headers?.cookie);
  return Boolean(readSessionToken(jar[COOKIE_NAME]));
}
