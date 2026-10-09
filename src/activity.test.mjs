import test from 'node:test';
import assert from 'node:assert/strict';
import {activeSlice,unionRanges,subtractRanges,dailyTotals,studyDay} from './activity.js';
import {validateRanges,utcBuckets} from '../api/activity.js';

test('foreground slices stop exactly at idle limit, exclude background and sleep',()=>{
 assert.deepEqual(activeSlice(88_000,93_000,0,true),[[88_000,90_000]]);
 assert.deepEqual(activeSlice(90_000,95_000,0,true),[]);
 assert.deepEqual(activeSlice(5_000,10_000,0,false),[]);
 assert.deepEqual(activeSlice(5_000,70_000,0,true),[]);
 assert.deepEqual(activeSlice(10_000,5_000,0,true),[]);
});
test('overlapping devices and retries count once; adjacent ranges compact',()=>{
 const laptop=[[100,500],[600,700]],phone=[[300,600]];
 assert.deepEqual(unionRanges(laptop,phone,laptop),[[100,700]]);
 assert.deepEqual(unionRanges(phone,laptop),unionRanges(laptop,phone));
 assert.deepEqual(laptop,[[100,500],[600,700]]);
});
test('acknowledgement preserves activity recorded while a save was in flight',()=>{
 assert.deepEqual(subtractRanges([[100,900]],[[100,500]]),[[500,900]]);
 assert.deepEqual(subtractRanges([[100,900]],[[300,500]]),[[100,300],[500,900]]);
});
test('Central midnight splits days and DST days have 23/25 hours',()=>{
 const a=Date.parse('2026-09-24T04:59:30Z'),b=a+60000;
 assert.deepEqual(dailyTotals([[a,b]]),{'2026-09-23':30000,'2026-09-24':30000});
 assert.equal(dailyTotals([[Date.parse('2026-03-08T06:00:00Z'),Date.parse('2026-03-09T05:00:00Z')]])['2026-03-08'],23*3600000);
 assert.equal(dailyTotals([[Date.parse('2026-11-01T05:00:00Z'),Date.parse('2026-11-02T06:00:00Z')]])['2026-11-01'],25*3600000);
 assert.equal(studyDay(a),'2026-09-23');
});
test('API rejects malformed or unbounded activity; UTC storage splits midnight',()=>{
 const now=Date.now();
 assert.equal(validateRanges([[now-1000,now]],now),true);
 for(const ranges of [null,[[0,now]],[[now,now-1]],[[now,now+6000]],[[NaN,now]],[[now-1.5,now]],Array(501).fill([now-1000,now])]) assert.equal(validateRanges(ranges,now),false);
 const start=Date.parse('2026-09-23T23:59:00Z');
 assert.deepEqual([...utcBuckets([[start,start+120000]])],[['2026-09-23',[[start,start+60000]]],['2026-09-24',[[start+60000,start+120000]]]]);
});

test('activity endpoint saves unioned ranges, retries safely and leaves progress storage alone',async()=>{
 const {default:handler}=await import('../api/activity.js');
 const {pool}=await import('../api/_lib/db.js');
 const oldQuery=pool.query,oldConnect=pool.connect;
 const rows=new Map(),queries=[];
 const query=async(sql,args=[])=>{
  queries.push(sql);
  if(sql.startsWith('INSERT INTO study_activity')) assert.deepEqual(args.slice(0,2),['uah-ma171-student','uah-ma171']);
  if(sql.startsWith('SELECT ranges FROM study_activity WHERE') && sql.includes('FOR UPDATE')) return {rows:rows.has(args[2]) ? [{ranges:rows.get(args[2])}] : []};
  if(sql.startsWith('INSERT INTO study_activity')) rows.set(args[2],JSON.parse(args[3]));
  if(sql.startsWith('SELECT ranges FROM study_activity WHERE') && !sql.includes('FOR UPDATE')) return {rows:[...rows.values()].map(ranges=>({ranges}))};
  return {rows:[]};
 };
 pool.query=query;pool.connect=async()=>({query,release(){}});
 const call=async(method,body,course='uah-ma171')=>{
  const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
  const token=process.env.LEO_API_TOKEN||process.env.API_TOKEN||'';
  await handler({method,body,query:{course},headers:{'x-leo-api-token':token}},res);
  return res;
 };
 try {
  const now=Date.now(),a=[now-5000,now-2000],b=[now-4000,now];
  assert.equal((await call('POST',{ranges:[a]})).statusCode,200);
  assert.deepEqual((await call('POST',{ranges:[b]})).body.ranges,[[a[0],b[1]]]);
  assert.deepEqual((await call('POST',{ranges:[a]})).body.ranges,[[a[0],b[1]]]);
  assert.deepEqual((await call('GET')).body.ranges,[[a[0],b[1]]]);
  assert.equal((await call('POST',{ranges:[[0,now]]})).statusCode,400);
  assert.equal((await call('DELETE')).statusCode,405);
  assert.equal((await call('GET',undefined,'physics')).statusCode,400);
  assert.ok(queries.some(sql=>sql.includes('pg_advisory_xact_lock')));
  assert.ok(!queries.some(sql=>sql.includes('progress_history')));
 } finally {pool.query=oldQuery;pool.connect=oldConnect;}
});


function fakeStorage() {
 const data=new Map();
 return {get length(){return data.size;},key(i){return [...data.keys()][i]??null;},getItem(k){return data.get(k)??null;},setItem(k,v){data.set(k,v);},removeItem(k){data.delete(k);}};
}
const {createActivityOutbox}=await import('./activityOutbox.js');
test('two tabs preserve a new checkpoint appended after a prune/upload snapshot',()=>{
 const disk=fakeStorage();let id=0;
 const tabA=createActivityOutbox(disk,'time:',()=>String(++id));
 const tabB=createActivityOutbox(disk,'time:',()=>String(++id));
 tabB.append([[50,150]]);
 const snapshot=tabA.snapshot(100);
 assert.deepEqual([...snapshot.values()],[[[100,150]]]);
 tabB.append([[200,250]]); // Actual race: B appends after A snapshots B's work.
 tabA.acknowledge(snapshot,[[100,150]],100);
 assert.deepEqual([...tabB.snapshot(100).values()],[[[200,250]]]);
 tabA.acknowledge(snapshot,[[100,150]],100); // Repeated acknowledgement is safe.
 assert.deepEqual([...tabB.snapshot(100).values()],[[[200,250]]]);
});
test('expiry deletes immutable old entries; fresh entries are never rewritten',()=>{
 const disk=fakeStorage();let id=0,writes=0;
 const set=disk.setItem.bind(disk);disk.setItem=(k,v)=>{writes++;set(k,v);};
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 box.append([[10,100]]);box.append([[200,250]]);
 const before=writes;
 assert.deepEqual([...box.snapshot(100).values()],[[[200,250]]]);
 assert.equal(disk.length,1);assert.equal(writes,before);
 const snapshot=box.snapshot(100);
 box.acknowledge(snapshot,[[200,225]],100); // Partial batches retain the record.
 assert.equal(disk.length,1);
 box.acknowledge(snapshot,[[200,250]],100);
 assert.equal(disk.length,0);assert.equal(box.snapshot(100).size,0);
});
test('legacy buffers are never changed, including an append concurrent with pruning or acknowledgement',()=>{
 const disk=fakeStorage();const key='time:old-tab';
 disk.setItem(key,JSON.stringify([[10,20],[50,150]]));
 const box=createActivityOutbox(disk,'time:',()=> 'unused');
 const snapshot=box.snapshot(100);
 assert.deepEqual([...snapshot.values()],[[[100,150]]]);
 disk.setItem(key,JSON.stringify([[10,20],[50,150],[200,250]]));
 box.acknowledge(snapshot,[[100,150]],100);
 assert.deepEqual(JSON.parse(disk.getItem(key)),[[10,20],[50,150],[200,250]]);
 assert.deepEqual([...box.snapshot(100).values()],[[[200,250]]]);
 const newer=box.snapshot(100);box.acknowledge(newer,[[200,250]],100);
 assert.equal(box.snapshot(100).size,0); // Expired legacy data cannot keep sync pending.
});
test('failed uploads retain checkpoints; failed local writes remain in memory until acknowledged',()=>{
 const disk=fakeStorage();disk.setItem=()=>{throw Error('quota');};disk.removeItem=()=>{throw Error('blocked');};let id=0;
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 box.append([[200,250]]);
 const snapshot=box.snapshot(100);
 assert.deepEqual([...box.snapshot(100)], [...snapshot]);
 box.acknowledge(snapshot,[[200,250]],100);
 assert.equal(box.snapshot(100).size,0);
});

test('10,000 offline samples stay bounded and restore completely after closing the tab',()=>{
 const disk=fakeStorage();let id=0;
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 for(let i=0;i<10000;i++) {
   box.append([[i*1000,(i+1)*1000]]);
   assert.ok(disk.length<=64);
 }
 const reopened=createActivityOutbox(disk,'time:',()=>String(++id));
 const pending=reopened.snapshot(0);
 assert.deepEqual(unionRanges(...pending.values()),[[0,10000000]]);
 reopened.acknowledge(pending,[[0,10000000]],0);
 assert.equal(reopened.snapshot(0).size,0);
});
test('compaction tolerates an in-flight acknowledgement and a concurrent append',()=>{
 const disk=fakeStorage();let id=0;
 const a=createActivityOutbox(disk,'time:',()=>String(++id));
 const b=createActivityOutbox(disk,'time:',()=>String(++id));
 for(let i=0;i<63;i++) a.append([[i*10,i*10+5]]);
 const inFlight=b.snapshot(0);
 a.append([[630,635]]);
 const set=disk.setItem.bind(disk);let interleaved=false;
 disk.setItem=(key,value)=>{
   if(!interleaved && JSON.parse(value).length===64) {
     interleaved=true;
     // A reader acknowledges sources while the compacted replacement commits.
     b.acknowledge(inFlight,unionRanges(...inFlight.values()),0);
     b.append([[1000,1005]]);
   }
   set(key,value);
 };
 a.append([[2000,2005]]);
 const pending=unionRanges(...a.snapshot(0).values());
 assert.ok(interleaved);
 assert.deepEqual(subtractRanges([[630,635],[1000,1005],[2000,2005]],pending),[]);
});
test('failed compaction never deletes durable sources and memory retries stay compact',()=>{
 const disk=fakeStorage();let id=0;
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 for(let i=0;i<64;i++) box.append([[i*10,i*10+5]]);
 const set=disk.setItem.bind(disk);disk.setItem=()=>{throw Error('quota');};
 for(let i=0;i<200;i++) box.append([[1000+i*10,1005+i*10]]);
 assert.equal(disk.length,64);
 assert.equal(box.snapshot(0).size,66); // 64 durable sources + two bounded memory buffers
 disk.setItem=set;
 box.append([[4000,4005]]);
 const reopened=createActivityOutbox(disk,'time:',()=>String(++id));
 const pending=unionRanges(...reopened.snapshot(0).values());
 assert.equal(pending.length,265);
 assert.ok(disk.length<=64);
});


test('a fragmented compacted backlog drains through bounded API batches',()=>{
 const disk=fakeStorage();let id=0;
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 for(let i=0;i<1200;i++) box.append([[i*100,i*100+10]]);
 let uploads=0;
 while(box.snapshot(0).size && uploads<10) {
   const entries=box.snapshot(0),sent=unionRanges(...entries.values()).slice(0,500);
   box.acknowledge(entries,sent,0);uploads++;
 }
 assert.equal(box.snapshot(0).size,0);
 assert.ok(uploads>=3 && uploads<10);
});


test('quota recovery persists bounded checkpoints and drains the entire fragmented backlog',()=>{
 const disk=fakeStorage(); const set=disk.setItem.bind(disk); let id=0;
 disk.setItem=()=>{throw Error('quota');};
 const box=createActivityOutbox(disk,'time:',()=>String(++id));
 const ranges=Array.from({length:1201},(_,i)=>[i*100,i*100+10]);
 for(const range of ranges.slice(0,-1)) box.append([range]);
 const inFlight=box.snapshot(0);
 disk.setItem=set;
 box.append([ranges.at(-1)]);
 box.acknowledge(inFlight,ranges.slice(0,500),0);
 for(let i=0;i<disk.length;i++) assert.ok(JSON.parse(disk.getItem(disk.key(i))).length<=128);
 const reopened=createActivityOutbox(disk,'time:',()=>String(++id));
 assert.deepEqual(unionRanges(...reopened.snapshot(0).values()),ranges);
 let uploaded=[],attempts=0;
 while(reopened.snapshot(0).size && attempts++<10) {
   const entries=reopened.snapshot(0),batch=unionRanges(...entries.values()).slice(0,500);
   uploaded=unionRanges(uploaded,batch);
   reopened.acknowledge(entries,batch,0);
 }
 assert.equal(reopened.snapshot(0).size,0);
 assert.deepEqual(uploaded,ranges);
});

test('partial recovery failures retain every range and report unsaved memory',()=>{
 const disk=fakeStorage();const set=disk.setItem.bind(disk);let id=0,ok;
 disk.setItem=()=>{throw Error('quota');};
 const box=createActivityOutbox(disk,'time:',()=>String(++id),value=>{ok=value;});
 const ranges=Array.from({length:700},(_,i)=>[i*100,i*100+10]);
 box.append(ranges);
 let writes=0;
 disk.setItem=(key,value)=>{if(++writes===2) throw Error('quota');set(key,value);};
 box.append([[80000,80010]]);
 assert.equal(ok,false);
 assert.deepEqual(unionRanges(...box.snapshot(0).values()),[...ranges,[80000,80010]]);
 disk.setItem=set;
 box.append([[90000,90010]]);
 const reopened=createActivityOutbox(disk,'time:',()=>String(++id));
 assert.deepEqual(unionRanges(...reopened.snapshot(0).values()),[...ranges,[80000,80010],[90000,90010]]);
});
