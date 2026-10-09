import { courseUserId, courseStudentName } from "./course.js";
// Saved chat transcripts in Railway Postgres, one row per message, so a
// reload doesn't lose the conversation and the tutor can look back over
// weeks of chats to say where Leo is actually struggling. Photos are not
// stored — only that a message carried one.

import { pool } from "./db.js";

export const MAX_CONTENT_CHARS = 20_000;
export const MAX_BATCH = 50;
export const DIGEST_DAYS = 30;
export const DIGEST_MAX_CHARS = 60_000;

let chatSchemaReady = null;
export function ensureChatSchema() {
  if (!chatSchemaReady) {
    chatSchemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_log (
          id         bigserial PRIMARY KEY,
          user_id    text    NOT NULL,
          course     text    NOT NULL,
          session_id text    NOT NULL,
          role       text    NOT NULL,
          content    text    NOT NULL,
          has_photo  boolean NOT NULL DEFAULT false,
          created_at bigint  NOT NULL
        );
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_log_course_time_idx
          ON chat_log (user_id, course, created_at DESC);
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_log_session_idx
          ON chat_log (user_id, course, session_id, created_at);
      `);
    })().catch(error => {
      chatSchemaReady = null;
      throw error;
    });
  }
  return chatSchemaReady;
}

/** Shape-check a client batch. Pure; throws on garbage so nothing odd lands in the log. */
export function sanitizeChatMessages(messages, now = Date.now()) {
  if (!Array.isArray(messages) || !messages.length) throw new Error("messages required");
  if (messages.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} messages per save.`);
  return messages.map(message => {
    const role = message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : null;
    if (!role) throw new Error("role must be user or assistant");
    const content = `${message?.content ?? ""}`.slice(0, MAX_CONTENT_CHARS);
    const hasPhoto = Boolean(message?.hasPhoto);
    if (!content.trim() && !hasPhoto) throw new Error("empty message");
    const ts = Number(message?.ts);
    return { role, content, hasPhoto, ts: Number.isFinite(ts) && ts > 0 ? ts : now };
  });
}

export async function appendChat(course, sessionId, messages) {
  await ensureChatSchema();
  const rows = sanitizeChatMessages(messages);
  const session = `${sessionId || ""}`.slice(0, 80) || "unknown";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO chat_log (user_id, course, session_id, role, content, has_photo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [courseUserId(course), course, session, row.role, row.content, row.hasPhoto, row.ts],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, saved: rows.length };
}

function rowToMessage(row) {
  return {
    id: Number(row.id),
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    hasPhoto: Boolean(row.has_photo),
    ts: Number(row.created_at),
  };
}

/** Messages oldest-first. Filter by session (restore a tab) or by recent days (review). */
export async function listChat(course, { sessionId, days, limit = 200 } = {}) {
  await ensureChatSchema();
  const cap = Math.max(1, Math.min(Number(limit) || 200, 2000));
  const params = [courseUserId(course), course];
  const where = ["user_id = $1", "course = $2"];
  if (sessionId) { params.push(`${sessionId}`); where.push(`session_id = $${params.length}`); }
  if (days) { params.push(Date.now() - Number(days) * 86_400_000); where.push(`created_at >= $${params.length}`); }
  params.push(cap);
  // newest N, then flipped, so a long history returns its tail rather than its head
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT id, session_id, role, content, has_photo, created_at
         FROM chat_log WHERE ${where.join(" AND ")}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}
     ) recent ORDER BY created_at ASC, id ASC`,
    params,
  );
  return rows.map(rowToMessage);
}

/**
 * Plain-text transcript for the model: one line per message, dated, split by
 * session, trimmed from the front so the most recent chats always survive.
 */
export function formatChatDigest(messages, { maxChars = DIGEST_MAX_CHARS, persona = "Tutor", studentName = "Leo" } = {}) {
  const lines = [];
  let lastSession = null;
  for (const message of messages) {
    if (message.sessionId !== lastSession) {
      lastSession = message.sessionId;
      lines.push(`\n--- session ${new Date(message.ts).toISOString().slice(0, 16).replace("T", " ")} UTC ---`);
    }
    const who = message.role === "user" ? studentName : persona;
    const photo = message.hasPhoto ? " [photo attached]" : "";
    lines.push(`${who}:${photo} ${message.content.replace(/\s+/g, " ").trim()}`);
  }
  let text = lines.join("\n").trim();
  if (text.length > maxChars) {
    const cut = text.length - maxChars;
    const rest = text.slice(cut);
    const nl = rest.indexOf("\n");
    text = `[…earlier chats trimmed…]\n${nl === -1 ? rest : rest.slice(nl + 1)}`;
  }
  return text;
}

export async function chatDigest(course, { days = DIGEST_DAYS, persona } = {}) {
  const messages = await listChat(course, { days, limit: 2000 });
  return { count: messages.length, text: formatChatDigest(messages, { persona, studentName: courseStudentName(course) }) };
}
