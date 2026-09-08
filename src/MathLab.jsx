import React, { useState } from "react";
import { placementQuestions, checkPlacement, placementStart, validPlacement } from "./mathReadiness.js";
import { isMastered } from "./engine.js";
import "./mathLab.css";

const placementKey = "jim-math-v1-placement";
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
  const [lab, setLab] = useState(null);
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
    <div className="math-eyebrow">BUILD THE FOUNDATION</div>
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
    <div className="math-actions math-lab-tabs">
      <button aria-pressed={lab==="graph"} className="math-secondary" onClick={()=>setLab(lab==="graph"?null:"graph")}>Explore a graph</button>
      <button aria-pressed={lab==="circle"} className="math-secondary" onClick={()=>setLab(lab==="circle"?null:"circle")}>Explore the unit circle</button>
      <button className="math-secondary" onClick={()=>onAsk("Give me a mixed practice problem using skills I have already studied. Do not name the formula. Wait for my attempt before giving a hint or solution.")}>Mixed practice with Coach</button>
    </div>
    {lab==="graph" && <GraphLab />}
    {lab==="circle" && <CircleLab />}
  </section>;
}

function Slider({label,value,min,max,step=1,onChange}) {
  return <label className="math-slider">{label}: <output>{value}</output><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function GraphLab() {
  const [m,setM]=useState(1), [b,setB]=useState(0);
  const ticks=Array.from({length:11},(_,i)=>i*40);
  return <div className="math-explorer">
    <h3>Change the equation. Watch the line.</h3>
    <p>Predict first: what will happen if you make the slope negative?</p>
    <Slider label="Slope m" min={-3} max={3} step={0.25} value={m} onChange={setM}/>
    <Slider label="Intercept b" min={-5} max={5} value={b} onChange={setB}/>
    <svg viewBox="0 0 400 400" role="img" aria-label={`Graph of y = ${m}x + ${b}; axes range from -5 to 5`}>
      <defs><clipPath id="math-graph-clip"><rect width="400" height="400"/></clipPath></defs>
      {ticks.map(t=><g key={t} stroke="#303d53"><path d={`M ${t} 0 V400 M0 ${t} H400`}/></g>)}
      <path d="M0 200 H400 M200 0 V400" stroke="#94a3b8"/>
      <g fill="#b9c5d8" fontSize="13"><text x="382" y="192">x</text><text x="210" y="16">y</text><text x="4" y="216">-5</text><text x="384" y="216">5</text><text x="181" y="17">5</text><text x="174" y="395">-5</text></g>
      <line clipPath="url(#math-graph-clip)" x1="0" y1={200-40*(m*(-5)+b)} x2="400" y2={200-40*(m*5+b)} stroke="#73a6ff" strokeWidth="4"/>
      <circle cx="200" cy={200-40*b} r="5" fill="#34d399"/>
    </svg>
    <p aria-live="polite">y = {m}x {b<0 ? "−" : "+"} {Math.abs(b)}. Every 1 step right changes y by {m}. The line crosses the y-axis at {b}.</p>
  </div>;
}
function CircleLab() {
  const [deg,setDeg]=useState(30);
  const rad=deg*Math.PI/180, c=Math.cos(rad), s=Math.sin(rad);
  const x=200+140*c,y=200-140*s;
  const tidy=n=>Math.abs(n)<1e-10?"0":n.toFixed(3);
  return <div className="math-explorer">
    <h3>One angle, two coordinates.</h3>
    <p>Predict the signs of sine and cosine before moving into a new quadrant.</p>
    <Slider label="Angle in degrees" min={0} max={360} value={deg} onChange={setDeg}/>
    <svg viewBox="0 0 400 400" role="img" aria-label={`Unit circle at ${deg} degrees. Cosine ${tidy(c)} and sine ${tidy(s)}.`}>
      <path d="M30 200 H370 M200 30 V370" stroke="#64748b"/>
      <circle cx="200" cy="200" r="140" fill="none" stroke="#64748b" strokeWidth="2"/>
      <path d={`M200 200 L${x} 200 L${x} ${y} Z`} fill="#4f8cff22" stroke="#73a6ff" strokeWidth="3"/>
      <line x1="200" y1="200" x2={x} y2="200" stroke="#34d399" strokeWidth="4"/>
      <circle cx={x} cy={y} r="6" fill="#f5a623"/>
      <g fill="#b9c5d8" fontSize="14"><text x="348" y="221">(1,0)</text><text x="203" y="47">(0,1)</text><text x="7" y="221">(-1,0)</text><text x="204" y="359">(0,-1)</text></g>
    </svg>
    <p aria-live="polite">{deg}° = {(deg/180).toFixed(3)}π radians ≈ {rad.toFixed(3)} radians.<br/>cos θ = {tidy(c)} · sin θ = {tidy(s)} · tan θ = {Math.abs(c)<1e-10 ? "undefined" : tidy(s/c)}</p>
    <p className="math-note">Cosine is x. Sine is y. Tangent is y/x, so it is undefined when x = 0. Displayed decimals are rounded.</p>
  </div>;
}
