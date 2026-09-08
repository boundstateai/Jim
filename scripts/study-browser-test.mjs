// Browser regression test with an isolated, in-memory rewards API.
// Run after npm run build. Requires Playwright and a Chromium executable.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createAppServer } from './server.mjs';
import { emptyRewards, transition, summary, addTime, weekKey } from '../api/_lib/studyRewards.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright' : 'playwright');
const server = createAppServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
let now = Date.parse('2026-09-08T15:00:00Z');
const state = emptyRewards();
const errors = [];
try {
  const page = await browser.newPage();
  await page.clock.install({ time: new Date(now) });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const req = route.request();
    if (!new URL(req.url()).pathname.endsWith('/study')) { await route.fulfill({ json: { progress: { cardData: {}, gradeHistory: [] }, messages: [], history: [] } }); return; }
    const body = req.method() === 'GET' ? { action: 'read' } : req.postDataJSON();
    if (body.action === 'approve' && body.code !== 'test-parent') { await route.fulfill({ status: 403, json: { error: 'Parent code is incorrect.' } }); return; }
    const { status = 200, ...result } = transition(state, body, now);
    await route.fulfill({ status, json: { ...result, summary: summary(state, now), parentConfigured: true } });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  const panel = page.getByRole('complementary', { name: 'Study time and earnings' });
  const start = panel.getByRole('button', { name: 'Start study timer', exact: true });
  await start.click();
  await panel.getByRole('button', { name: 'Pause study timer', exact: true }).waitFor();
  now += 10000;
  const tick = page.waitForResponse(r => r.url().endsWith('/api/study') && r.request().postDataJSON()?.action === 'tick');
  await page.clock.runFor(10000); await tick;
  assert.equal(summary(state, now).todayMs, 10000);
  await panel.getByRole('button', { name: 'Pause study timer', exact: true }).click();
  await start.waitFor();
  await page.reload(); await start.waitFor();
  assert.match(await panel.innerText(), /0:10/);
  await start.click(); await panel.getByRole('button', { name: 'Pause study timer', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await start.waitFor();
  assert.match(await panel.innerText(), /away from the app/);
  await start.click(); await panel.getByRole('button', { name: 'Pause study timer', exact: true }).waitFor();
  for (let i = 0; i < 11; i++) {
    now += 10000;
    const beat = page.waitForResponse(r => r.url().endsWith('/api/study') && r.request().postDataJSON()?.action === 'tick');
    await page.clock.runFor(10000); await beat;
  }
  now += 10000;
  const idleStop = page.waitForResponse(r => r.url().endsWith('/api/study') && r.request().postDataJSON()?.action === 'stop');
  await page.clock.runFor(10000); await idleStop;
  await start.waitFor();
  assert.match(await panel.innerText(), /two minutes without activity/);
  assert.equal(summary(state, now).todayMs, 130000);
  await start.click(); await panel.getByRole('button', { name: 'Pause study timer', exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await start.waitFor();
  assert.match(await panel.innerText(), /Connection lost/);
  // Seed isolated test earnings for parent approval; no live learner records.
  addTime(state, now - 1800000, now);
  await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
  await panel.getByRole('button', { name: 'Parent payout review', exact: true }).click();
  const parent = panel.getByRole('region', { name: 'Parent payout review' });
  await parent.getByLabel('Parent approval code').fill('wrong');
  await parent.getByRole('button', { name: /^Approve/ }).click();
  await panel.getByText('Parent code is incorrect.', { exact: true }).waitFor();
  assert.equal(state.weeks[weekKey(now)].approvedCents, 0);
  await parent.getByLabel('Parent approval code').fill('test-parent');
  await parent.getByRole('button', { name: /^Approve/ }).click();
  await panel.getByText(/no money was transferred/).waitFor();
  assert.equal(state.weeks[weekKey(now)].approvedCents, 536);
  assert.equal(state.weeks[weekKey(now)].approvals.length, 1);
  await page.reload();
  await panel.getByRole('button', { name: 'Parent payout review', exact: true }).click();
  assert.match(await parent.innerText(), /\$5.36 approved · \$0.00 awaiting approval/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: start/pause, saved-time reload, blur, idle, offline, rejected/accepted parent code, approval persistence, 390px layout; no page errors. API storage is isolated in memory.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
