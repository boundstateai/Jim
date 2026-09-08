const DAY_MS = 864e5;

export const LOCAL_KEY = "jim-math-v1";
export const LEGACY_KEY = null;
export const USER_ID = "jim";

export const MODE_META = {
  write: {
    label: "Write It",
    short: "W",
    color: "#ef4444",
    prompt: "Type the formula from memory.",
  },
  solve: {
    label: "Solve It",
    short: "S",
    color: "#0ea5e9",
    prompt: "Solve a fresh problem with the formula.",
  },
  teach: {
    label: "Teach It",
    short: "T",
    color: "#22c55e",
    prompt: "Explain the idea back in plain English.",
  },
};

const SUBSCRIPT_MAP = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
};

const SUPERSCRIPT_MAP = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
};

const SYMBOL_MAP = {
  "Δ": " delta ",
  "∆": " delta ",
  "δ": " delta ",
  "λ": " lambda ",
  "ν": " nu ",
  "π": " pi ",
  "Σ": " sum ",
  "ℓ": " l ",
  "χ": " chi ",
  "θ": " theta ",
  "ω": " omega ",
  "α": " alpha ",
  "τ": " tau ",
  "μ": " mu ",
  "ρ": " rho ",
  "φ": " phi ",
  "√": " sqrt ",
  "°": " degree ",
  "×": " x ",
  "·": " ",
  "−": "-",
  "→": " -> ",
  "⇌": " <-> ",
  "ₐ": "a",
  "ₑ": "e",
  "ₕ": "h",
  "ₖ": "k",
  "ₘ": "m",
  "ₙ": "n",
  "ₚ": "p",
  "ₛ": "s",
  "ₜ": "t",
};

function replaceMappedChars(value, map) {
  return Array.from(value)
    .map(char => map[char] ?? char)
    .join("");
}

function toMidnight(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function sm2(card, quality) {
  let {
    easeFactor = 2.5,
    interval = 1,
    repetitions = 0,
  } = card;

  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 3;
    else interval = Math.max(1, Math.round(interval * easeFactor));
    repetitions += 1;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  return {
    easeFactor,
    interval,
    repetitions,
    nextReview: Date.now() + interval * DAY_MS,
    lastReview: Date.now(),
    lastQuality: quality,
  };
}

export function daysUntil(dateString) {
  return Math.ceil((new Date(dateString) - new Date()) / DAY_MS);
}

export function gradeToQuality(verdict) {
  if (verdict === "CORRECT") return 5;
  if (verdict === "PARTIAL") return 3;
  return 1;
}

export function createEmptyCardState(overrides = {}) {
  return {
    easeFactor: 2.5,
    interval: 1,
    repetitions: 0,
    nextReview: 0,
    lastReview: 0,
    lastQuality: 0,
    lastMode: "write",
    lastVerdict: null,
    lastFeedback: "",
    write: {
      passedAt: 0,
      attempts: 0,
      passedCount: 0,
      consecutiveCorrect: 0,
      lastVerdict: null,
    },
    solve: {
      passedAt: 0,
      attempts: 0,
      lastVerdict: null,
    },
    teach: {
      passedAt: 0,
      attempts: 0,
      lastVerdict: null,
    },
    ...overrides,
  };
}

export function ensureCardState(card) {
  if (!card) return createEmptyCardState();
  return createEmptyCardState({
    ...card,
    write: { ...createEmptyCardState().write, ...(card.write || {}) },
    solve: { ...createEmptyCardState().solve, ...(card.solve || {}) },
    teach: { ...createEmptyCardState().teach, ...(card.teach || {}) },
  });
}

export function createEmptyProgress(overrides = {}) {
  return {
    version: 6,
    userId: USER_ID,
    cardData: {},
    gradeHistory: [],
    lastLogin: "",
    streakDays: 0,
    updatedAt: 0,
    lastSyncedAt: 0,
    dirty: false,
    ...overrides,
  };
}

function normalizeGradeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(entry => entry && entry.id)
    .map(entry => ({
      id: entry.id,
      mode: entry.mode || "write",
      q: Number(entry.q) || 0,
      verdict: entry.verdict || (entry.q >= 4 ? "CORRECT" : entry.q >= 3 ? "PARTIAL" : "INCORRECT"),
      explanation: entry.explanation || "",
      ts: Number(entry.ts) || Date.now(),
      ...entry,
    }));
}

function migrateLegacy(raw) {
  if (!raw || (!raw.cd && !raw.hist)) {
    return createEmptyProgress();
  }

  const historyTimestamps = Array.isArray(raw.hist)
    ? raw.hist.map(entry => Number(entry?.ts) || 0)
    : [];
  const cardTimestamps = Object.values(raw.cd || {}).map(card => Number(card?.lastReview) || 0);
  const legacyUpdatedAt = Math.max(
    Number(raw.updatedAt) || 0,
    Number(raw.lastLogin ? new Date(raw.lastLogin).getTime() : 0) || 0,
    ...historyTimestamps,
    ...cardTimestamps,
  );

  const cardData = Object.entries(raw.cd || {}).reduce((acc, [id, card]) => {
    acc[id] = createEmptyCardState({
      easeFactor: Number(card?.easeFactor) || 2.5,
      interval: Number(card?.interval) || 1,
      repetitions: Number(card?.repetitions) || 0,
      nextReview: Number(card?.nextReview) || 0,
      lastReview: Number(card?.lastReview) || 0,
      lastQuality: Number(card?.lastQuality) || 0,
      lastMode: "legacy",
      lastVerdict: null,
      lastFeedback: "Imported from the self-graded v5 deck.",
    });
    return acc;
  }, {});

  const gradeHistory = normalizeGradeHistory(raw.hist).map(entry => ({
    ...entry,
    mode: entry.mode === "write" ? "legacy" : entry.mode,
    explanation: entry.explanation || "Imported from v5 self-graded history.",
  }));

  return createEmptyProgress({
    cardData,
    gradeHistory,
    lastLogin: raw.lastLogin || "",
    streakDays: Number(raw.streakDays) || 0,
    updatedAt: legacyUpdatedAt,
    dirty: true,
  });
}

export function normalizeProgress(raw) {
  if (!raw) return createEmptyProgress();
  if (raw.cd || raw.hist) return migrateLegacy(raw);

  const cardData = Object.entries(raw.cardData || {}).reduce((acc, [id, card]) => {
    acc[id] = ensureCardState(card);
    return acc;
  }, {});

  return createEmptyProgress({
    ...raw,
    cardData,
    gradeHistory: normalizeGradeHistory(raw.gradeHistory),
    lastLogin: raw.lastLogin || "",
    streakDays: Number(raw.streakDays) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    lastSyncedAt: Number(raw.lastSyncedAt) || 0,
    dirty: Boolean(raw.dirty),
  });
}

export function markLogin(progress, now = new Date()) {
  const next = normalizeProgress(progress);
  const today = toMidnight(now);
  const last = next.lastLogin ? toMidnight(next.lastLogin) : null;

  if (last && last.getTime() === today.getTime()) {
    return next;
  }

  const diffDays = last ? Math.round((today - last) / DAY_MS) : 0;
  const streakDays = diffDays === 1 ? (next.streakDays || 0) + 1 : 1;

  return {
    ...next,
    lastLogin: now.toISOString(),
    streakDays,
    updatedAt: Date.now(),
    dirty: true,
  };
}

// True when a snapshot holds any earned work (a reviewed card or a graded
// attempt). Streak/login bookkeeping alone does not count.
export function hasProgressData(progress) {
  if (!progress || typeof progress !== "object") return false;
  const cards =
    progress.cardData && typeof progress.cardData === "object" ? Object.keys(progress.cardData).length : 0;
  const history = Array.isArray(progress.gradeHistory) ? progress.gradeHistory.length : 0;
  return cards > 0 || history > 0;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Two copies of the same card from two devices: the one reviewed most recently
// carries the SM-2 state; a stage passed on either device stays passed.
function mergeCard(a, b) {
  const first = ensureCardState(a);
  const second = ensureCardState(b);
  const [newer, older] = (first.lastReview || 0) >= (second.lastReview || 0) ? [first, second] : [second, first];
  const stage = key => ({
    ...newer[key],
    passedAt: Math.max(newer[key].passedAt || 0, older[key].passedAt || 0),
    attempts: Math.max(newer[key].attempts || 0, older[key].attempts || 0),
  });
  return {
    ...newer,
    write: { ...stage("write"), passedCount: Math.max(newer.write.passedCount || 0, older.write.passedCount || 0) },
    solve: stage("solve"),
    teach: stage("teach"),
  };
}

function gradeKey(entry) {
  return `${entry.id}|${entry.mode}|${entry.ts}`;
}

// Merge a local and a server copy. Rules, in order:
//  1. A copy with earned work always beats a blank one, whatever the
//     timestamps. A fresh browser (new phone, cleared Safari storage, private
//     tab) starts blank and can mint a "newer" updatedAt via the login/streak
//     bump; before this rule that blank copy outranked the server copy and
//     wiped it (Sept 2026 incident).
//  2. Two copies that both hold work are UNIONED card by card and grade by
//     grade, so studying on the phone and then on the laptop keeps both
//     sessions instead of dropping whichever synced first. Streak/login
//     bookkeeping comes from the newer copy.
//  3. Two blank copies: newest wins.
// The result is flagged dirty whenever it differs from what the server holds,
// so the union gets uploaded.
export function mergeProgress(localProgress, remoteProgress) {
  const local = normalizeProgress(localProgress);
  const remote = normalizeProgress(remoteProgress);

  const localHasData = hasProgressData(local);
  const remoteHasData = hasProgressData(remote);
  if (localHasData !== remoteHasData) {
    if (localHasData) return { ...local, dirty: true };
    return remote;
  }

  if (!localHasData) {
    if (!remote.updatedAt) return local;
    if (!local.updatedAt) return remote;
    return local.updatedAt >= remote.updatedAt ? local : remote;
  }

  const [newer, older] = local.updatedAt >= remote.updatedAt ? [local, remote] : [remote, local];

  const cardData = {};
  for (const id of new Set([...Object.keys(older.cardData), ...Object.keys(newer.cardData)])) {
    const a = newer.cardData[id];
    const b = older.cardData[id];
    cardData[id] = a && b ? mergeCard(a, b) : ensureCardState(a || b);
  }

  const seen = new Set();
  const gradeHistory = [...older.gradeHistory, ...newer.gradeHistory]
    .filter(entry => {
      const key = gradeKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.ts - b.ts)
    .slice(-1000);

  const changedRemote =
    stableStringify(cardData) !== stableStringify(remote.cardData) ||
    stableStringify(gradeHistory) !== stableStringify(remote.gradeHistory);

  return {
    ...newer,
    cardData,
    gradeHistory,
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    dirty: changedRemote || (newer === local && local.dirty),
  };
}

export function toRemoteProgress(progress) {
  const next = normalizeProgress(progress);
  return {
    version: next.version,
    userId: next.userId,
    cardData: next.cardData,
    gradeHistory: next.gradeHistory,
    lastLogin: next.lastLogin,
    streakDays: next.streakDays,
    updatedAt: next.updatedAt,
  };
}

export function isMastered(card) {
  const next = ensureCardState(card);
  return Boolean(next.write.passedAt && next.solve.passedAt && next.teach.passedAt);
}

export function getReviewMode(card, online = true) {
  const next = ensureCardState(card);

  if (!next.write.passedAt) return "write";
  if (!online && !isMastered(next)) return "write";

  if (!next.solve.passedAt) {
    return next.lastMode === "write" && next.lastVerdict === "CORRECT" ? "solve" : "write";
  }

  if (next.write.consecutiveCorrect < 3) return "write";
  if (!next.teach.passedAt) return online ? "teach" : "write";
  if (!online) return "write";

  const rotation = next.repetitions % 3;
  if (rotation === 0) return "write";
  if (rotation === 1) return "solve";
  return "teach";
}

export function getCardStage(card) {
  const next = ensureCardState(card);
  if (isMastered(next)) return "mastered";
  if (!next.write.passedAt) return "write";
  if (!next.solve.passedAt) return "solve";
  if (next.write.consecutiveCorrect < 3 || !next.teach.passedAt) return "teach";
  return "write";
}

export function applyReview(progress, formula, mode, verdict, explanation, details = {}) {
  const quality = gradeToQuality(verdict);
  const prev = normalizeProgress(progress);
  const currentCard = ensureCardState(prev.cardData[formula.id]);
  const masteredBefore = isMastered(currentCard);
  const base = sm2(currentCard, quality);
  const now = Date.now();

  const nextCard = ensureCardState({
    ...currentCard,
    ...base,
    lastMode: mode,
    lastVerdict: verdict,
    lastFeedback: explanation || "",
  });

  if (mode === "write") {
    nextCard.write = {
      ...nextCard.write,
      attempts: nextCard.write.attempts + 1,
      passedCount: verdict === "CORRECT" ? nextCard.write.passedCount + 1 : nextCard.write.passedCount,
      consecutiveCorrect: verdict === "CORRECT" ? nextCard.write.consecutiveCorrect + 1 : 0,
      passedAt: verdict === "CORRECT" ? nextCard.write.passedAt || now : nextCard.write.passedAt,
      lastVerdict: verdict,
    };
  }

  if (mode === "solve") {
    nextCard.solve = {
      ...nextCard.solve,
      attempts: nextCard.solve.attempts + 1,
      passedAt: verdict === "CORRECT" ? nextCard.solve.passedAt || now : nextCard.solve.passedAt,
      lastVerdict: verdict,
    };
  }

  if (mode === "teach") {
    nextCard.teach = {
      ...nextCard.teach,
      attempts: nextCard.teach.attempts + 1,
      passedAt: verdict === "CORRECT" ? nextCard.teach.passedAt || now : nextCard.teach.passedAt,
      lastVerdict: verdict,
    };
  }

  const historyEntry = {
    id: formula.id,
    mode,
    q: quality,
    verdict,
    explanation: explanation || "",
    ts: now,
    ...details,
  };

  const nextProgress = {
    ...prev,
    cardData: {
      ...prev.cardData,
      [formula.id]: nextCard,
    },
    gradeHistory: [...prev.gradeHistory, historyEntry],
    updatedAt: now,
    dirty: true,
  };

  return {
    progress: nextProgress,
    quality,
    masteredNow: !masteredBefore && isMastered(nextCard),
    card: nextCard,
  };
}

export function getWeakSpots(formulas, gradeHistory) {
  const formulaMap = formulas.reduce((acc, formula) => {
    acc[formula.id] = formula;
    return acc;
  }, {});

  const scores = {};

  gradeHistory.forEach(entry => {
    if (!scores[entry.id]) {
      scores[entry.id] = {
        total: 0,
        count: 0,
        misses: 0,
        write: { total: 0, count: 0 },
        solve: { total: 0, count: 0 },
        teach: { total: 0, count: 0 },
      };
    }

    const bucket = scores[entry.id];
    bucket.total += entry.q || 0;
    bucket.count += 1;

    if ((entry.q || 0) < 3) bucket.misses += 1;

    if (bucket[entry.mode]) {
      bucket[entry.mode].total += entry.q || 0;
      bucket[entry.mode].count += 1;
    }
  });

  return Object.entries(scores)
    .map(([id, stats]) => {
      const formula = formulaMap[id];
      if (!formula) return null;
      return {
        id,
        formula,
        avg: stats.count ? stats.total / stats.count : 0,
        misses: stats.misses,
        writeAvg: stats.write.count ? stats.write.total / stats.write.count : 0,
        solveAvg: stats.solve.count ? stats.solve.total / stats.solve.count : 0,
        teachAvg: stats.teach.count ? stats.teach.total / stats.teach.count : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aScore = a.avg * 10 - a.misses * 4;
      const bScore = b.avg * 10 - b.misses * 4;
      return aScore - bScore;
    })
    .slice(0, 12);
}

// ─── Exam awareness ─────────────────────────────────────────────────────────
// The queue used to be exam-blind: a chapter-9 card that was due outranked a
// chapter-4 card never touched with Exam 1 (Ch 1–5) two weeks out. Inside the
// prep window, cards in the next exam's chapters get a boost that grows as the
// date nears, and out-of-scope cards step back.
export const EXAM_PREP_DAYS = 21;

/** Chapter numbers an exam covers: explicit `chapters`, else parsed from the label ("Exam 1 (Ch 1–5)"); null = comprehensive. */
export function examChapters(exam) {
  if (!exam) return null;
  if (Array.isArray(exam.chapters) && exam.chapters.length) return exam.chapters.map(Number);
  const label = `${exam.label || ""}`;
  const range = label.match(/ch(?:apters?)?\.?\s*(\d+)\s*(?:-|–|—|to)\s*(\d+)/i);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    const out = [];
    for (let n = Math.min(a, b); n <= Math.max(a, b); n += 1) out.push(n);
    return out;
  }
  const single = label.match(/ch(?:apters?)?\.?\s*(\d+)\b/i);
  return single ? [Number(single[1])] : null;
}

/** The soonest exam still ahead, with `days` and resolved `chapters`. */
export function nextExam(exams, now = Date.now()) {
  const upcoming = (exams || [])
    .map(exam => ({ ...exam, days: Math.ceil((new Date(exam.date).getTime() - now) / DAY_MS) }))
    .filter(exam => Number.isFinite(exam.days) && exam.days > 0)
    .sort((a, b) => a.days - b.days);
  return upcoming[0] ? { ...upcoming[0], chapters: examChapters(upcoming[0]) } : null;
}

export function inExamScope(formula, exam) {
  return Boolean(exam) && (!exam.chapters || exam.chapters.includes(formula.ch));
}

/**
 * Score delta for a card given the next exam: 0 outside the prep window.
 * Sized against the +100 a due card gets: inside the window an unmastered
 * in-scope card must outrank a due out-of-scope one, and the gap widens as
 * the date nears. Mastered in-scope cards get a nudge, not a shove.
 */
export function examBoost(formula, exam, card = null) {
  if (!exam || !(exam.days > 0) || exam.days > EXAM_PREP_DAYS) return 0;
  const urgency = (EXAM_PREP_DAYS - exam.days) * 4; // 0 at 21 days → 80 the day before
  if (!inExamScope(formula, exam)) return -40 - urgency;
  return card && isMastered(card) ? 40 : 120 + urgency;
}

/**
 * Where Leo stands for the next exam. `troubleSpots` are the chat-tagged
 * issues ({formulaId, chapter, topic, count, ...}); only those in scope count.
 */
export function examReadiness(formulas, cardData, gradeHistory, exam, troubleSpots = [], chapters = []) {
  if (!exam) return null;
  const scope = formulas.filter(formula => inExamScope(formula, exam));
  const scopeIds = new Set(scope.map(formula => formula.id));
  let mastered = 0;
  let started = 0;
  let untouched = 0;
  for (const formula of scope) {
    const card = ensureCardState(cardData[formula.id]);
    if (isMastered(card)) mastered += 1;
    else if ((card.write.attempts || 0) + (card.solve.attempts || 0) + (card.teach.attempts || 0) > 0) started += 1;
    else untouched += 1;
  }
  const weak = getWeakSpots(scope, gradeHistory).filter(item => item.avg < 3.5 || item.misses >= 2);
  const trouble = (troubleSpots || []).filter(spot =>
    spot.formulaId ? scopeIds.has(spot.formulaId) : Boolean(spot.chapter && exam.chapters?.includes(spot.chapter)),
  );
  const remaining = scope.length - mastered;
  const workDays = Math.max(1, exam.days - 1); // the day before is review, not new material
  const byChapter = (exam.chapters || [...new Set(scope.map(formula => formula.ch))]).map(n => {
    const inChapter = scope.filter(formula => formula.ch === n);
    return {
      n,
      name: chapters.find(chapter => chapter.n === n)?.name || `Chapter ${n}`,
      total: inChapter.length,
      mastered: inChapter.filter(formula => isMastered(cardData[formula.id])).length,
    };
  });
  return {
    label: exam.label,
    date: exam.date,
    days: exam.days,
    chapters: exam.chapters,
    total: scope.length,
    mastered,
    started,
    untouched,
    remaining,
    pct: scope.length ? Math.round((mastered / scope.length) * 100) : 0,
    perDay: remaining > 0 ? Math.ceil(remaining / workDays) : 0,
    weak: weak.slice(0, 5),
    trouble: trouble.slice(0, 5),
    byChapter,
  };
}

export function buildQueue(formulas, chapter, cardData, gradeHistory, online = true, options = {}) {
  const historyById = gradeHistory.reduce((acc, entry) => {
    if (!acc[entry.id]) {
      acc[entry.id] = {
        total: 0,
        count: 0,
        misses: 0,
      };
    }
    acc[entry.id].total += entry.q || 0;
    acc[entry.id].count += 1;
    if ((entry.q || 0) < 3) acc[entry.id].misses += 1;
    return acc;
  }, {});

  return formulas
    .filter(formula => !chapter || formula.ch === chapter)
    .map(formula => {
      const card = ensureCardState(cardData[formula.id]);
      const history = historyById[formula.id] || { total: 0, count: 0, misses: 0 };
      const due = !card.nextReview || card.nextReview <= Date.now();
      const avg = history.count ? history.total / history.count : 2.5;
      const mode = getReviewMode(card, online);
      let score = 0;

      if (due) score += 100;
      if (!card.write.passedAt) score += 80;
      else if (!card.solve.passedAt) score += 60;
      else if (!card.teach.passedAt) score += 45;
      if (!isMastered(card)) score += 20;

      score += (5 - avg) * 18;
      score += history.misses * 10;
      score += examBoost(formula, options.exam, card);
      if (options.troubleIds?.has(formula.id)) score += 30; // chat-tagged trouble spot

      if (!due && card.nextReview) {
        const daysLeft = Math.max(1, Math.ceil((card.nextReview - Date.now()) / DAY_MS));
        score -= daysLeft * 2;
      }

      return {
        formula,
        card,
        mode,
        due,
        avg,
        misses: history.misses,
        score,
        examScope: inExamScope(formula, options.exam),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function normalizeFormulaText(value) {
  let next = `${value || ""}`.trim().toLowerCase();
  if (!next) return "";

  next = replaceMappedChars(next, SYMBOL_MAP);
  next = replaceMappedChars(next, SUBSCRIPT_MAP);
  next = replaceMappedChars(next, SUPERSCRIPT_MAP);
  next = next.normalize("NFKD");
  next = next.replace(/\bdelta\b/g, "d");
  next = next.replace(/\btheta\b/g, "t");
  next = next.replace(/\bpi\b/g, "p");
  next = next.replace(/\blambda\b/g, "lambda");
  next = next.replace(/\bnu\b/g, "nu");
  next = next.replace(/\bchi\b/g, "chi");
  next = next.replace(/\bomega\b/g, "w");
  next = next.replace(/\balpha\b/g, "a");
  next = next.replace(/\btau\b/g, "tau");
  next = next.replace(/\bmu\b/g, "u");
  next = next.replace(/\brho\b/g, "r");
  next = next.replace(/\bphi\b/g, "f");
  next = next.replace(/degrees?/g, "deg");
  next = next.replace(/[^a-z0-9=+\-*/().<>]/g, "");
  return next;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    rows[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const current = rows[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[j] = Math.min(
        rows[j] + 1,
        rows[j - 1] + 1,
        prev + cost,
      );
      prev = current;
    }
  }

  return rows[b.length];
}

export function similarityScore(a, b) {
  const left = normalizeFormulaText(a);
  const right = normalizeFormulaText(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

export function localRecallAssessment(answer, correctFormula) {
  const normalizedAnswer = normalizeFormulaText(answer);
  const normalizedCorrect = normalizeFormulaText(correctFormula);

  if (!normalizedAnswer) {
    return {
      verdict: "INCORRECT",
      explanation: "No answer entered.",
      needsAi: false,
    };
  }

  if (normalizedAnswer === normalizedCorrect) {
    return {
      verdict: "CORRECT",
      explanation: "Matched after normalization.",
      needsAi: false,
    };
  }

  const similarity = similarityScore(answer, correctFormula);

  if (
    similarity >= 0.7 ||
    normalizedAnswer.includes(normalizedCorrect) ||
    normalizedCorrect.includes(normalizedAnswer)
  ) {
    return {
      verdict: "PARTIAL",
      explanation: "Close enough for an AI check.",
      needsAi: true,
    };
  }

  return {
    verdict: "INCORRECT",
    explanation: "Key symbols or structure are missing.",
    needsAi: false,
  };
}
