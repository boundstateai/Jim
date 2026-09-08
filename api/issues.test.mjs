import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIssues, buildTagPrompt, tagIssues, rankIssues, formatIssueSummary, normalizeFormulaIndex,
  MAX_ISSUES_PER_TURN, MAX_EVIDENCE_CHARS,
} from "./_lib/issues.js";
import { lastTurn } from "./chats.js";
import { struggleAddendum } from "./_lib/chatMessages.js";

const formulas = [{ id: "4-02", name: "Newton's 2nd Law", ch: 4 }, { id: "4-05", name: "Normal force on an incline", ch: 4 }];

test("normalizeIssues: keeps valid, nulls unknown formula ids, drops junk, caps per turn", () => {
  const out = normalizeIssues({ issues: [
    { formulaId: "4-05", kind: "misconception", topic: "normal force = mg on ramp", evidence: "isn't N just mg" },
    { formulaId: "9-99", chapter: 9, kind: "algebra", topic: "  dividing   both sides ", evidence: "x".repeat(MAX_EVIDENCE_CHARS + 50) },
    { formulaId: "4-02", kind: "vibes", topic: "nope", evidence: "nope" },
    { formulaId: "4-02", kind: "units", topic: "", evidence: "no topic" },
    { formulaId: "4-02", kind: "units", topic: "kg vs N", evidence: "" },
    { kind: "setup", topic: "sign convention", evidence: "a" },
    { kind: "recall", topic: "couldn't recall F=ma", evidence: "b" },
    { kind: "misread", topic: "missed the angle", evidence: "c" },
  ] }, formulas);
  assert.equal(out.length, MAX_ISSUES_PER_TURN);
  assert.deepEqual(out[0], { formulaId: "4-05", chapter: 4, topic: "normal force = mg on ramp", kind: "misconception", evidence: "isn't N just mg" });
  assert.equal(out[1].formulaId, null);
  assert.equal(out[1].chapter, 9);
  assert.equal(out[1].topic, "dividing both sides");
  assert.equal(out[1].evidence.length, MAX_EVIDENCE_CHARS);
  assert.equal(out[2].kind, "setup");
  assert.deepEqual(normalizeIssues({ issues: [] }, formulas), []);
  assert.deepEqual(normalizeIssues(null, formulas), []);
});

test("tag prompt lists the catalog and is biased toward tagging nothing", () => {
  const p = buildTagPrompt({ persona: "Dr. Newton", subject: "physics", formulas, user: "why", assistant: "because" });
  assert.match(p, /4-05 \(ch 4\): Normal force on an incline/);
  assert.match(p, /Most exchanges have no issue/);
  assert.match(p, /A question is not an issue/);
  assert.match(p, /\{"issues":\[\]\}/);
});

test("tagIssues runs the model once per turn and normalizes; skips empty turns", async () => {
  const calls = [];
  const runner = async (prompt, opts) => { calls.push({ prompt, opts }); return { issues: [{ formulaId: "4-02", kind: "algebra", topic: "solving for a", evidence: "so a = F times m?" }] }; };
  const out = await tagIssues({ persona: "Dr. Newton", subject: "physics", formulas, user: "so a = F times m?", assistant: "Divide, don't multiply." }, runner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.maxTokens, 400);
  assert.deepEqual(out, [{ formulaId: "4-02", chapter: 4, topic: "solving for a", kind: "algebra", evidence: "so a = F times m?" }]);
  assert.deepEqual(await tagIssues({ formulas, user: "  ", assistant: "" }, runner), []);
  assert.equal(calls.length, 1);
});

test("normalizeFormulaIndex tolerates garbage", () => {
  assert.deepEqual(normalizeFormulaIndex([{ id: "1-01", name: "x", ch: "3" }, null, { id: 5 }, "nope"]), [{ id: "1-01", name: "x", ch: 3 }]);
  assert.deepEqual(normalizeFormulaIndex("nope"), []);
});

test("lastTurn pairs the newest user message with the reply after it", () => {
  assert.deepEqual(lastTurn([{ role: "user", content: "q1" }, { role: "assistant", content: "a1" }, { role: "user", content: "q2" }, { role: "assistant", content: "a2" }]), { user: "q2", assistant: "a2" });
  assert.deepEqual(lastTurn([{ role: "user", content: "q" }]), { user: "q", assistant: "" });
  assert.equal(lastTurn([{ role: "assistant", content: "a" }]), null);
});

test("rankIssues: frequent-and-recent beats frequent-and-stale; a lone fresh issue still floats", () => {
  const now = Date.UTC(2026, 8, 7);
  const d = n => now - n * 86_400_000;
  const ranked = rankIssues([
    { key: "stale", count: 6, lastSeen: d(80), firstSeen: d(90) },
    { key: "fresh", count: 3, lastSeen: d(1), firstSeen: d(10) },
    { key: "once", count: 1, lastSeen: d(0), firstSeen: d(0) },
  ], { days: 90, now });
  assert.deepEqual(ranked.map(g => g.key), ["fresh", "once", "stale"]);
});

test("formatIssueSummary reads like a ledger the report can quote", () => {
  const text = formatIssueSummary([
    { formulaId: "4-05", chapter: 4, topic: "normal force on incline", count: 6, firstSeen: Date.UTC(2026, 7, 28), lastSeen: Date.UTC(2026, 8, 6), kinds: ["misconception", "setup"], evidence: ["isn't N just mg", "N = mg right"] },
    { formulaId: null, chapter: null, topic: "significant figures", count: 1, firstSeen: Date.UTC(2026, 8, 2), lastSeen: Date.UTC(2026, 8, 2), kinds: ["units"], evidence: ["9.81 or 9.8?"] },
  ]);
  assert.match(text, /- \[4-05\] normal force on incline \(ch 4\): 6× between 2026-08-28 and 2026-09-06 — misconception, setup\n    e\.g\. "isn't N just mg" \/ "N = mg right"/);
  assert.match(text, /- significant figures: once on 2026-09-02 — units/);
  assert.match(formatIssueSummary([]), /No tracked trouble spots yet/);
});

test("struggle addendum puts tracked spots ahead of raw chats", () => {
  const text = struggleAddendum({ count: 3, text: "Leo: hi", tracked: "- [4-05] normal force: 6×", trackedDays: 90 });
  assert.ok(text.indexOf("TRACKED TROUBLE SPOTS") < text.indexOf("SAVED CHATS"));
  assert.match(text, /Lead with these/);
  assert.doesNotMatch(struggleAddendum({ count: 3, text: "Leo: hi" }), /TRACKED TROUBLE SPOTS/);
});

const url = process.env.DATABASE_URL;
test("issue store: record + ranked summary", { skip: !url && "DATABASE_URL not set" }, async () => {
  const { recordIssues, issueSummary } = await import("./_lib/issues.js");
  const { pool } = await import("./_lib/db.js");
  const course = `test-${Date.now()}`;
  try {
    await recordIssues(course, "s1", [{ formulaId: "4-05", chapter: 4, topic: "normal force", kind: "misconception", evidence: "e1" }], 1000);
    await recordIssues(course, "s2", [{ formulaId: "4-05", chapter: 4, topic: "normal force on ramp", kind: "setup", evidence: "e2" }, { formulaId: null, chapter: null, topic: "sig figs", kind: "units", evidence: "e3" }], Date.now());
    const summary = await issueSummary(course);
    assert.equal(summary.length, 2);
    const nf = summary.find(g => g.formulaId === "4-05");
    assert.equal(nf.count, 2);
    assert.deepEqual(nf.evidence, ["e2", "e1"]);
  } finally {
    await pool.query("DELETE FROM chat_issues WHERE course = $1", [course]);
    await pool.end();
  }
});
