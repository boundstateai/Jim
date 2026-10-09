// Separate from progress snapshots: timer heartbeats must not consume undo history.
import { pool, USER_ID } from './_lib/db.js';
import { requireApiAuth } from './_lib/auth.js';
import { unionRanges } from '../src/activity.js';
let schema;
async function ensureActivity() {
  if (!schema) schema = pool.query(`CREATE TABLE IF NOT EXISTS study_activity (
    user_id text NOT NULL, course text NOT NULL, day date NOT NULL,
    ranges jsonb NOT NULL, PRIMARY KEY(user_id, course, day)
  )`).catch(e => { schema=null; throw e; });
  return schema;
}
export function validateRanges(ranges, now=Date.now()) {
  return Array.isArray(ranges) && ranges.length <= 500 && ranges.every(r => Array.isArray(r) && r.length===2 && r.every(Number.isSafeInteger) && r[0] >= now-90*86400000 && r[1] <= now+5000 && r[1]>r[0] && r[1]-r[0]<=86400000);
}
export function utcBuckets(ranges) {
  const buckets = new Map();
  for (const [start,end] of unionRanges(ranges)) for (let at=start; at<end;) {
    const next=Math.min(end,(Math.floor(at/86400000)+1)*86400000);
    const day=new Date(at).toISOString().slice(0,10);
    buckets.set(day, [...(buckets.get(day)||[]),[at,next]]);
    at=next;
  }
  return buckets;
}
export default async function handler(req,res) {
  if (!requireApiAuth(req,res)) return;
  res.setHeader('Cache-Control','no-store');
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({error:'Method not allowed.'});
  let body={};
  try { body=typeof req.body==='string' ? JSON.parse(req.body) : req.body||{}; }
  catch { return res.status(400).json({error:'Invalid JSON.'}); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({error:'Invalid body.'});
  const course=req.query?.course || body.course || 'uah-ma171';
  if (!['uah-ma171'].includes(course)) return res.status(400).json({error:'Invalid course.'});
  if (req.method==='POST' && !validateRanges(body.ranges)) return res.status(400).json({error:'Invalid activity ranges.'});
  try {
    await ensureActivity();
    if (req.method==='POST' && body.ranges.length) {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`activity:${USER_ID}:${course}`]);
        for (const [day,ranges] of utcBuckets(body.ranges)) {
          const {rows}=await client.query('SELECT ranges FROM study_activity WHERE user_id=$1 AND course=$2 AND day=$3 FOR UPDATE',[USER_ID,course,day]);
          await client.query(`INSERT INTO study_activity(user_id,course,day,ranges) VALUES($1,$2,$3,$4)
            ON CONFLICT(user_id,course,day) DO UPDATE SET ranges=EXCLUDED.ranges`,[USER_ID,course,day,JSON.stringify(unionRanges(rows[0]?.ranges||[],ranges))]);
        }
        await client.query('COMMIT');
      } catch(e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
    }
    const {rows}=await pool.query("SELECT ranges FROM study_activity WHERE user_id=$1 AND course=$2 AND day >= (CURRENT_DATE - 32) ORDER BY day",[USER_ID,course]);
    return res.status(200).json({ranges:unionRanges(...rows.map(r=>r.ranges))});
  } catch(e) {
    console.error('activity storage failed',e);
    return res.status(500).json({error:'Could not sync study time.'});
  }
}
