import test from "node:test";
import assert from "node:assert/strict";
import { client, runJsonPrompt, streamTutor, getErrorReply } from "./_lib/openai.js";

test("JSON responses preserve model role, reasoning budget and no-store; reject incomplete results", async () => {
  const original = client.responses.create;
  const calls = [];
  client.responses.create = async payload => { calls.push(payload); return {status:"completed",output_text:'{"grade":"PARTIAL"}'}; };
  try {
    assert.deepEqual(await runJsonPrompt("Grade as JSON", {maxTokens:700,model:"gpt-5.6-terra"}), {grade:"PARTIAL"});
    assert.equal(calls[0].model, "gpt-5.6-terra");
    assert.equal(calls[0].store, false);
    assert.equal(calls[0].text.format.type, "json_object");
    assert.equal(calls[0].reasoning.effort, "medium");
    assert.ok(calls[0].max_output_tokens > 700);
    client.responses.create = async () => ({status:"incomplete",output_text:'{"grade":"CORRECT"}'});
    await assert.rejects(runJsonPrompt("Grade as JSON"), {code:"MODEL_OUTPUT_INCOMPLETE"});
    client.responses.create = async () => ({status:"completed",output:[{type:"message",content:[{type:"refusal",refusal:"Cannot grade"}]}]});
    await assert.rejects(runJsonPrompt("Grade as JSON"), {code:"MODEL_OUTPUT_INCOMPLETE"});
  } finally { client.responses.create = original; }
});

test("streaming requires explicit completion and never treats a failed or cut-off answer as done", async () => {
  const original = client.responses.create;
  const collect = async () => {const parts=[];for await(const t of streamTutor([{role:"user",content:"help"}],{system:"Teach calculus"}))parts.push(t);return parts.join("");};
  try {
    client.responses.create = async payload => {assert.equal(payload.store,false);assert.equal(payload.instructions,"Teach calculus");return (async function*(){yield {type:"response.output_text.delta",delta:"2x"};yield {type:"response.completed"};})();};
    assert.equal(await collect(),"2x");
    for(const ending of ["response.failed","response.incomplete","error",null]) {
      client.responses.create = async () => (async function*(){yield {type:"response.output_text.delta",delta:"partial"};if(ending)yield {type:ending};})();
      await assert.rejects(collect(),{code:"MODEL_OUTPUT_INCOMPLETE"});
    }
  } finally {client.responses.create=original;}
});

test("provider error text never exposes credentials",()=>{
 assert.match(getErrorReply({status:401,message:"secret"}),/OPENAI_API_KEY/);
 assert.doesNotMatch(getErrorReply({status:400,message:"secret"}),/secret/);
});
