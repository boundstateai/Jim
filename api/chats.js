// Vercel Function: saved chat transcripts.
// Route: /api/chats
//
//   GET  ?course=physics&session=<id>&limit=60   -> { messages } — restore a tab's conversation
//   GET  ?course=physics&days=30&limit=500       -> { messages } — recent history for review
//   GET  ?course=physics&issues=1&days=90        -> { issues } — tracked trouble spots, ranked
//   POST { course, sessionId, messages:[{role, content, hasPhoto, ts}], formulas, tutor }
//        -> { ok, saved, issues } — saves the turn, then tags trouble spots against the formula index

import { appendChat, listChat } from "./_lib/chatLog.js";
import { tagIssues, recordIssues, issueSummary } from "./_lib/issues.js";
import { requireApiAuth } from "./_lib/auth.js";

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

// The most recent user message and the assistant reply that followed it.
export function lastTurn(messages) {
  if (!Array.isArray(messages)) return null;
  const users = messages.filter(m => m?.role === "user");
  const user = users.at(-1);
  if (!user) return null;
  const after = messages.slice(messages.lastIndexOf(user) + 1).find(m => m?.role === "assistant");
  return { user: `${user.content || ""}`, assistant: `${after?.content || ""}` };
}

export default async function handler(req, res) {
  if (!requireApiAuth(req, res)) return;
  const body = readBody(req);
  const course = `${req.query?.course || body.course || "uah-ma171"}`.slice(0, 40);
  if (course !== "uah-ma171") {res.status(400).json({error:"Unsupported course."});return;}

  try {
    if (req.method === "GET") {
      if (req.query?.issues) {
        res.status(200).json({ issues: await issueSummary(course, { days: req.query?.days ? Number(req.query.days) : undefined }) });
        return;
      }
      const messages = await listChat(course, {
        sessionId: req.query?.session ? `${req.query.session}` : undefined,
        days: req.query?.days ? Number(req.query.days) : undefined,
        limit: req.query?.limit,
      });
      res.status(200).json({ messages });
      return;
    }
    if (req.method === "POST") {
      let result;
      try {
        result = await appendChat(course, body.sessionId, body.messages);
      } catch (error) {
        if (/required|per save|role must|empty message/.test(error.message)) {
          res.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }
      // Tag after the save, never instead of it: a tagger hiccup must not lose a turn.
      let issues = 0;
      try {
        const turn = lastTurn(body.messages);
        if (turn) {
          const tagged = await tagIssues({
            persona: body.tutor?.persona, subject: body.tutor?.subject, formulas: body.formulas, ...turn,
          });
          issues = (await recordIssues(course, body.sessionId, tagged)).saved;
          if (issues) console.log(`chat issues: tagged ${issues} on ${course}: ${tagged.map(i => `${i.formulaId || "-"}/${i.kind}`).join(", ")}`);
        }
      } catch (error) {
        console.error("chat issue tagging failed:", error);
      }
      res.status(200).json({ ...result, issues });
      return;
    }
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("chats error:", error);
    res.status(500).json({ error: error.message || "Chat log failed." });
  }
}
