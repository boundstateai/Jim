import test from "node:test";
import assert from "node:assert/strict";
import {quadraticSlopes,squareRiemann} from "./calculusModels.js";
test("secants agree with direct quotients on both sides and converge to the tangent",()=>{
  for(const a of [-1,0,0.75,1]) for(const h of [-1,-0.5,-0.1,0.01,1]) {
    const model=quadraticSlopes(a,h);
    assert.ok(Math.abs(model.secant-(((a+h)**2-a*a)/h))<1e-10);
    assert.equal(model.tangent,2*a);
    assert.ok(Math.abs(model.secant-model.tangent-h)<1e-10);
  }
  for(const h of [0,NaN,Infinity]) assert.throws(()=>quadraticSlopes(1,h),RangeError);
});
test("right sums match independent closed form, overestimate and converge",()=>{
  let previous=Infinity;
  for(const n of [2,4,8,16,32,64]) {
    const result=squareRiemann(n);
    const closed=4*(n+1)*(2*n+1)/(3*n*n);
    assert.ok(Math.abs(result.sum-closed)<1e-12);
    assert.ok(result.sum>8/3 && result.sum<previous);
    assert.equal(result.rectangles.length,n);
    assert.ok(Math.abs(result.rectangles.reduce((s,r)=>s+r.width,0)-2)<1e-12);
    previous=result.sum;
  }
  for(const n of [0,-1,1.2,1001,NaN]) assert.throws(()=>squareRiemann(n),RangeError);
});
