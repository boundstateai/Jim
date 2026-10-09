import test from "node:test";
import assert from "node:assert/strict";
import { courseUserId, courseContext, calculusSystemPrompt } from "./_lib/course.js";
import { formatChatDigest } from "./_lib/chatLog.js";
import { struggleAddendum } from "./_lib/chatMessages.js";
import { client } from "./_lib/anthropic.js";
import { pool, getProgress, listProgressHistory, getProgressHistoryEntry, putProgress, restoreProgress } from "./_lib/db.js";
import { listChat, appendChat } from "./_lib/chatLog.js";
import { issueSummary, recordIssues } from "./_lib/issues.js";
import handler from "./chat.js";

test("Student context is server-selected and cannot inherit Leo's exams or debt", () => {
  const context = courseContext({ course: "uah-ma171", tutor: { studentName: "Leo" }, exams: [{ date: "2099-01-01" }], debt: 1800 });
  assert.equal(context.tutor.studentName, "Micah");
  assert.deepEqual(context.exams, []);
  assert.equal(context.debt, 0);
  assert.equal(courseUserId("physics"), "leo");
  assert.equal(courseUserId("chem"), "leo");
  assert.equal(courseUserId("uah-ma171"), "uah-ma171-student");
  assert.match(calculusSystemPrompt(context), /wait for the student's attempt/);
  assert.match(calculusSystemPrompt(context), /single success is not mastery/);
});

test("Student's report labels his own transcript and preserves Leo's default", () => {
  const messages = [{role:"user", content:"Why is it negative?", ts:1, sessionId:"a"}];
  assert.match(formatChatDigest(messages, {studentName:"Student"}), /Student: Why/);
  assert.match(formatChatDigest(messages), /Leo: Why/);
  const report = struggleAddendum({count:1,text:"Student: Why?",studentName:"Student"});
  assert.match(report, /where Student is struggling/);
  assert.doesNotMatch(report, /Leo/);
});

test("math generation and grading reach the handler with calculus context and method-based rubric", async () => {
  const original = client.messages.create;
  const prompts = [];
  client.messages.create = async payload => {
    prompts.push(payload.messages[0].content);
    return {content:[{type:"text",text:JSON.stringify({problem:"Differentiate x² at x=1",solution:"The derivative is 2x; at x=1 it is 2",correctAnswer:"2",grade:"PARTIAL",explanation:"Show the derivative before evaluating."})}]};
  };
  const headers = {authorization:`Bearer ${process.env.LEO_API_TOKEN || process.env.API_TOKEN || ""}`};
  const makeRes = () => ({statusCode:0,status(n){this.statusCode=n;return this;},json(body){this.body=body;}});
  try {
    const generated=makeRes();
    await handler({method:"POST",headers,body:{course:"uah-ma171",action:"generate_problem",formula:{name:"Power rule",formula:"d(x²)/dx=2x"}}},generated);
    assert.equal(generated.statusCode,200);
    assert.equal(generated.body.correctAnswer,"2");
    assert.match(prompts[0], /single-variable calculus practice problem/);
    const graded=makeRes();
    await handler({method:"POST",headers,body:{course:"uah-ma171",action:"grade_problem",...generated.body,studentAnswer:"2"}},graded);
    assert.equal(graded.statusCode,200);
    assert.equal(graded.body.grade,"PARTIAL");
    assert.match(prompts[1], /unsupported final answer is PARTIAL/);
    assert.match(prompts[1], /Require all roots and restrictions/);
  } finally {client.messages.create=original;}
});

test("every Student storage operation scopes SQL to Student, including restore and saved conversations", async () => {
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
    assert.equal((await getProgress("uah-ma171")).userId,"uah-ma171-student");
    await listProgressHistory("uah-ma171");
    await getProgressHistoryEntry("uah-ma171",1);
    await putProgress("uah-ma171",{userId:"leo",cardData:{},gradeHistory:[]});
    await restoreProgress("uah-ma171",1);
    await listChat("uah-ma171");
    await appendChat("uah-ma171","test-session",[{role:"user",content:"test",ts:1}]);
    await issueSummary("uah-ma171");
    await recordIssues("uah-ma171","test-session",[{formulaId:"ma171-domains",chapter:1,topic:"domains",kind:"algebra",evidence:"test"}]);
    const scoped=calls.filter(c=>c.params.length>0);
    assert.ok(scoped.length>=9);
    for (const call of scoped) assert.deepEqual(call.params.slice(0,2),["uah-ma171-student","uah-ma171"],call.sql);
    const inserted=scoped.filter(c=>/INSERT INTO progress \(/.test(c.sql));
    for (const call of inserted) assert.equal(call.params[2].userId,"uah-ma171-student");
  } finally {pool.query=originalQuery;pool.connect=originalConnect;}
});


test("all data routes reject Jim's course before touching services", async()=>{
  const modules=await Promise.all([import('./progress.js'),import('./chats.js'),import('./activity.js')]);
  for(const {default:route} of modules) {
    const res={statusCode:0,status(n){this.statusCode=n;return this;},setHeader(){},json(body){this.body=body;return this;}};
    await route({method:'GET',headers:{},query:{course:'jim-math'}},res);
    assert.equal(res.statusCode,400);
  }
  const res={statusCode:0,status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
  await handler({method:'POST',headers:{},body:{course:'jim-math',action:'generate_problem'}},res);
  assert.equal(res.statusCode,400);
});
