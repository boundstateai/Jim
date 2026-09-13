// Route: /api/login
//   GET                       -> { authenticated, username, configured }
//   POST { username, password } -> sets the session cookie
//   POST { action: "logout" }   -> clears it
import {
  clearedCookie,
  createSessionToken,
  expectedUsername,
  isLoggedIn,
  loginConfigured,
  sessionCookie,
  verifyPassword,
} from "./_lib/session.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    res.status(200).json({
      authenticated: isLoggedIn(req),
      username: expectedUsername(),
      configured: loginConfigured(),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};

  if (body.action === "logout") {
    res.setHeader("Set-Cookie", clearedCookie());
    res.status(200).json({ ok: true, authenticated: false });
    return;
  }

  if (!loginConfigured()) {
    res.status(503).json({ error: "Login has not been configured yet." });
    return;
  }

  if (!verifyPassword(`${body.username ?? ""}`, `${body.password ?? ""}`)) {
    // One message for both cases so it cannot be used to probe the username.
    res.status(401).json({ error: "That username and password do not match." });
    return;
  }

  const token = createSessionToken();
  if (!token) {
    res.status(503).json({ error: "Login has not been configured yet." });
    return;
  }

  res.setHeader("Set-Cookie", sessionCookie(token));
  res.status(200).json({ ok: true, authenticated: true, username: expectedUsername() });
}
