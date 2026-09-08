import { courseUserId } from "./course.js";
// Trouble-spot tracking. After each saved chat turn, a small model call tags
// the turn with the specific things Leo got wrong or confused, keyed to the
// course pack's formula ids — the same ids the study engine grades against —
// so chat struggles and quiz struggles land on the same card. Biased hard
// toward tagging nothing: a question is not an issue, an error is.

import { pool } from "./db.js";
import { runJsonPrompt, TAGGER_MODEL } from "./anthropic.js";

export const ISSUE_KINDS = ["misconception", "algebra", "units", "setup", "misread", "recall"];
export const MAX_ISSUES_PER_TURN = 3;
export const MAX_EVIDENCE_CHARS = 160;
export const SUMMARY_DAYS = 90;

let issueSchemaReady = null;
export function ensureIssueSchema() {
  if (!issueSchemaReady) {
    issueSchemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_issues (
          id         bigserial PRIMARY KEY,
          user_id    text    NOT NULL,
          course     text    NOT NULL,
          session_id text    NOT NULL,
          formula_id text,
          chapter    integer,
          topic      text    NOT NULL,
          kind       text    NOT NULL,
          evidence   text    NOT NULL,
          created_at bigint  NOT NULL
        );
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS chat_issues_course_time_idx
          ON chat_issues (user_id, course, created_at DESC);
      `);
    })().catch(error => {
      issueSchemaReady = null;
      throw error;
    });
  }
  return issueSchemaReady;
}

/** Compact formula index the client sends with each save: [{id, name, ch}]. */
export function normalizeFormulaIndex(formulas) {
  if (!Array.isArray(formulas)) return [];
  return formulas
    .filter(f => f && typeof f.id === "string" && typeof f.name === "string")
    .slice(0, 400)
    .map(f => ({ id: f.id.slice(0, 20), name: f.name.slice(0, 80), ch: Number(f.ch) || null }));
}

export function buildTagPrompt({ persona = "the tutor", subject = "science", formulas = [], user = "", assistant = "" }) {
  const catalog = formulas.length
    ? formulas.map(f => `${f.id}${f.ch ? ` (ch ${f.ch})` : ""}: ${f.name}`).join("\n")
    : "(no formula catalog provided — use formulaId null)";
  return `You are tagging one exchange between a student and his ${subject} tutor (${persona}) for a trouble-spot tracker.

Your job is to notice ONLY things the student demonstrably got wrong or is confused about in THIS exchange. Most exchanges have no issue. A question is not an issue. Asking to be quizzed is not an issue. Getting something right is not an issue. Tag an issue only when the student states something incorrect, makes a calculation/algebra/unit/sign error, sets a problem up wrong, misreads what is asked, can't recall a formula he should know, or the tutor has to correct him.

Formula catalog (use the exact id when the issue is about that formula; otherwise formulaId null and name the topic):
${catalog}

Kinds: ${ISSUE_KINDS.join(" | ")}
- misconception: a wrong idea about how the subject works
- algebra: rearranging, solving, exponent/log/fraction slips
- units: unit conversion, missing units, wrong unit
- setup: free-body diagram, sign convention, picking the wrong equation
- misread: answered a different question than asked, missed a given
- recall: couldn't produce a formula or definition he needs

The student said:
"""
${user}
"""

${persona} replied:
"""
${assistant}
"""

Reply with JSON only, no prose:
{"issues":[{"formulaId":"4-02" or null,"chapter":4 or null,"topic":"short label, under 8 words","kind":"one of the kinds","evidence":"a short quote of the student's own words showing it, under 160 chars"}]}
If there is no issue: {"issues":[]}`;
}

/** Pure: clamp the model's answer to the schema. Unknown formula ids become null (topic kept). */
export function normalizeIssues(raw, formulas = []) {
  const ids = new Map(formulas.map(f => [f.id, f]));
  const list = Array.isArray(raw?.issues) ? raw.issues : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const kind = `${item.kind || ""}`.toLowerCase().trim();
    const topic = `${item.topic || ""}`.replace(/\s+/g, " ").trim().slice(0, 80);
    const evidence = `${item.evidence || ""}`.replace(/\s+/g, " ").trim().slice(0, MAX_EVIDENCE_CHARS);
    if (!ISSUE_KINDS.includes(kind) || !topic || !evidence) continue;
    const formulaId = typeof item.formulaId === "string" && ids.has(item.formulaId) ? item.formulaId : null;
    const chapter = formulaId ? ids.get(formulaId).ch : Number(item.chapter) || null;
    out.push({ formulaId, chapter, topic, kind, evidence });
    if (out.length >= MAX_ISSUES_PER_TURN) break;
  }
  return out;
}

/** One model call per saved turn. Injectable runner for tests. */
export async function tagIssues(input, runJson = runJsonPrompt) {
  const formulas = normalizeFormulaIndex(input.formulas);
  if (!`${input.user || ""}`.trim() && !`${input.assistant || ""}`.trim()) return [];
  const raw = await runJson(buildTagPrompt({ ...input, formulas }), { maxTokens: 400, model: TAGGER_MODEL });
  return normalizeIssues(raw, formulas);
}

export async function recordIssues(course, sessionId, issues, now = Date.now()) {
  if (!issues.length) return { ok: true, saved: 0 };
  await ensureIssueSchema();
  const session = `${sessionId || ""}`.slice(0, 80) || "unknown";
  for (const issue of issues) {
    await pool.query(
      `INSERT INTO chat_issues (user_id, course, session_id, formula_id, chapter, topic, kind, evidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [courseUserId(course), course, session, issue.formulaId, issue.chapter, issue.topic, issue.kind, issue.evidence, now],
    );
  }
  return { ok: true, saved: issues.length };
}

/**
 * Trouble spots grouped by formula (or topic when no formula fits), most
 * recent-and-frequent first. Recency weight: an issue from today counts 1,
 * one from `days` ago counts ~0.
 */
export async function issueSummary(course, { days = SUMMARY_DAYS, limit = 25 } = {}) {
  await ensureIssueSchema();
  const since = Date.now() - days * 86_400_000;
  const { rows } = await pool.query(
    `SELECT COALESCE(formula_id, 'topic:' || lower(topic)) AS key,
            formula_id,
            min(chapter) AS chapter,
            (array_agg(topic ORDER BY created_at DESC))[1] AS topic,
            count(*)::int AS count,
            min(created_at) AS first_seen,
            max(created_at) AS last_seen,
            array_agg(DISTINCT kind) AS kinds,
            (array_agg(evidence ORDER BY created_at DESC))[1:3] AS evidence
       FROM chat_issues
      WHERE user_id = $1 AND course = $2 AND created_at >= $3
      GROUP BY key, formula_id
      ORDER BY max(created_at) DESC
      LIMIT $4`,
    [courseUserId(course), course, since, Math.max(1, Math.min(Number(limit) || 25, 100))],
  );
  return rankIssues(rows.map(row => ({
    key: row.key,
    formulaId: row.formula_id,
    chapter: row.chapter === null ? null : Number(row.chapter),
    topic: row.topic,
    count: Number(row.count),
    firstSeen: Number(row.first_seen),
    lastSeen: Number(row.last_seen),
    kinds: row.kinds,
    evidence: row.evidence,
  })), { days });
}

/** Pure: score = count × recency, sorted desc. Exported for tests. */
export function rankIssues(groups, { days = SUMMARY_DAYS, now = Date.now() } = {}) {
  const span = days * 86_400_000;
  return groups
    .map(g => ({ ...g, score: Number((g.count * Math.max(0.15, 1 - (now - g.lastSeen) / span)).toFixed(2)) }))
    .sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
}

const day = ts => new Date(ts).toISOString().slice(0, 10);

/** Pure: the tracked list as the report prompt sees it. */
export function formatIssueSummary(groups, { days = SUMMARY_DAYS } = {}) {
  if (!groups.length) return `No tracked trouble spots yet in the last ${days} days.`;
  return groups
    .map(g => {
      const label = g.formulaId ? `[${g.formulaId}] ${g.topic}` : g.topic;
      const ch = g.chapter ? ` (ch ${g.chapter})` : "";
      const when = g.count === 1 ? `once on ${day(g.lastSeen)}` : `${g.count}× between ${day(g.firstSeen)} and ${day(g.lastSeen)}`;
      const kinds = g.kinds?.length ? ` — ${g.kinds.join(", ")}` : "";
      const quotes = (g.evidence || []).map(e => `"${e}"`).join(" / ");
      return `- ${label}${ch}: ${when}${kinds}${quotes ? `\n    e.g. ${quotes}` : ""}`;
    })
    .join("\n");
}
