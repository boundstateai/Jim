// Vercel Function: GET/PUT Leo's progress in Railway Postgres.
// Route: /api/progress  (optional ?course=chem|physics, defaults to chem)
//
//   GET  ?course=physics                 -> { progress }
//   GET  ?course=physics&history=list    -> { history: [summaries, newest first] }
//   GET  ?course=physics&history=<id>    -> { entry: { id, updatedAt, replacedAt, reason, progress } }
//   PUT  { ...snapshot, course }         -> { ok, updatedAt }
//                                           409 { error, progress } if the snapshot is blank
//                                           but the stored one has work (send reset:true to force)
//   PUT  { course, restore: <id> }       -> { ok, updatedAt, progress } — history entry made current

import {
  getProgress,
  getProgressHistoryEntry,
  listProgressHistory,
  putProgress,
  restoreProgress,
} from "./_lib/db.js";
import { requireApiAuth } from "./_lib/auth.js";

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

export default async function handler(req, res) {
  if (!requireApiAuth(req, res)) return;

  const body = readBody(req);
  const course = (req.query?.course || body.course || "jim-math").toString();
  if (course !== "jim-math") {res.status(400).json({error:"Unsupported course."});return;}

  try {
    if (req.method === "GET") {
      const history = req.query?.history;
      if (history === "list") {
        res.status(200).json({ history: await listProgressHistory(course, req.query?.limit) });
        return;
      }
      if (history) {
        const entry = await getProgressHistoryEntry(course, history);
        if (!entry) {
          res.status(404).json({ error: "No such history entry." });
          return;
        }
        res.status(200).json({ entry });
        return;
      }
      const progress = await getProgress(course);
      res.status(200).json({ progress });
      return;
    }

    if (req.method === "PUT") {
      if (body.restore !== undefined) {
        const result = await restoreProgress(course, body.restore);
        if (!result.ok) {
          res.status(404).json({ error: "No such history entry." });
          return;
        }
        res.status(200).json(result);
        return;
      }

      const { progress: nested, reset, ...rest } = body;
      const progress = nested || rest;
      const result = await putProgress(course, progress, { reset: reset === true });
      if (!result.ok) {
        console.warn(`progress: refused blank overwrite of ${course} (stored copy has work)`);
        res.status(409).json({
          error: "Refused: snapshot has no earned work but the saved copy does. Send reset:true to wipe on purpose.",
          rejected: result.rejected,
          progress: result.progress,
        });
        return;
      }
      res.status(200).json(result);
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("progress error:", error);
    res.status(500).json({ error: error.message || "Progress storage failed." });
  }
}
