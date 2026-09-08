import { timingSafeEqual } from "node:crypto";

const TOKEN_HEADER = "x-leo-api-token";

function getExpectedToken() {
  return process.env.LEO_API_TOKEN || process.env.API_TOKEN || "";
}

function getHeader(headers = {}, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return "";
}

function extractProvidedToken(headers = {}) {
  const direct = getHeader(headers, TOKEN_HEADER);
  if (direct) return `${direct}`.trim();

  const authorization = `${getHeader(headers, "authorization") || ""}`.trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function isApiAuthorized(headers = {}) {
  const expected = getExpectedToken();
  if (!expected) return true;

  const provided = extractProvidedToken(headers);
  if (!provided) return false;

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}


export function rejectUnauthorized(res) {
  res.status(401).json({ error: "Unauthorized." });
}

export function requireApiAuth(req, res) {
  if (isApiAuthorized(req.headers)) return true;
  rejectUnauthorized(res);
  return false;
}
