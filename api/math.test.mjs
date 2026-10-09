import test from "node:test";
import assert from "node:assert/strict";
import { courseUserId, courseContext, jimSystemPrompt } from "./_lib/course.js";
import { formatChatDigest } from "./_lib/chatLog.js";
import { struggleAddendum } from "./_lib/chatMessages.js";
import { client } from "./_lib/openai.js";
import { pool, getProgress, listProgressHistory, getProgressHistoryEntry, putProgress, restoreProgress } from "./_lib/db.js";
import { listChat, appendChat } from "./_lib/chatLog.js";
import { issueSummary, recordIssues } from "./_lib/issues.js";
import handler from "./chat.js";

test("Jim context is server-selected and cannot inherit Leo's exams or debt", () => {
  const context = courseContext({ course: "jim-math", tutor: { studentName: "Leo" }, exams: [{ date: "2099-01-01" }], debt: 1800 });
  assert.equal(context.tutor.studentName, "Jim");
  assert.deepEqual(context.exams, []);
  assert.equal(context.debt, 0);
  assert.equal(courseUserId("physics"), "leo");
  assert.equal(courseUserId("chem"), "leo");
  assert.equal(courseUserId("jim-math"), "jim");
  assert.match(jimSystemPrompt(context), /wait for Jim's attempt/);
  assert.match(jimSystemPrompt(context), /single success is not mastery/);
});

test("Jim's report labels his own transcript and preserves Leo's default", () => {
  const messages = [{role:"user", content:"Why is it negative?", ts:1, sessionId:"a"}];
  assert.match(formatChatDigest(messages, {studentName:"Jim"}), /Jim: Why/);
  assert.match(formatChatDigest(messages), /Leo: Why/);
  const report = struggleAddendum({count:1,text:"Jim: Why?",studentName:"Jim"});
  assert.match(report, /where Jim is struggling/);
  assert.doesNotMatch(report, /Leo/);
});

test("math generation and grading reach the handler with algebra context and method-based rubric", async () => {
  const original = client.responses.create;
  const prompts = [];
  client.responses.create = async payload => {
    prompts.push(payload.input[0].content);
    return {status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({problem:"Solve x+1=3",solution:"Subtract 1: x=2",correctAnswer:"2",grade:"PARTIAL",explanation:"Show how you found x."})}]}]};
  };
  const headers = {authorization:`Bearer ${process.env.LEO_API_TOKEN || process.env.API_TOKEN || ""}`};
  const makeRes = () => ({statusCode:0,status(n){this.statusCode=n;return this;},json(body){this.body=body;}});
  try {
    const generated=makeRes();
    await handler({method:"POST",headers,body:{course:"jim-math",action:"generate_problem",formula:{name:"Linear equations",formula:"ax+b=c"}}},generated);
    assert.equal(generated.statusCode,200);
    assert.equal(generated.body.correctAnswer,"2");
    assert.match(prompts[0], /algebra and trigonometry practice problem/);
    const graded=makeRes();
    await handler({method:"POST",headers,body:{course:"jim-math",action:"grade_problem",...generated.body,studentAnswer:"2"}},graded);
    assert.equal(graded.statusCode,200);
    assert.equal(graded.body.grade,"PARTIAL");
    assert.match(prompts[1], /unsupported final answer is PARTIAL/);
    assert.match(prompts[1], /Require all roots and restrictions/);
  } finally {client.responses.create=original;}
});

test("every Jim storage operation scopes SQL to Jim, including restore and saved conversations", async () => {
  // Query-boundary test with an in-memory SQL stub, not a live Postgres test.
  const originalQuery=pool.query, originalConnect=pool.connect;
  const calls=[];
  const query=async (sql, params=[])=>{
    calls.push({sql,params});
    if (/SELECT id, data, updated_at/.test(sql)) return {rows:[{id:1,data:{cardData:{},gradeHistory:[]},updated_at:1,replaced_at:2,reason:"put"}]};
    return {rows:[]};
  };
  pool.query=query;
  pool.connect=async()=>({query,release(){}});
  try {
    assert.equal((await getProgress("jim-math")).userId,"jim");
    await listProgressHistory("jim-math");
    await getProgressHistoryEntry("jim-math",1);
    await putProgress("jim-math",{userId:"leo",cardData:{},gradeHistory:[]});
    await restoreProgress("jim-math",1);
    await listChat("jim-math");
    await appendChat("jim-math","test-session",[{role:"user",content:"test",ts:1}]);
    await issueSummary("jim-math");
    await recordIssues("jim-math","test-session",[{formulaId:"jm-1-1",chapter:1,topic:"fractions",kind:"algebra",evidence:"test"}]);
    const scoped=calls.filter(c=>c.params.length>0);
    assert.ok(scoped.length>=9);
    for (const call of scoped) assert.deepEqual(call.params.slice(0,2),["jim","jim-math"],call.sql);
    const inserted=scoped.filter(c=>/INSERT INTO progress \(/.test(c.sql));
    for (const call of inserted) assert.equal(call.params[2].userId,"jim");
  } finally {pool.query=originalQuery;pool.connect=originalConnect;}
});
