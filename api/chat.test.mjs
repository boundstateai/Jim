import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toAnthropicMessages,
  ChatRequestError,
  PHOTO_ONLY_TEXT,
  PHOTO_PLACEHOLDER,
  RECENT_IMAGE_TURNS,
  MAX_IMAGE_BYTES,
} from "./_lib/chatMessages.js";

const png = (fill = "a", n = 40) => ({ media_type: "image/png", data: Buffer.from(fill.repeat(n)).toString("base64") });

test("plain text history passes through as strings", () => {
  const out = toAnthropicMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "hey" }]);
  assert.deepEqual(out, [{ role: "user", content: "hi" }, { role: "assistant", content: "hey" }]);
});

test("a photo becomes an image block before the text; photo-only gets a default line", () => {
  const out = toAnthropicMessages([{ role: "user", content: "", images: [png()] }]);
  assert.equal(out[0].content.length, 2);
  assert.equal(out[0].content[0].type, "image");
  assert.equal(out[0].content[0].source.media_type, "image/png");
  assert.equal(out[0].content[0].source.type, "base64");
  assert.deepEqual(out[0].content[1], { type: "text", text: PHOTO_ONLY_TEXT });
});

test("a data: URL prefix is tolerated", () => {
  const out = toAnthropicMessages([{ role: "user", content: "x", images: [{ media_type: "image/jpeg", data: `data:image/jpeg;base64,${png().data}` }] }]);
  assert.equal(out[0].content[0].source.data, png().data);
});

test("only the most recent photo turns keep their images; older ones become a placeholder", () => {
  const turns = [];
  for (let i = 0; i < RECENT_IMAGE_TURNS + 2; i += 1) {
    turns.push({ role: "user", content: `q${i}`, images: [png()] }, { role: "assistant", content: `a${i}` });
  }
  const out = toAnthropicMessages(turns);
  const users = out.filter(m => m.role === "user");
  assert.equal(typeof users[0].content, "string");
  assert.match(users[0].content, new RegExp(PHOTO_PLACEHOLDER.replace(/[[\]]/g, "\\$&")));
  assert.equal(typeof users[1].content, "string");
  for (const m of users.slice(2)) assert.equal(m.content[0].type, "image");
});

test("images on assistant turns are ignored, never sent", () => {
  const out = toAnthropicMessages([{ role: "user", content: "q" }, { role: "assistant", content: "a", images: [png()] }]);
  assert.equal(out[1].content, "a");
});

test("rejects unsupported types, empties, too many, and oversized photos with client statuses", () => {
  assert.throws(() => toAnthropicMessages([{ role: "user", content: "", images: [{ media_type: "image/heic", data: "AAAA" }] }]),
    e => e instanceof ChatRequestError && e.status === 400 && /heic/.test(e.message));
  assert.throws(() => toAnthropicMessages([{ role: "user", content: "", images: [{ media_type: "image/png", data: "" }] }]),
    e => e.status === 400);
  assert.throws(() => toAnthropicMessages([{ role: "user", content: "", images: [png(), png(), png(), png(), png()] }]),
    e => e.status === 400 && /Up to 4/.test(e.message));
  const huge = { media_type: "image/jpeg", data: Buffer.alloc(MAX_IMAGE_BYTES + 1024).toString("base64") };
  assert.throws(() => toAnthropicMessages([{ role: "user", content: "", images: [huge] }]), e => e.status === 413);
});

test("empty transcript is a 400", () => {
  assert.throws(() => toAnthropicMessages([]), e => e.status === 400);
});

import { struggleAddendum } from "./_lib/chatMessages.js";

test("struggle addendum carries the digest and the report shape; degrades honestly", () => {
  const withChats = struggleAddendum({ count: 12, text: "Leo: help\nDr. Newton: sure", days: 30, persona: "Dr. Newton" });
  assert.match(withChats, /STRUGGLE REPORT/);
  assert.match(withChats, /12 messages/);
  assert.match(withChats, /=== SAVED CHATS ===\nLeo: help/);
  assert.match(withChats, /3-item focus plan/);
  const empty = struggleAddendum({ count: 0, text: "", days: 30 });
  assert.match(empty, /no saved chat history yet/);
  assert.doesNotMatch(empty, /SAVED CHATS ===/);
  const down = struggleAddendum({ unavailable: true });
  assert.match(down, /could not be loaded/);
});
