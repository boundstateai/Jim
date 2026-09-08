import test from "node:test";
import assert from "node:assert/strict";
import { placementQuestions, checkPlacement, numericAnswer, placementStart, validPlacement } from "./mathReadiness.js";
import { jimMathPack } from "./packs/jimMath.js";

test("starting check accepts equivalent fractions and rounded decimals, rejects malformed answers", () => {
  assert.equal(checkPlacement(placementQuestions[0], "22 / 24"), true);
  assert.equal(checkPlacement(placementQuestions[0], "0.9167"), true);
  assert.equal(checkPlacement(placementQuestions[0], "4/10"), false);
  for (const input of ["", "1/0", "Infinity", "3junk", "1+1", "process.exit()", "0/0", "3/4/5"]) assert.equal(Number.isNaN(numericAnswer(input)), true, input);
  assert.equal(numericAnswer("−1"), -1);
});
test("placement recommends earliest gap without awarding skill passes", () => {
  assert.equal(placementStart([]), 1);
  assert.equal(placementStart([true, true, false]), 3);
  assert.equal(placementStart(Array(12).fill(true)), 12);
  assert.equal(validPlacement(Array(12).fill(true)), true);
  assert.equal(validPlacement([true]), false);
  assert.equal(validPlacement(Array(12).fill("true")), false);
});
test("all curriculum skills have unique progress keys, units, and learning material", () => {
  const keys = jimMathPack.formulas.map(x => x.id);
  assert.equal(new Set(keys).size, 48);
  assert.equal(jimMathPack.rewardsEnabled, false);
  for (const f of jimMathPack.formulas) {
    assert.ok(jimMathPack.chapters.some(ch => ch.n === f.ch));
    for (const key of ["name", "formula", "meaning", "example", "mathTip"]) assert.ok(f[key]?.trim());
    assert.match(f.id, /^jm-/);
  }
});
