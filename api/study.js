import { createHash, timingSafeEqual } from "node:crypto";
import { requireApiAuth } from "./_lib/auth.js";
import { studyRequest } from "./_lib/studyStore.js";

export function parentAuthorized(code, hash = process.env.PARENT_APPROVAL_HASH) {
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || typeof code !== "string" || code.length > 128) return false;
  const digest = createHash("sha256").update(code).digest();
  return timingSafeEqual(digest, Buffer.from(hash, "hex"));
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!requireApiAuth(req, res)) return;
  if (!["GET", "POST"].includes(req.method)) { res.status(405).json({ error: "Method not allowed." }); return; }
  const body = req.method === "GET" ? { action: "read" } : req.body;
  if (!body || typeof body !== "object" || !["read", "start", "tick", "stop", "approve"].includes(body.action)) { res.status(400).json({ error: "Invalid study request." }); return; }
  if (body.action === "approve" && !parentAuthorized(body.code)) {
    res.status(403).json({ error: process.env.PARENT_APPROVAL_HASH ? "Parent code is incorrect." : "Parent approval has not been configured yet." }); return;
  }
  try {
    const { status = 200, ...result } = await studyRequest(body);
    res.status(status).json({ ...result, parentConfigured: Boolean(process.env.PARENT_APPROVAL_HASH) });
  } catch (error) {
    console.error("Study storage failed:", error.message);
    res.status(503).json({ error: "Study time could not be saved. The timer is paused; please reconnect and start again." });
  }
}
