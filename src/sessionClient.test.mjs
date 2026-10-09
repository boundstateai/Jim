import test from "node:test";
import assert from "node:assert/strict";
import {readLoginStatus, loginWithSession, sessionFetch} from "./sessionClient.js";
const response = (data, status=200) => ({ok:status>=200 && status<300,status,json:async()=>data});

test("login checks fail closed on transport, HTTP, or malformed responses",async()=>{
  for(const fake of [async()=>{throw new Error("offline");},async()=>response({},503),async()=>response({})]) {
    await assert.rejects(readLoginStatus(fake));
  }
  assert.equal((await readLoginStatus(async()=>response({authenticated:false,configured:true}))).authenticated,false);
});

test("a password response does not sign in unless the cookie survives a second request",async()=>{
  const calls=[];
  const noCookie=async(url,options)=>{calls.push(options);return options.method==="POST"?response({authenticated:true}):response({authenticated:false,configured:true});};
  await assert.rejects(loginWithSession("micah","test",noCookie),/cookie/);
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.credentials==="same-origin"&&x.cache==="no-store"));
  const good=async()=>response({authenticated:true,configured:true});
  assert.equal((await loginWithSession("micah","test",good)).authenticated,true);
});

test("a rejected Coach request signals reauthentication and preserves the response",async()=>{
  let expired=0;
  const result=await sessionFetch("/api/chat",{method:"POST"},async(url,options)=>{
    assert.equal(options.credentials,"same-origin"); return response({error:"Please sign in."},401);
  },()=>expired++);
  assert.equal(result.status,401);assert.equal(expired,1);
  await sessionFetch("/api/chat",{},async()=>response({}),()=>expired++);
  assert.equal(expired,1);
});
