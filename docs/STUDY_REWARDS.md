# Jim’s study allowance

## Rules

- $10 per confirmed hour, prorated to whole cents. 30 minutes earns $5. Whole-cent flooring is applied to the weekly total, so fractions of a cent carry between sessions in the same week.
- Five paid hours / $50 per week. Jim can keep studying after the limit; additional time is recorded without additional earnings.
- Weeks start Monday at midnight in America/Chicago. Sunday-to-Monday intervals are split, including daylight-saving transitions. Historical unapproved balances remain available after rollover.
- The student explicitly starts and resumes. The timer pauses on blur, hidden page, offline events, or 120 seconds without keyboard, input, scroll or pointer-down activity. Mouse movement alone does not reset idle time. A reminder appears after 90 seconds for working on paper.
- Mistakes and academic results never change earnings. The timer appears across study views and has its own storage, separate from progress resets.
- This is a family honor-system allowance, not proof of attention or a secure exam proctor. Client activity can be simulated. Parent review is the final check.

## Persistence and concurrent sessions

`/api/study` uses a dedicated `study_rewards` Postgres row for Jim. A transaction and row lock serialize updates. Earned durations and approvals cannot be replaced by client snapshots. Only server elapsed time is credited; submitted durations and money totals are ignored.

A random session identifier permits one active session across tabs/devices. Updates every 10 seconds include a monotonically increasing sequence number. Repeated/out-of-order updates add nothing. Each update credits at most 15 seconds. After a gap over 30 seconds, the session expires with no credit for that gap. Offline time and unconfirmed tail time are not recovered later. Closing a tab attempts a final save; if the browser cannot deliver it, the last confirmed total survives. A newly opened tab may need to wait up to 30 seconds for an abandoned session to expire.

The visible current-session clock is local feedback. “Saved today” and money are confirmed server totals, refreshed on each response. The earnings ledger is separate from skill-progress backup/reset routes.

## Parent payout review

1. Pause and open **Parent payout review**.
2. Ask Jim to demonstrate something he learned and review the week’s time.
3. Enter the parent-only approval code and select the displayed amount.
4. Pay Jim separately. The app records an approval and timestamp, not a bank transfer or proof of payment.

Approving twice cannot duplicate the amount. If the balance changes during review, refresh and approve the new amount. Later earnings in a partly approved week remain pending. Past approvals remain visible.

The backend uses `PARENT_APPROVAL_HASH`, the SHA-256 digest of a randomly generated parent code. The raw code and hash are never included in browser bundles or source control. The parent enters the raw code only in the approval form; it is not persisted in browser storage. Missing configuration fails closed. To rotate the code, generate a new high-entropy code and replace its SHA-256 digest in Railway’s `jim-api` variables, then redeploy. The existing student API token remains a separate optional bot filter.

## Validation

`npm test`: 91 tests, 88 passed, 3 existing database-dependent tests skipped without `DATABASE_URL`. New tests cover rate/cap/rounding, duplicate and stale requests, one-session ownership, server-clock bounds, expired sessions, Central-time rollover/DST, incremental approvals, fail-closed parent codes and activity gates.

`npm run build` passes. `scripts/study-browser-test.mjs` verifies actual browser controls with an isolated in-memory API: start/pause, confirmed time after reload, blur, inactivity, offline handling, invalid and valid parent codes, approval history after reload and no overflow at 390 pixels. It reports page exceptions. Run after building with Playwright installed and optionally `CHROMIUM_PATH` pointing to Chromium. This test does not write learner earnings to production or validate Postgres locking under load.

Production deployment is followed by read-only ledger and unauthorized-approval checks through the Vercel proxy. No simulated study time is added to Jim’s live balance.
