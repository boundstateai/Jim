import { pool } from "./db.js";
import { emptyRewards, summary, transition } from "./studyRewards.js";

let ready;
async function schema() {
  ready ||= pool.query("CREATE TABLE IF NOT EXISTS study_rewards (user_id text PRIMARY KEY, data jsonb NOT NULL)").catch(error => { ready = null; throw error; });
  return ready;
}
export async function studyRequest(body) {
  await schema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO study_rewards (user_id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING", ["jim", emptyRewards()]);
    const { rows } = await client.query("SELECT data FROM study_rewards WHERE user_id = $1 FOR UPDATE", ["jim"]);
    const state = rows[0].data;
    const now = Date.now();
    const result = transition(state, body, now);
    await client.query("UPDATE study_rewards SET data = $2 WHERE user_id = $1", ["jim", state]);
    await client.query("COMMIT");
    return { ...result, summary: summary(state, now) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
