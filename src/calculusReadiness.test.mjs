import test from "node:test";
import assert from "node:assert/strict";
import {placementQuestions,checkPlacement,placementStart,validPlacement} from "./calculusReadiness.js";
test("MA 171 diagnostic golden answers reject common calculus mistakes",()=>{
  const answers=["3","-1","4","2","6","24","1","-3/4","12","4","7","9"];
  const mistakes=["0","1","0","0","9","8","0","3/4","6","0","4","6"];
  placementQuestions.forEach((q,i)=>{
    assert.equal(checkPlacement(q,answers[i]),true,q.prompt);
    assert.equal(checkPlacement(q,mistakes[i]),false,q.prompt);
    for(const bad of ["","1/0","2+2","eval(4)"]) assert.equal(checkPlacement(q,bad),false);
  });
});
test("diagnostic recommends prerequisite gaps and never declares mastery",()=>{
  assert.equal(placementStart([]),1);
  assert.equal(placementStart([true,true,false]),2);
  assert.equal(placementStart(Array(12).fill(true)),2);
  assert.equal(validPlacement(Array(12).fill(true)),true);
  assert.equal(validPlacement(Array(12).fill("true")),false);
  assert.equal(validPlacement([true]),false);
});
