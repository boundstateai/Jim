import { randomUUID } from "node:crypto";

export const RATE_CENTS = 1000;
export const WEEK_CAP_MS = 5 * 60 * 60 * 1000;
export const LEASE_MS = 30000;
export const MAX_TICK_MS = 15000;
export const TIME_ZONE = "America/Chicago";
const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function dayKey(now) {
  const p = Object.fromEntries(calendar.formatToParts(now).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function weekKey(now) {
  const day = new Date(`${dayKey(now)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function earnedCents(ms) { return Math.floor(Math.min(ms, WEEK_CAP_MS) * RATE_CENTS / 3600000); }
export function emptyRewards() { return { days: {}, weeks: {}, session: null }; }

// Split confirmed time at local midnight, including DST and Monday rollover.
export function addTime(state, from, to) {
  while (from < to) {
    const day = dayKey(from), week = weekKey(from);
    let end = to;
    if (dayKey(to - 1) !== day) {
      let lo = from, hi = to;
      while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (dayKey(mid) === day) lo = mid; else hi = mid; }
      end = hi;
    }
    const ms = end - from;
    state.days[day] = (state.days[day] || 0) + ms;
    const bucket = state.weeks[week] ||= { ms: 0, approvedCents: 0, approvals: [] };
    bucket.ms += ms;
    from = end;
  }
}

// Called while holding the learner's database row lock. Only server time counts.
export function transition(state, body, now, newId = randomUUID) {
  const expired = !state.session || now - state.session.lastAt > LEASE_MS;
  if (expired) state.session = null;
  if (body.action === "start") {
    if (state.session) return { status: 409, error: "A timer is already running. Pause it on the other tab or device, or wait 30 seconds after closing it." };
    state.session = { id: newId(), lastAt: now, seq: 0 };
    return { sessionId: state.session.id };
  }
  if (body.action === "tick" || body.action === "stop") {
    const session = state.session;
    if (!session || session.id !== body.sessionId) return { status: 409, error: "This study session has paused. Start again to continue." };
    if (!Number.isSafeInteger(body.seq) || body.seq < 1) return { status: 400, error: "Invalid timer update." };
    // Retries and out-of-order requests cannot double-credit time.
    if (body.seq <= session.seq) return {};
    const end = Math.max(now, session.lastAt);
    addTime(state, session.lastAt, Math.min(end, session.lastAt + MAX_TICK_MS));
    session.lastAt = end;
    session.seq = body.seq;
    if (body.action === "stop") state.session = null;
    return {};
  }
  if (body.action === "approve") {
    const bucket = state.weeks[body.week];
    const pending = bucket ? earnedCents(bucket.ms) - bucket.approvedCents : 0;
    if (pending <= 0 || pending !== body.cents) return { status: 409, error: "The amount changed or was already approved. Refresh and review it again." };
    bucket.approvedCents += pending;
    bucket.approvals.push({ cents: pending, at: now });
    return { approvedCents: pending };
  }
  if (body.action !== "read") return { status: 400, error: "Unknown study action." };
  return {};
}

export function summary(state, now) {
  const currentWeek = weekKey(now);
  const weeks = Object.entries(state.weeks).map(([week, b]) => ({ week, ms: b.ms, earnedCents: earnedCents(b.ms), approvedCents: b.approvedCents, pendingCents: earnedCents(b.ms) - b.approvedCents, approvals: b.approvals }));
  if (!state.weeks[currentWeek]) weeks.push({ week: currentWeek, ms: 0, earnedCents: 0, approvedCents: 0, pendingCents: 0, approvals: [] });
  weeks.sort((a, b) => b.week.localeCompare(a.week));
  return { serverNow: now, todayMs: state.days[dayKey(now)] || 0, currentWeek, weeks, rateCents: RATE_CENTS, weekCapMs: WEEK_CAP_MS, timeZone: TIME_ZONE, active: Boolean(state.session && now - state.session.lastAt <= LEASE_MS) };
}
