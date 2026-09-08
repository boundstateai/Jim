import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { emptyRewards, transition, summary, earnedCents, addTime, dayKey, weekKey, WEEK_CAP_MS } from "./_lib/studyRewards.js";
import handler, { parentAuthorized } from "./study.js";
import { pauseReason, IDLE_MS, duration } from "../src/studyActivity.js";

const monday = Date.parse("2026-09-07T15:00:00Z");
function start(s, now = monday, id = "one") { return transition(s, { action: "start" }, now, () => id); }
function tick(s, seq, now, id = "one") { return transition(s, { action: "tick", seq, sessionId: id }, now); }

test("30 minutes earns $5, one hour $10; paid time stops at five hours without losing extra study time", () => {
  assert.equal(earnedCents(1800000), 500);
  assert.equal(earnedCents(3600000), 1000);
  assert.equal(earnedCents(WEEK_CAP_MS + 3600000), 5000);
  const s = emptyRewards(); addTime(s, monday, monday + 6 * 3600000);
  const w = summary(s, monday).weeks[0];
  assert.equal(w.ms, 6 * 3600000); assert.equal(w.earnedCents, 5000);
  assert.equal(earnedCents(3599), 0); assert.equal(earnedCents(3600), 1);
});
test("server clock counts intervals, ignores submitted duration, rejects duplicate/out-of-order ticks", () => {
  const s = emptyRewards(); start(s);
  transition(s, { action: "tick", sessionId: "one", seq: 1, elapsed: 3600000 }, monday + 10000);
  tick(s, 1, monday + 11000); tick(s, 0, monday + 12000);
  assert.equal(summary(s, monday).todayMs, 10000);
  tick(s, 2, monday + 20000);
  assert.equal(summary(s, monday).todayMs, 20000);
  transition(s, { action: "stop", sessionId: "one", seq: 3 }, monday + 22500);
  assert.equal(summary(s, monday).todayMs, 22500); assert.equal(s.session, null);
});
test("only one device can run a session; a stale device cannot update or stop its replacement", () => {
  const s = emptyRewards(); start(s);
  assert.equal(start(s, monday + 1000, "two").status, 409);
  assert.equal(tick(s, 1, monday + 1000, "two").status, 409);
  start(s, monday + 31000, "two");
  assert.equal(transition(s, { action: "stop", seq: 99, sessionId: "one" }, monday + 32000).status, 409);
  assert.equal(s.session.id, "two"); assert.equal(summary(s, monday).todayMs, 0);
});
test("sleep, offline gaps, closed tabs and delayed requests cannot accumulate background hours", () => {
  const s = emptyRewards(); start(s);
  tick(s, 1, monday + 25000);
  assert.equal(summary(s, monday).todayMs, 15000);
  assert.equal(tick(s, 2, monday + 3600000).status, 409);
  assert.equal(summary(s, monday).todayMs, 15000); assert.equal(s.session, null);
});
test("Central-time Sunday midnight splits daily totals and starts a fresh Monday allowance", () => {
  const boundary = Date.parse("2026-09-14T05:00:00Z"), s = emptyRewards();
  addTime(s, boundary - 5000, boundary + 7000);
  assert.equal(s.days["2026-09-13"], 5000); assert.equal(s.days["2026-09-14"], 7000);
  assert.equal(s.weeks["2026-09-07"].ms, 5000); assert.equal(s.weeks["2026-09-14"].ms, 7000);
  assert.equal(weekKey(boundary), "2026-09-14");
});
test("Central calendar handles DST changes, winter midnight and year rollover", () => {
  const s = emptyRewards();
  addTime(s, Date.parse("2026-11-01T06:59:55Z"), Date.parse("2026-11-01T07:00:05Z"));
  assert.equal(s.days["2026-11-01"], 10000);
  assert.equal(dayKey(Date.parse("2027-01-01T05:59:59Z")), "2026-12-31");
  assert.equal(dayKey(Date.parse("2027-01-01T06:00:00Z")), "2027-01-01");
  assert.equal(weekKey(Date.parse("2027-01-01T12:00:00Z")), "2026-12-28");
});
test("approvals are exact, durable, idempotent and do not erase time or previous weeks", () => {
  const s = emptyRewards(); addTime(s, monday, monday + 1800000);
  const body = { action: "approve", week: "2026-09-07", cents: 500 };
  assert.equal(transition(s, { ...body, cents: 499 }, monday + 2000000).status, 409);
  assert.equal(transition(s, body, monday + 2000000).approvedCents, 500);
  assert.equal(transition(s, body, monday + 2001000).status, 409);
  addTime(s, monday + 2000000, monday + 2003600);
  const reloaded = JSON.parse(JSON.stringify(s));
  const w = summary(reloaded, monday + 7 * 86400000).weeks.find(w => w.week === "2026-09-07");
  assert.equal(w.ms, 1803600); assert.equal(w.approvedCents, 500); assert.equal(w.pendingCents, 1);
  assert.equal(w.approvals.length, 1);
});
test("parent approval fails closed; wrong or missing codes never reach storage", async () => {
  const hash = createHash("sha256").update("test-only-parent-code").digest("hex");
  assert.equal(parentAuthorized("test-only-parent-code", hash), true);
  assert.equal(parentAuthorized("wrong", hash), false);
  assert.equal(parentAuthorized("wrong", ""), false);
  assert.equal(parentAuthorized("wrong", "invalid"), false);
  const res = { setHeader(){}, status(n){ this.statusCode = n; return this; }, json(body){ this.body = body; } };
  await handler({ method: "POST", headers: { authorization: `Bearer ${process.env.LEO_API_TOKEN || process.env.API_TOKEN || ""}` }, body: { action: "approve", week: "2026-09-07", cents: 500, code: "wrong" } }, res);
  assert.equal(res.statusCode, 403);
});
test("idle, focus, visibility and offline gates pause; legitimate thinking time is allowed", () => {
  const active = { now: 90000, lastActivity: 0, visible: true, focused: true, online: true };
  assert.equal(pauseReason(active), "");
  assert.match(pauseReason({ ...active, now: IDLE_MS }), /two minutes/);
  assert.match(pauseReason({ ...active, visible: false }), /away/);
  assert.match(pauseReason({ ...active, focused: false }), /away/);
  assert.match(pauseReason({ ...active, online: false }), /Connection/);
  assert.equal(duration(1800000), "30:00");
});
