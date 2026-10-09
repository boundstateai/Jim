import test from "node:test";
import assert from "node:assert/strict";
import {uahCalculusPack as pack} from "./uahCalculus.js";
import {jimMathPack} from "./jimMath.js";
test("complete calculus pack has stable unique keys and no inherited progress or schedule",()=>{
  assert.equal(pack.chapters.length,12);
  assert.equal(pack.formulas.length,48);
  assert.equal(new Set(pack.formulas.map(f=>f.id)).size,48);
  assert.notEqual(pack.id,jimMathPack.id);
  assert.notEqual(pack.storageKey,jimMathPack.storageKey);
  assert.equal(pack.legacyKey,null);
  assert.deepEqual(pack.exams,[]);
  assert.equal(pack.rewardsEnabled,false);
  for(const ch of pack.chapters) assert.equal(pack.formulas.filter(f=>f.ch===ch.n).length,4);
  for(const f of pack.formulas) {
    assert.match(f.id,/^ma171-/);
    for(const key of ["formula","meaning","example","mathTip"]) assert.ok(f[key]?.trim(),f.id);
  }
  assert.match(pack.tutor.scheduleNote,/Never invent/);
});
test("course covers the requested scope and states key mathematical conditions",()=>{
  const byId=Object.fromEntries(pack.formulas.map(f=>[f.id,f]));
  for(const id of ["limits","chain","implicit","related-rates","optimization","antiderivatives","ftc-evaluate","substitution","log-derivatives","inverse-trig"]) assert.ok(byId["ma171-"+id]);
  assert.match(byId["ma171-mvt"].meaning,/continuity.*differentiability/);
  assert.match(byId["ma171-antiderivatives"].formula,/n≠−1/);
  assert.match(byId["ma171-radians"].meaning,/radians/);
  assert.match(byId["ma171-signed-area"].example,/integral|∫/);
});
