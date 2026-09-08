// node --test src/engine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyCardState,
  createEmptyProgress,
  hasProgressData,
  markLogin,
  mergeProgress,
} from "./engine.js";

const withWork = overrides =>
  createEmptyProgress({
    cardData: { "1-02": createEmptyCardState({ write: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" } }) },
    gradeHistory: [{ id: "1-02", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 1000 }],
    updatedAt: 1000,
    ...overrides,
  });

test("hasProgressData: blank vs earned work", () => {
  assert.equal(hasProgressData(null), false);
  assert.equal(hasProgressData(createEmptyProgress()), false);
  assert.equal(hasProgressData(createEmptyProgress({ streakDays: 9, lastLogin: "2026-09-01T00:00:00Z", updatedAt: 5 })), false);
  assert.equal(hasProgressData(withWork()), true);
  assert.equal(hasProgressData(createEmptyProgress({ gradeHistory: [{ id: "x" }] })), true);
});

test("mergeProgress: newest wins when both sides hold work", () => {
  const older = withWork({ updatedAt: 1000 });
  const newer = withWork({ updatedAt: 2000, streakDays: 3 });
  assert.equal(mergeProgress(older, newer).updatedAt, 2000);
  assert.equal(mergeProgress(newer, older).updatedAt, 2000);
});

test("mergeProgress: a blank local copy never outranks server work, even when newer", () => {
  const remote = withWork({ updatedAt: 1000 });
  // The Sept 2026 wipe: blank device, login bump gives it updatedAt = now.
  const blankButNewer = markLogin(createEmptyProgress());
  assert.ok(blankButNewer.updatedAt > remote.updatedAt);
  const merged = mergeProgress(blankButNewer, remote);
  assert.equal(hasProgressData(merged), true);
  assert.equal(Object.keys(merged.cardData).length, 1);
});

test("mergeProgress: local work beats a blank server copy and is flagged dirty for re-upload", () => {
  const local = withWork({ updatedAt: 1000, dirty: false });
  const blankRemote = createEmptyProgress({ updatedAt: 999999, streakDays: 2 });
  const merged = mergeProgress(local, blankRemote);
  assert.equal(hasProgressData(merged), true);
  assert.equal(merged.dirty, true);
});

test("mergeProgress: two blank copies fall back to the timestamp rule", () => {
  const a = createEmptyProgress({ updatedAt: 10, streakDays: 1 });
  const b = createEmptyProgress({ updatedAt: 20, streakDays: 2 });
  assert.equal(mergeProgress(a, b).streakDays, 2);
  assert.equal(mergeProgress(createEmptyProgress(), b).streakDays, 2);
  assert.equal(mergeProgress(b, createEmptyProgress()).streakDays, 2);
});

test("mergeProgress: two devices with work are unioned card by card", () => {
  const phone = withWork({
    updatedAt: 5000,
    cardData: {
      "1-02": createEmptyCardState({ lastReview: 5000, repetitions: 2, interval: 3, write: { passedAt: 1, attempts: 2, passedCount: 2, consecutiveCorrect: 2, lastVerdict: "CORRECT" } }),
      "3-01": createEmptyCardState({ lastReview: 4500, write: { passedAt: 4500, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" } }),
    },
    gradeHistory: [
      { id: "1-02", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 1000 },
      { id: "3-01", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 4500 },
    ],
    dirty: false,
  });
  const laptop = withWork({
    updatedAt: 6000,
    cardData: {
      // same card, reviewed later on the laptop but solve passed only on the phone
      "1-02": createEmptyCardState({ lastReview: 6000, repetitions: 3, interval: 7, write: { passedAt: 1, attempts: 3, passedCount: 3, consecutiveCorrect: 3, lastVerdict: "CORRECT" } }),
      "3-03": createEmptyCardState({ lastReview: 5500, write: { passedAt: 5500, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" } }),
    },
    gradeHistory: [
      { id: "1-02", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 1000 }, // duplicate of phone's
      { id: "1-02", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 6000 },
      { id: "3-03", mode: "write", q: 5, verdict: "CORRECT", explanation: "", ts: 5500 },
    ],
    dirty: false,
  });
  phone.cardData["1-02"].solve = { passedAt: 4800, attempts: 1, lastVerdict: "CORRECT" };

  const merged = mergeProgress(phone, laptop);
  assert.deepEqual(Object.keys(merged.cardData).sort(), ["1-02", "3-01", "3-03"]);
  assert.equal(merged.cardData["1-02"].repetitions, 3, "newer SM-2 state wins");
  assert.equal(merged.cardData["1-02"].solve.passedAt, 4800, "stage passed on the other device stays passed");
  assert.equal(merged.cardData["1-02"].write.passedCount, 3);
  assert.equal(merged.gradeHistory.length, 4, "grades unioned, duplicate dropped");
  assert.deepEqual(merged.gradeHistory.map(e => e.ts), [1000, 4500, 5500, 6000]);
  assert.equal(merged.updatedAt, 6000);
  assert.equal(merged.dirty, true, "server (laptop copy) is missing the phone's work -> upload");

  // Symmetric, and idempotent: merging the union with the server copy again changes nothing.
  const again = mergeProgress(merged, laptop);
  assert.deepEqual(again.cardData, merged.cardData);
  assert.equal(mergeProgress(laptop, phone).gradeHistory.length, 4);
});

test("mergeProgress: identical copies are not flagged dirty", () => {
  const a = withWork({ updatedAt: 1000, dirty: false });
  const b = withWork({ updatedAt: 1000, dirty: false });
  assert.equal(mergeProgress(a, b).dirty, false);
  const localNewerSame = withWork({ updatedAt: 2000, dirty: false, streakDays: 7 });
  assert.equal(mergeProgress(localNewerSame, b).dirty, false);
  assert.equal(mergeProgress(localNewerSame, b).streakDays, 7);
});

import { examChapters, nextExam, examBoost, buildQueue, examReadiness, EXAM_PREP_DAYS } from "./engine.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 7, 12); // 2026-09-07 noon UTC
const F = [
  { id: "2-01", ch: 2, name: "v = v0 + at", formula: "v = v_0 + at" },
  { id: "4-02", ch: 4, name: "Newton's 2nd", formula: "ΣF = ma" },
  { id: "9-01", ch: 9, name: "Rotational KE", formula: "KE = ½Iω²" },
];
const exams = [
  { label: "Exam 1 (Ch 1–5)", date: "2026-09-24" },
  { label: "Exam 2 (Ch 6–10)", date: "2026-10-29", chapters: [6, 7, 8, 9, 10] },
  { label: "Final (comprehensive)", date: "2026-12-10" },
];

test("examChapters: explicit list, parsed label ranges, comprehensive → null", () => {
  assert.deepEqual(examChapters({ label: "Exam 1 (Ch 1–5)" }), [1, 2, 3, 4, 5]);
  assert.deepEqual(examChapters({ label: "Exam 3 (Ch 16-17)" }), [16, 17]);
  assert.deepEqual(examChapters({ label: "Quiz ch 7" }), [7]);
  assert.deepEqual(examChapters({ label: "whatever", chapters: [3, 4] }), [3, 4]);
  assert.equal(examChapters({ label: "Final (comprehensive)" }), null);
  assert.equal(examChapters({ label: "ACS Final" }), null);
});

test("nextExam: soonest future exam with days and chapters; past exams ignored", () => {
  const next = nextExam(exams, NOW);
  assert.equal(next.label, "Exam 1 (Ch 1–5)");
  assert.equal(next.days, 17);
  assert.deepEqual(next.chapters, [1, 2, 3, 4, 5]);
  const later = nextExam(exams, Date.UTC(2026, 8, 30));
  assert.equal(later.label, "Exam 2 (Ch 6–10)");
  assert.equal(nextExam(exams, Date.UTC(2027, 0, 1)), null);
  assert.equal(nextExam([], NOW), null);
});

test("examBoost: nothing outside the window, grows toward the date, penalizes out-of-scope, eases off mastered", () => {
  const exam = { chapters: [1, 2, 3, 4, 5] };
  const mastered = createEmptyCardState({
    write: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 3, lastVerdict: "CORRECT" },
    solve: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" },
    teach: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" },
  });
  assert.equal(examBoost(F[1], { ...exam, days: EXAM_PREP_DAYS + 1 }), 0);
  assert.equal(examBoost(F[1], { ...exam, days: 21 }), 120);
  assert.ok(examBoost(F[1], { ...exam, days: 3 }) > examBoost(F[1], { ...exam, days: 17 }));
  assert.equal(examBoost(F[1], { ...exam, days: 10 }, mastered), 40);
  assert.equal(examBoost(F[2], { ...exam, days: 10 }), -84);
  assert.equal(examBoost(F[2], { chapters: null, days: 10 }), 120 + 44, "comprehensive: everything in scope");
  assert.equal(examBoost(F[1], null), 0);
});

test("buildQueue: with an exam near, a half-done in-scope card beats a due, weak out-of-scope card; trouble spots bump", () => {
  // Realistic collision: ch 9 card is due and badly missed; ch 4 card passed Write and isn't due for 5 days.
  const dueWeakOutOfScope = createEmptyCardState({ write: { passedAt: 1, attempts: 3, passedCount: 1, consecutiveCorrect: 0, lastVerdict: "INCORRECT" }, nextReview: NOW - DAY });
  const notDueInScope = createEmptyCardState({ write: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" }, nextReview: NOW + 5 * DAY });
  const untouchedInScope = createEmptyCardState({ nextReview: NOW + 5 * DAY });
  const cardData = { "9-01": dueWeakOutOfScope, "4-02": notDueInScope, "2-01": untouchedInScope };
  const history = [{ id: "9-01", mode: "write", q: 1, ts: 1 }, { id: "9-01", mode: "write", q: 2, ts: 2 }];
  const blind = buildQueue(F, null, cardData, history, true);
  assert.equal(blind[0].formula.id, "9-01", "exam-blind: the due, weak card wins");
  const exam = nextExam(exams, NOW);
  const aware = buildQueue(F, null, cardData, history, true, { exam });
  assert.equal(aware[aware.length - 1].formula.id, "9-01", "exam-aware: chapter 1–5 cards come first, ch 9 last");
  assert.ok(aware.find(i => i.formula.id === "4-02").examScope);
  assert.equal(aware.find(i => i.formula.id === "9-01").examScope, false);
  const withTrouble = buildQueue(F, null, cardData, history, true, { exam, troubleIds: new Set(["4-02"]) });
  assert.equal(withTrouble[0].formula.id, "4-02");
  assert.equal(withTrouble[0].score - aware.find(i => i.formula.id === "4-02").score, 30);
});

test("examReadiness: counts, per-day pace, only in-scope trouble spots, per-chapter rollup", () => {
  const exam = nextExam(exams, NOW);
  const mastered = createEmptyCardState({
    write: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 3, lastVerdict: "CORRECT" },
    solve: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" },
    teach: { passedAt: 1, attempts: 1, passedCount: 1, consecutiveCorrect: 1, lastVerdict: "CORRECT" },
  });
  const started = createEmptyCardState({ write: { attempts: 2, passedAt: null, passedCount: 0, consecutiveCorrect: 0, lastVerdict: "INCORRECT" } });
  const r = examReadiness(F, { "2-01": mastered, "4-02": started }, [
    { id: "4-02", mode: "write", q: 1, verdict: "INCORRECT", ts: 1 }, { id: "4-02", mode: "write", q: 2, verdict: "INCORRECT", ts: 2 },
  ], exam, [
    { formulaId: "4-02", chapter: 4, topic: "N vs mg", count: 3 },
    { formulaId: "9-01", chapter: 9, topic: "rotation", count: 5 },
    { formulaId: null, chapter: 3, topic: "projectile angle", count: 1 },
  ], [{ n: 2, name: "Kinematics 1-D" }]);
  assert.equal(r.total, 2, "only chapters 1–5 count");
  assert.equal(r.mastered, 1); assert.equal(r.started, 1); assert.equal(r.untouched, 0);
  assert.equal(r.remaining, 1); assert.equal(r.perDay, 1); assert.equal(r.pct, 50);
  assert.deepEqual(r.trouble.map(t => t.topic), ["N vs mg", "projectile angle"]);
  assert.equal(r.weak[0].id, "4-02");
  assert.deepEqual(r.byChapter.find(c => c.n === 2), { n: 2, name: "Kinematics 1-D", total: 1, mastered: 1 });
  assert.equal(r.byChapter.find(c => c.n === 4).name, "Chapter 4");
  assert.equal(examReadiness(F, {}, [], null), null);
});
