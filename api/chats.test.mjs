import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatMessages, formatChatDigest, MAX_CONTENT_CHARS, MAX_BATCH } from "./_lib/chatLog.js";

test("sanitize: keeps user/assistant text, caps length, fills timestamps, flags photos", () => {
  const out = sanitizeChatMessages([
    { role: "user", content: "x".repeat(MAX_CONTENT_CHARS + 5), ts: 123 },
    { role: "assistant", content: "ok" },
    { role: "user", content: "", hasPhoto: true },
  ], 999);
  assert.equal(out[0].content.length, MAX_CONTENT_CHARS);
  assert.equal(out[0].ts, 123);
  assert.equal(out[1].ts, 999);
  assert.equal(out[2].hasPhoto, true);
});

test("sanitize: rejects empties, bad roles, oversized batches", () => {
  assert.throws(() => sanitizeChatMessages([]), /required/);
  assert.throws(() => sanitizeChatMessages([{ role: "system", content: "x" }]), /role/);
  assert.throws(() => sanitizeChatMessages([{ role: "user", content: "   " }]), /empty/);
  assert.throws(() => sanitizeChatMessages(Array.from({ length: MAX_BATCH + 1 }, () => ({ role: "user", content: "x" }))), /per save/);
});

test("digest: dated session headers, speaker labels, photo marker, whitespace folded", () => {
  const text = formatChatDigest([
    { sessionId: "a", role: "user", content: "what is\n normal force", hasPhoto: true, ts: Date.UTC(2026, 8, 1, 14, 5) },
    { sessionId: "a", role: "assistant", content: "It's the push from the surface.", hasPhoto: false, ts: Date.UTC(2026, 8, 1, 14, 6) },
    { sessionId: "b", role: "user", content: "quiz me", hasPhoto: false, ts: Date.UTC(2026, 8, 3, 9, 0) },
  ], { persona: "Dr. Newton" });
  assert.match(text, /--- session 2026-09-01 14:05 UTC ---/);
  assert.match(text, /Leo: \[photo attached\] what is normal force/);
  assert.match(text, /Dr\. Newton: It's the push/);
  assert.match(text, /--- session 2026-09-03 09:00 UTC ---\nLeo: quiz me/);
});

test("digest: trims from the front so the newest chats survive", () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({ sessionId: "s", role: "user", content: `message number ${i} ${"pad ".repeat(20)}`, ts: i }));
  const text = formatChatDigest(messages, { maxChars: 2000 });
  assert.ok(text.length <= 2000 + 40);
  assert.match(text, /^\[…earlier chats trimmed…\]/);
  assert.match(text, /message number 199/);
  assert.doesNotMatch(text, /message number 0 /);
});

const url = process.env.DATABASE_URL;
test("chat log store: append, restore by session, list by days", { skip: !url && "DATABASE_URL not set" }, async () => {
  const { appendChat, listChat } = await import("./_lib/chatLog.js");
  const { pool } = await import("./_lib/db.js");
  const course = `test-${Date.now()}`;
  try {
    await appendChat(course, "s1", [{ role: "user", content: "hi", ts: 1 }, { role: "assistant", content: "hey", ts: 2 }]);
    await appendChat(course, "s2", [{ role: "user", content: "later", hasPhoto: true }]);
    const s1 = await listChat(course, { sessionId: "s1" });
    assert.deepEqual(s1.map(m => m.content), ["hi", "hey"]);
    const recent = await listChat(course, { days: 1 });
    assert.deepEqual(recent.map(m => m.content), ["later"]);
    assert.equal(recent[0].hasPhoto, true);
  } finally {
    await pool.query("DELETE FROM chat_log WHERE course = $1", [course]);
    await pool.end();
  }
});
