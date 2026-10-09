import React, { useState } from "react";
import { placementQuestions, checkPlacement, placementStart, validPlacement } from "./calculusReadiness.js";
import { isMastered } from "./engine.js";
import "./mathLab.css";
import { CalculusExplorers } from "./CalculusExplorers.jsx";
import { courseSources } from "./packs/uahCalculus.js";

const placementKey = "uah-ma171-v1-placement";
function readPlacement() {
  try { const value = JSON.parse(localStorage.getItem(placementKey)); return validPlacement(value) ? value : null; }
  catch { return null; }
}

export function MathLab({ chapters, formulas, cardData, onStudy, onAsk }) {
  const [placement, setPlacement] = useState(readPlacement);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState("");

  const start = placement ? placementStart(placement) : 1;
  const focus = chapters.find(ch => ch.n >= start && formulas.some(f => f.ch === ch.n && !isMastered(cardData[f.id]))) || chapters[11];
  const q = placementQuestions[results.length];
  function submit(skip = false) {
    if (!skip && !answer.trim()) { setError("Enter a number or fraction, or choose Not sure yet."); return; }
    const passed = !skip && checkPlacement(q, answer);
    setFeedback({ passed, explanation: q.explanation });
    setError("");
  }
  function next() {
    const updated = [...results, feedback.passed];
    setResults(updated); setAnswer(""); setFeedback(null);
    if (updated.length === placementQuestions.length) {
      setPlacement(updated); setRunning(false);
      try { localStorage.setItem(placementKey, JSON.stringify(updated)); }
      catch { setError("Starting check could not be saved on this device. Your result is available until you leave."); }
    }
  }
  return <section className="math-panel" aria-label="Your learning path">
    <div className="math-eyebrow">CALCULUS, ONE IDEA AT A TIME</div>
    <h2>Your next step: {focus.name}</h2>
    <p>Try 15–20 minutes: study an example, solve a new problem, then explain why it works. Bring older skills back into each session.</p>
    <div className="math-actions">
      <button onClick={() => onStudy(focus.n)}>Practice {focus.name}</button>
      <button className="math-secondary" onClick={() => {setRunning(true);setResults([]);setFeedback(null);setAnswer("");setError("");}}>{placement ? "Retake starting check" : "Find my starting point"}</button>
    </div>
    {placement && <p className="math-note">Starting check: {placement.filter(Boolean).length}/12. Suggested start: {chapters[start-1].name}. This small sample suggests a starting point; it does not establish mastery. Saved on this device.</p>}
    {running && <div className="math-check">
      <div className="math-eyebrow">STARTING CHECK · {results.length+1} / 12</div>
      <h3>{q.prompt}</h3>
      <p>Try without a calculator. “Not sure yet” is useful information.</p>
      <form onSubmit={e => {e.preventDefault();if (!feedback) submit();}}>
        <label htmlFor="placement-answer">Your answer</label>
        <input id="placement-answer" value={answer} onChange={e=>setAnswer(e.target.value)} autoComplete="off" disabled={Boolean(feedback)} />
        {!feedback && <div className="math-actions"><button type="submit">Check answer</button><button type="button" className="math-secondary" onClick={()=>submit(true)}>Not sure yet</button></div>}
      </form>
      {feedback && <div role="status"><p>{feedback.passed ? "Correct." : "Let's review this skill."} {feedback.explanation}</p><button onClick={next}>{results.length===11 ? "See my starting point" : "Next question"}</button></div>}
      <button className="math-text-button" onClick={()=>setRunning(false)}>Close starting check</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    <CalculusExplorers />
    <div className="math-actions"><button className="math-secondary" onClick={()=>onAsk("Give me a mixed MA 171 problem using a skill I have studied. Do not name the method first. Wait for my attempt.")}>Mixed practice with Coach</button></div>
    <p className="math-note">Independent study support for UAH MA 171. The starting check suggests review; it does not award mastery. Your instructor’s syllabus, textbook and exam schedule have not been supplied.</p>
    <details><summary>Course scope and references</summary><p>Original lessons and examples. The historical UAH topic summary supports the broad scope; unit order and optional extensions are our study sequence, not your class schedule.</p><ul>{courseSources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}</ul></details>
  </section>;
}
