// Half-open millisecond ranges. Union makes retries, tabs and devices idempotent.
export const IDLE_MS = 90_000;
export const STUDY_ZONE = 'America/Chicago';
export function unionRanges(...groups) {
  const sorted = groups.flat().filter(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[1] > r[0]).map(r => [...r]).sort((a,b) => a[0]-b[0]);
  const out = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}
export function subtractRanges(current, saved) {
  let out = unionRanges(current);
  for (const [s,e] of unionRanges(saved)) out = out.flatMap(([a,b]) => b <= s || a >= e ? [[a,b]] : [...(a < s ? [[a,s]] : []), ...(b > e ? [[e,b]] : [])]);
  return out;
}
export function activeSlice(previous, now, lastInput, eligible) {
  // A delayed timer after sleep is not evidence of active use.
  if (!eligible || now <= previous || now - previous > 15_000) return [];
  const end = Math.min(now, lastInput + IDLE_MS);
  return end > previous ? [[previous, end]] : [];
}
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone: STUDY_ZONE, year:'numeric', month:'2-digit', day:'2-digit'});
export const studyDay = ms => dayFormat.format(new Date(ms));
export function dailyTotals(ranges) {
  const days = {};
  for (const [start,end] of unionRanges(ranges)) {
    // Chicago midnight always falls on a UTC hour boundary, including DST.
    for (let at=start; at<end;) {
      const next = Math.min(end, (Math.floor(at/3_600_000)+1)*3_600_000);
      const day = studyDay(at);
      days[day] = (days[day] || 0) + next-at;
      at=next;
    }
  }
  return days;
}
export function duration(ms=0) {
  const seconds = Math.floor(ms/1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds/60);
  return minutes < 60 ? `${minutes}m ${seconds%60}s` : `${Math.floor(minutes/60)}h ${minutes%60}m`;
}

