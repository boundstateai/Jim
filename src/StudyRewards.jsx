import { sessionFetch } from "./sessionClient.js";
import { useEffect, useRef, useState } from "react";
import { apiHeaders } from "./apiAuth";
import { duration, IDLE_MS, pauseReason } from "./studyActivity";
import "./studyRewards.css";

const money = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const weekLabel = week => new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function StudyRewards() {
  const [data, setData] = useState(null), [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0), [idleWarning, setIdleWarning] = useState(false);
  const [parentOpen, setParentOpen] = useState(false), [code, setCode] = useState("");
  const session = useRef(null), seq = useRef(0), active = useRef(false);
  const lastActivity = useRef(0), started = useRef(0), lastBeat = useRef(0);
  const chain = useRef(Promise.resolve()), mounted = useRef(false);

  function receive(result) {
    if (mounted.current && result.summary) setData(previous => !previous || result.summary.serverNow >= previous.summary.serverNow ? result : previous);
  }
  async function request(body, keepalive = false) {
    const response = await sessionFetch("/api/study", { method: body ? "POST" : "GET", headers: apiHeaders({ "Content-Type": "application/json" }), ...(body ? { body: JSON.stringify(body) } : {}), keepalive, signal: AbortSignal.timeout(12000) });
    const result = await response.json();
    receive(result);
    if (!response.ok) throw new Error(result.error || "Could not save study time.");
    return result;
  }
  function enqueue(body, keepalive = false) {
    const task = chain.current.then(() => {
      if (body?.action === "tick" && (!active.current || session.current !== body.sessionId)) return {};
      return request(body, keepalive);
    });
    chain.current = task.catch(() => {});
    return task;
  }
  function halt(reason) {
    active.current = false;
    if (mounted.current) { setRunning(false); setIdleWarning(false); setMessage(reason); }
  }
  function pause(reason = "Paused. Your confirmed time is saved.") {
    if (!active.current) return;
    const id = session.current;
    session.current = null;
    halt(reason);
    enqueue({ action: "stop", sessionId: id, seq: ++seq.current }, true).catch(() => {
      if (mounted.current && !active.current) setMessage(`${reason} The final update didn’t save; only previously confirmed time is banked.`);
    });
  }
  async function start() {
    if (busy || active.current) return;
    setBusy(true); setMessage("");
    try {
      const result = await enqueue({ action: "start" });
      session.current = result.sessionId; seq.current = 0;
      started.current = lastActivity.current = lastBeat.current = performance.now();
      active.current = true; setRunning(true); setElapsed(0);
      if (document.hidden || !document.hasFocus() || !navigator.onLine) pause("Paused while you were away from the app.");
    } catch (error) { halt(error.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setMessage("");
    try { await enqueue(); } catch { setMessage("Could not load saved time. Check your connection and refresh."); }
    finally { if (mounted.current) setBusy(false); }
  }

  useEffect(() => {
    mounted.current = true;
    enqueue().catch(() => { if (mounted.current) setMessage("Could not load saved time. Check your connection and refresh."); });
    const activity = e => { if (e.isTrusted && active.current) lastActivity.current = performance.now(); };
    const away = () => { if (document.hidden || !document.hasFocus()) pause(); };
    const blur = () => pause("Paused while you were away from the app.");
    const offline = () => pause("Connection lost. Reconnect, then resume.");
    const events = ["pointerdown", "keydown", "input", "scroll"];
    events.forEach(event => document.addEventListener(event, activity, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", away);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", blur);
    window.addEventListener("offline", offline);
    const interval = setInterval(() => {
      if (!active.current) return;
      const now = performance.now();
      const reason = pauseReason({ now, lastActivity: lastActivity.current, visible: !document.hidden, focused: document.hasFocus(), online: navigator.onLine });
      if (reason) { pause(reason); return; }
      setElapsed(now - started.current);
      setIdleWarning(now - lastActivity.current >= IDLE_MS - 30000);
      if (now - lastBeat.current >= 10000) {
        lastBeat.current = now;
        const id = session.current;
        enqueue({ action: "tick", sessionId: id, seq: ++seq.current }).catch(error => {
          // A later start must not be stopped by an older request failing.
          if (session.current === id) { session.current = null; halt(error.message); }
        });
      }
    }, 1000);
    return () => {
      pause(); mounted.current = false;
      clearInterval(interval);
      events.forEach(event => document.removeEventListener(event, activity, true));
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", blur);
      window.removeEventListener("offline", offline);
    };
  }, []);

  async function approve(week) {
    if (busy || !code.trim()) return;
    setBusy(true); setMessage("");
    try {
      await enqueue({ action: "approve", week: week.week, cents: week.pendingCents, code: code.trim() });
      setMessage(`${money(week.pendingCents)} approved for the week of ${weekLabel(week.week)}. Pay Jim separately; no money was transferred.`);
      setCode("");
    } catch (error) { setMessage(error.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  const current = data?.summary.weeks.find(w => w.week === data.summary.currentWeek);
  return <aside className="study-rewards" aria-label="Study time and earnings">
    <div className="study-rewards-heading"><span className="study-rewards-label">MAKE TIME FOR MATH</span><span className={`study-state ${running ? "is-running" : ""}`}>{running ? "Studying" : "Paused"}</span></div>
    <div className="study-rewards-stats">
      <div><span>Saved today</span><strong>{data ? duration(data.summary.todayMs) : "—"}</strong><small>minutes : seconds</small></div>
      <div><span>Earned this week</span><strong>{current ? money(current.earnedCents) : "—"}</strong><small>of $50 · $10 / hour</small></div>
    </div>
    <progress aria-label="Weekly paid study time" max={18000000} value={Math.min(current?.ms || 0, 18000000)} />
    <p className="study-rules">30 minutes = $5. Effort counts, including mistakes. Paid time resets Monday, Central time.</p>
    {current?.ms >= 18000000 && <p className="study-notice">You’ve reached this week’s $50 limit. Keep studying if you like; more time won’t add earnings until Monday.</p>}
    <div className="study-controls">
      <button type="button" disabled={busy || !data || parentOpen} onClick={() => running ? pause() : start()}>{running ? "Pause study timer" : "Start study timer"}</button>
      <span role="timer" aria-label="Current study session">{duration(elapsed)}</span>
      <button className="study-link" type="button" disabled={busy || running} onClick={refresh}>Refresh</button>
    </div>
    <p className="study-rules">Pauses when you leave the app or after 2 minutes without activity. Saved every 10 seconds while connected.</p>
    {idleWarning && <div className="study-notice" role="status">Still working on paper? The timer will pause soon. <button type="button" onClick={() => { lastActivity.current = performance.now(); setIdleWarning(false); }}>I’m still studying</button></div>}
    {message && <p className="study-message" role="status">{message}</p>}
    <button className="study-link" type="button" aria-expanded={parentOpen} onClick={() => { if (!parentOpen) pause("Paused for parent review."); setParentOpen(!parentOpen); setCode(""); }}>Parent payout review</button>
    {parentOpen && <section className="study-parent" aria-label="Parent payout review">
      <h2>Review the week together</h2>
      <p>Ask Jim to show you something he figured out. Approving records the amount you agree to pay; it does not send money.</p>
      {!data?.parentConfigured && <p role="status">Parent approval is not configured yet.</p>}
      <label htmlFor="study-parent-code">Parent approval code</label>
      <input id="study-parent-code" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} placeholder="Parent only" />
      <div className="study-week-list">{data?.summary.weeks.map(week => <div className="study-week" key={week.week}>
        <h3>Week of {weekLabel(week.week)}</h3>
        <p>{duration(week.ms)} studied · {money(week.earnedCents)} earned<br/>{money(week.approvedCents)} approved · {money(week.pendingCents)} awaiting approval</p>
        {week.pendingCents > 0 && <button type="button" disabled={busy || !code.trim() || !data.parentConfigured} onClick={() => approve(week)}>Approve {money(week.pendingCents)}</button>}
        {week.approvals.map((a, i) => <small key={i}>{money(a.cents)} approved {new Date(a.at).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT</small>)}
      </div>)}</div>
    </section>}
  </aside>;
}
