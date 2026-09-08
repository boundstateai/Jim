import { courseUserId } from "./course.js";
// Railway Postgres progress store. One JSONB blob per (user_id, course).
// Course-aware so chem and physics never collide, but defaults to "chem" so the
// current frontend keeps working unchanged.
//
// Two safety rails, added after Leo's physics progress was wiped by a blank
// client snapshot (Sept 2026):
//   1. Every overwrite first copies the previous row into `progress_history`,
//      so any bad write can be undone with restoreProgress().
//   2. A PUT whose snapshot holds no earned work is refused when the stored row
//      does hold work, unless the client says `reset: true` on purpose.

import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);

// Module-scoped pool — reused across warm serverless invocations.
export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 3,
});

export const USER_ID = "jim";

// How many superseded copies to keep per course. Single user, a few writes a
// day: 500 is months of undo at negligible cost.
export const HISTORY_KEEP = 500;

let schemaReady = null;

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS progress (
          user_id    text   NOT NULL,
          course     text   NOT NULL DEFAULT 'chem',
          data       jsonb  NOT NULL,
          updated_at bigint NOT NULL,
          PRIMARY KEY (user_id, course)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS progress_history (
          id          bigserial PRIMARY KEY,
          user_id     text   NOT NULL,
          course      text   NOT NULL,
          data        jsonb  NOT NULL,
          updated_at  bigint NOT NULL,
          replaced_at bigint NOT NULL,
          reason      text   NOT NULL DEFAULT 'put'
        );
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS progress_history_course_idx
          ON progress_history (user_id, course, replaced_at DESC);
      `);
    })().catch(error => {
      schemaReady = null; // let the next request retry instead of caching a failure
      throw error;
    });
  }
  return schemaReady;
}

function emptyProgress(course) {
  return {
    version: 6,
    userId: courseUserId(course),
    course,
    cardData: {},
    gradeHistory: [],
    lastLogin: "",
    streakDays: 0,
    updatedAt: 0,
  };
}

// Mirrors hasProgressData() in src/engine.js: any reviewed card or graded
// attempt counts as earned work; login/streak bookkeeping does not.
export function hasProgressData(progress) {
  if (!progress || typeof progress !== "object") return false;
  const cards =
    progress.cardData && typeof progress.cardData === "object" ? Object.keys(progress.cardData).length : 0;
  const history = Array.isArray(progress.gradeHistory) ? progress.gradeHistory.length : 0;
  return cards > 0 || history > 0;
}

export async function getProgress(course = "jim-math") {
  await ensureSchema();
  const { rows } = await pool.query(
    "SELECT data FROM progress WHERE user_id = $1 AND course = $2",
    [courseUserId(course), course],
  );
  return rows[0]?.data || emptyProgress(course);
}

async function archiveRow(client, course, row, reason, replacedAt) {
  await client.query(
    `INSERT INTO progress_history (user_id, course, data, updated_at, replaced_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [courseUserId(course), course, row.data, Number(row.updated_at) || 0, replacedAt, reason],
  );
  await client.query(
    `DELETE FROM progress_history
      WHERE user_id = $1 AND course = $2
        AND id NOT IN (
          SELECT id FROM progress_history
           WHERE user_id = $1 AND course = $2
           ORDER BY replaced_at DESC, id DESC
           LIMIT $3
        )`,
    [courseUserId(course), course, HISTORY_KEEP],
  );
}

async function upsertRow(client, course, data, updatedAt) {
  await client.query(
    `INSERT INTO progress (user_id, course, data, updated_at)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, course)
       DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [courseUserId(course), course, data, updatedAt],
  );
}

/**
 * Store a snapshot. Returns `{ ok: true, updatedAt }` on success, or
 * `{ ok: false, rejected: "empty-overwrite", progress }` when the incoming
 * snapshot has no earned work but the stored one does and `reset` is not set.
 * The stored progress is returned in that case so the client can adopt it.
 */
export async function putProgress(course = "jim-math", progress, { reset = false } = {}) {
  await ensureSchema();
  const updatedAt = Number(progress?.updatedAt) || Date.now();
  const data = { ...progress, userId: courseUserId(course), course, updatedAt };
  const now = Date.now();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT data, updated_at FROM progress WHERE user_id = $1 AND course = $2 FOR UPDATE",
      [courseUserId(course), course],
    );
    const existing = rows[0];

    if (existing && hasProgressData(existing.data) && !hasProgressData(data) && !reset) {
      await client.query("ROLLBACK");
      return { ok: false, rejected: "empty-overwrite", progress: existing.data };
    }

    if (existing) {
      await archiveRow(client, course, existing, reset ? "reset" : "put", now);
    }
    await upsertRow(client, course, data, updatedAt);
    await client.query("COMMIT");
    return { ok: true, updatedAt };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/** Superseded copies, newest first, summarized (no blobs). */
export async function listProgressHistory(course = "jim-math", limit = 50) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, updated_at, replaced_at, reason,
            CASE WHEN jsonb_typeof(data->'cardData') = 'object'
                 THEN (SELECT count(*) FROM jsonb_object_keys(data->'cardData'))
                 ELSE 0 END AS cards,
            CASE WHEN jsonb_typeof(data->'gradeHistory') = 'array'
                 THEN jsonb_array_length(data->'gradeHistory')
                 ELSE 0 END AS grades,
            data->>'lastLogin' AS last_login,
            data->>'streakDays' AS streak_days
       FROM progress_history
      WHERE user_id = $1 AND course = $2
      ORDER BY replaced_at DESC, id DESC
      LIMIT $3`,
    [courseUserId(course), course, Math.max(1, Math.min(Number(limit) || 50, HISTORY_KEEP))],
  );
  return rows.map(row => ({
    id: Number(row.id),
    updatedAt: Number(row.updated_at),
    replacedAt: Number(row.replaced_at),
    reason: row.reason,
    cards: Number(row.cards),
    grades: Number(row.grades),
    lastLogin: row.last_login || "",
    streakDays: Number(row.streak_days) || 0,
  }));
}

/** One superseded copy in full, or null. */
export async function getProgressHistoryEntry(course = "jim-math", id) {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, data, updated_at, replaced_at, reason
       FROM progress_history
      WHERE user_id = $1 AND course = $2 AND id = $3`,
    [courseUserId(course), course, Number(id)],
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    updatedAt: Number(rows[0].updated_at),
    replacedAt: Number(rows[0].replaced_at),
    reason: rows[0].reason,
    progress: rows[0].data,
  };
}

/**
 * Make a superseded copy current again. The current row is archived first
 * (reason "restore-replaced") so a restore is itself undoable. The restored
 * snapshot gets a fresh updatedAt so stale blank copies on devices lose the
 * merge.
 */
export async function restoreProgress(course = "jim-math", id) {
  await ensureSchema();
  const entry = await getProgressHistoryEntry(course, id);
  if (!entry) return { ok: false, rejected: "not-found" };

  const now = Date.now();
  const data = { ...entry.progress, userId: courseUserId(course), course, updatedAt: now };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT data, updated_at FROM progress WHERE user_id = $1 AND course = $2 FOR UPDATE",
      [courseUserId(course), course],
    );
    if (rows[0]) await archiveRow(client, course, rows[0], "restore-replaced", now);
    await upsertRow(client, course, data, now);
    await client.query("COMMIT");
    return { ok: true, updatedAt: now, progress: data };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}
