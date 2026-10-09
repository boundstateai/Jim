# Micah production deployment — 2026-10-09

## Ownership and scope

The owner authorized separate Micah resources and reuse of existing AI provider keys. Jim's database and hosted application were not changed. This deployment was uploaded from the local branch `codex/uah-ma171`; hosting is not yet connected to GitHub automatic deployment.

## Vercel

- Team: `bound-state` / `team_MhiJfySpbSLtXIxupBwOaRx6`
- Project: `micah-calculus` / `prj_D1rxI7S5RXjVUOoFm1JHE5TFNEBc`
- Deployment: https://micah-calculus-nzootoihz-bound-state.vercel.app
- Inspection: https://vercel.com/bound-state/micah-calculus/715YKcXoKemNf3fKyhCY1XZ42GXM
- Custom domain: https://micah.boundstate.ai
- Production bundle: `index-DA512Azl.js`
- Frontend-only deployment; `/api/*` rewrites to Micah's Railway API.
- Existing Vercel deployment protection remains enabled for Vercel preview addresses. The custom domain uses the app login.

Namecheap DNS supplied by the project domain configuration:

| Type | Host | Destination | TTL |
|---|---|---|---|
| CNAME | micah | 5c348a744ac3c119.vercel-dns-017.com | Automatic |

The domain is attached and ownership-verified. DNS routing and certificate availability must be checked after the owner's DNS change; ownership verification alone does not establish reachability.

## Railway

- Workspace: `db449662-903d-467d-aea0-e816099080fe`
- Project: `micah-calculus` / `2b25fe49-a705-4338-9ddd-353bbd8f82fc`
- Environment: production / `ae4144db-c560-4ea5-bfde-be70895ffc44`
- API service: `micah-api` / `36ed2342-2d3f-4d13-8258-548c7fc20470`
- API deployment: `9d210e20-4d9e-456e-ae86-196b2c520099` — SUCCESS
- API URL: https://micah-api-production.up.railway.app
- Health path: `/health`; port 8080
- Postgres: `286769aa-c994-4daf-8b79-f3a7b1a22e5c`
- Postgres deployment: `487fa761-e0aa-4023-b213-0096e88da08e` — SUCCESS
- Database variable references this project's `Postgres.DATABASE_URL`.

API variables: ANTHROPIC_API_KEY, OPENAI_API_KEY, DATABASE_URL, CALCULUS_USERNAME, CALCULUS_PASSWORD_HASH, SESSION_SECRET, NODE_ENV, PORT. Values are stored only in Railway. The starter login is saved outside the repository in the owner's local workspace; no credential values appear in this record.

## Verification

- Production frontend bundle matched the local build.
- App API denied unsigned requests.
- Sign-in established an HttpOnly, Secure session cookie across the Vercel proxy.
- Signed session recognized on subsequent requests.
- Dedicated Postgres read/save/read passed using the existing blank progress snapshot; no fabricated mastery was added.
- Live streaming Anthropic tutor answered that the derivative of x squared is 2x.
- Local regression suite: 126 passed, one stale learner-name assertion failed, three database tests skipped. After updating that assertion to Micah, all seven focused calculus/API tests passed.
- Browser flows and interactive mathematics were checked in the earlier local validation; see UAH_MA171.md.
- Voice recording/transcription remains untested live.

## Subsequent deployments

Use the linked directory, and always specify Railway project, production environment and service IDs above. Deploy Railway with `railway up`, verify the exact submitted deployment reaches SUCCESS, then deploy Vercel with `vercel --prod --scope bound-state`. Database credentials and login settings are already configured; do not rerun the initial credential setup or create replacement resources.
