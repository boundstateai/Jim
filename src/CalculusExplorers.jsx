import React, {useState} from "react";
import {quadraticSlopes,squareRiemann} from "./calculusModels.js";

/** Two bounded visual experiments; the formulas also appear as readable text. */
export function CalculusExplorers() {
  const [lab,setLab]=useState(null);
  return <>
    <div className="math-actions math-lab-tabs">
      <button className="math-secondary" aria-pressed={lab==="derivative"} onClick={()=>setLab(lab==="derivative"?null:"derivative")}>Explore a derivative</button>
      <button className="math-secondary" aria-pressed={lab==="integral"} onClick={()=>setLab(lab==="integral"?null:"integral")}>Explore an integral</button>
    </div>
    {lab==="derivative" && <DerivativeLab/>}
    {lab==="integral" && <IntegralLab/>}
  </>;
}
function DerivativeLab() {
  const [a,setA]=useState(1), [h,setH]=useState(1);
  const {secant,tangent,point,nearby}=quadraticSlopes(a,h);
  const x=v=>200+55*v, y=v=>350-30*v;
  const curve=Array.from({length:121},(_,i)=>{const t=-3+i/20;return `${i?"L":"M"}${x(t)},${y(t*t)}`;}).join(" ");
  const line=m=>`M${x(-3)},${y(point+m*(-3-a))} L${x(3)},${y(point+m*(3-a))}`;
  return <div className="math-explorer">
    <h3>From a secant to a tangent</h3>
    <p>For f(x)=x², predict what happens to the secant slope as h approaches 0 from either side.</p>
    <label className="math-slider">Point a: <output>{a}</output><input aria-label="Point a" type="range" min="-1" max="1" step="0.25" value={a} onChange={e=>setA(Number(e.target.value))}/></label>
    <label className="math-slider">Step h <select aria-label="Step h" value={h} onChange={e=>setH(Number(e.target.value))}>{[-1,-0.5,-0.1,-0.01,0.01,0.1,0.5,1].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <svg viewBox="0 0 400 400" role="img" aria-label={`Quadratic curve with secant slope ${secant} and tangent slope ${tangent}`}>
      <defs><clipPath id="calculus-slope-clip"><rect x="20" y="20" width="360" height="360"/></clipPath></defs>
      <path d="M20 350 H380 M200 20 V380" stroke="#94a3b8"/>
      <g fill="#b9c5d8" fontSize="13"><text x="382" y="345">x</text><text x="208" y="22">y</text><text x="32" y="369">−3</text><text x="359" y="369">3</text><text x="205" y="345">0</text><text x="205" y="82">9</text></g>
      <g clipPath="url(#calculus-slope-clip)" fill="none" strokeWidth="3">
        <path d={curve} stroke="#73a6ff"/><path d={line(tangent)} stroke="#34d399"/><path d={line(secant)} stroke="#f5a623" strokeDasharray="7 5"/>
        <circle cx={x(a)} cy={y(point)} r="5" fill="#34d399"/><circle cx={x(a+h)} cy={y(nearby)} r="5" fill="#f5a623"/>
      </g>
    </svg>
    <p aria-live="polite">Dashed orange secant: 2a+h = {secant.toFixed(3)}. Green tangent: 2a = {tangent.toFixed(3)}.</p>
    <p className="math-note">For h≠0, ((a+h)²−a²)/h=2a+h. Taking the limit gives f′(a)=2a. The displayed graph illustrates this algebraic result; the quotient at h=0 is undefined.</p>
  </div>;
}
function IntegralLab() {
  const [n,setN]=useState(4);
  const {rectangles,sum,exact}=squareRiemann(n);
  const x=v=>40+160*v,y=v=>350-75*v;
  const curve=Array.from({length:81},(_,i)=>{const t=i/40;return `${i?"L":"M"}${x(t)},${y(t*t)}`;}).join(" ");
  return <div className="math-explorer">
    <h3>Rectangles approach accumulated area</h3>
    <p>Predict whether right-endpoint rectangles overestimate or underestimate x² on [0,2]. Then increase their number.</p>
    <label className="math-slider">Rectangles: <output>{n}</output><input aria-label="Rectangles" type="range" min="2" max="64" step="2" value={n} onChange={e=>setN(Number(e.target.value))}/></label>
    <svg viewBox="0 0 400 400" role="img" aria-label={`Right Riemann sum for x squared from zero to two using ${n} rectangles`}>
      <path d="M40 20 V350 H380" fill="none" stroke="#94a3b8"/>
      {rectangles.map((r,i)=><rect key={i} x={x(r.left)} y={y(r.height)} width={r.width*160} height={r.height*75} fill="#4f8cff44" stroke="#73a6ff"/>)}
      <path d={curve} fill="none" stroke="#34d399" strokeWidth="3"/>
      <g fill="#b9c5d8" fontSize="13"><text x="30" y="370">0</text><text x="195" y="370">1</text><text x="356" y="370">2</text><text x="22" y="54">4</text><text x="382" y="349">x</text><text x="25" y="20">y</text></g>
    </svg>
    <p aria-live="polite">Right sum = {sum.toFixed(5)}. Exact integral = 8/3 ≈ {exact.toFixed(5)}. Overestimate = {(sum-exact).toFixed(5)}.</p>
    <p className="math-note">Each rectangle has width 2/n. Because x² is increasing here, right-endpoint heights overestimate its area. The Fundamental Theorem gives [x³/3] from 0 to 2 = 8/3.</p>
  </div>;
}
