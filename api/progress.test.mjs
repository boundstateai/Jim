// Integration test for the progress store's safety rails.
// Needs a scratch Postgres:  DATABASE_URL=postgresql://... node --test api/progress.test.mjs
// Skips (passes) when DATABASE_URL is unset so it never blocks a build.
import test from "node:test";
import assert from "node:assert/strict";

const url = process.env.DATABASE_URL;

test("progress store: blank snapshots cannot clobber earned work; history + restore work", { skip: !url && "DATABASE_URL not set" }, async () => {
  const db = await import("./_lib/db.js");
  const course = `test-${Date.now()}`;

  const work = {
    version: 6,
    cardData: { "1-02": { write: { passedAt: 1, attempts: 1 } } },
    gradeHistory: [{ id: "1-02", mode: "write", q: 5, verdict: "CORRECT", ts: 1000 }],
    lastLogin: "2026-08-27T00:00:00.000Z",
    streakDays: 4,
    updatedAt: 1000,
  };
  const blank = { version: 6, cardData: {}, gradeHistory: [], lastLogin: "2026-09-01T00:00:00.000Z", streakDays: 1, updatedAt: 2000 };

  try {
    // 1. Fresh course accepts a blank row (nothing to protect yet).
    let result = await db.putProgress(course, blank);
    assert.equal(result.ok, true);

    // 2. Real work replaces it; previous copy archived.
    result = await db.putProgress(course, work);
    assert.equal(result.ok, true);
    assert.equal((await db.getProgress(course)).streakDays, 4);

    // 3. The incident: a newer blank snapshot. Must be refused and the stored copy handed back.
    result = await db.putProgress(course, { ...blank, updatedAt: 3000 });
    assert.equal(result.ok, false);
    assert.equal(result.rejected, "empty-overwrite");
    assert.equal(Object.keys(result.progress.cardData).length, 1);
    assert.equal((await db.getProgress(course)).updatedAt, 1000, "stored row untouched");

    // 4. An explicit reset is allowed, and the work goes to history.
    result = await db.putProgress(course, { ...blank, updatedAt: 4000 }, { reset: true });
    assert.equal(result.ok, true);
    assert.equal(db.hasProgressData(await db.getProgress(course)), false);

    const history = await db.listProgressHistory(course);
    assert.equal(history.length, 2);
    assert.equal(history[0].reason, "reset");
    assert.equal(history[0].cards, 1);
    assert.equal(history[0].grades, 1);
    assert.equal(history[0].updatedAt, 1000);

    // 5. Restore brings the work back with a fresh updatedAt, and archives the blank row.
    const entry = await db.getProgressHistoryEntry(course, history[0].id);
    assert.equal(entry.progress.streakDays, 4);
    result = await db.restoreProgress(course, history[0].id);
    assert.equal(result.ok, true);
    const restored = await db.getProgress(course);
    assert.equal(Object.keys(restored.cardData).length, 1);
    assert.ok(restored.updatedAt > 4000);
    assert.equal((await db.listProgressHistory(course))[0].reason, "restore-replaced");

    assert.equal((await db.restoreProgress(course, 999999999)).ok, false);
  } finally {
    await db.pool.query("DELETE FROM progress WHERE course = $1", [course]);
    await db.pool.query("DELETE FROM progress_history WHERE course = $1", [course]);
    await db.pool.end();
  }
});
