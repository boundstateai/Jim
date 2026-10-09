# Jim's Math Lab

Algebra and trigonometry preparation for college, adapted from [Leo's study engine](https://github.com/BoundState-AI/leo) at commit `c0ea0ced3e39bde1a394d6b7354bc62ebc79efe3`.

Jim gets a standalone app with his own curriculum and records:

- 48 skills in 12 units, from fractions and equation solving through functions, logarithms, trig and a college bridge.
- A short starting check and a recommended next unit.
- Worked examples, recall, new practice problems and explain-it-back checks.
- Interactive line graphs and a unit circle with degrees and radians.
- Coach, an AI tutor that asks for an attempt, gives hints and explains the algebra.
- Saved study progress, conversations and trouble-spot reports; optional voice and photos.

The starting check suggests where to begin. It is not a placement exam or proof of college readiness. Study progress is separate from Leo's, and there is no debt tracker or invented exam schedule.

The study timer banks active time at $10/hour, capped at $50 per Monday–Sunday week (America/Chicago). It pauses on leaving the app, losing connection, or two minutes without activity. Parent payout review requires a private approval code and records approval only; it never sends money. See `docs/STUDY_REWARDS.md` for rules and operation.

## Run locally

Use Node 20 or newer. Set the server variables listed in `.env.example` in your shell or hosting environment. Vite reads `.env.local` for frontend variables; the Node server does not automatically load env files. With Node 20.6+, you can run `node --env-file=.env.local scripts/server.mjs` instead of `npm start` to load one explicitly.

```sh
npm ci
npm run build
npm start
```

Open `http://localhost:8080`. The root page is Jim's app. For frontend development, run `npm run api:dev` in one terminal and `npm run dev` in another; Vite proxies API calls to port 3001.

The starting check, curriculum and visual explorers run without provider keys. Live tutor/verification needs `OPENAI_API_KEY`; saved progress and chats need `DATABASE_URL`. Voice uses the providers configured in `api/_lib/voice.js`. Missing services produce errors rather than fabricated tutor answers or saved progress.

## Host

- Vercel: the included `vercel.json` builds the frontend and forwards `/api/*` to `https://jim-api-production.up.railway.app`. The `.vercelignore` excludes backend files so Vercel does not create duplicate API functions.
- Railway: the `jim-api` service builds this repository with the Dockerfile and runs the course-aware handlers. Its `DATABASE_URL` references the dedicated Postgres service. Both services live in the `jim-math-lab` project. Provider keys belong in the Railway `jim-api` Variables panel.
- Use Jim's own database/provider configuration. Do not attach a review deployment to Leo's production database.
## Sign in

The app requires a username and password. `JIM_USERNAME` (default `jim`) and
`JIM_PASSWORD_HASH` hold the credentials; the hash is a scrypt digest produced by
`node scripts/hash-password.mjs`, so the password itself is never stored or committed.
A successful sign-in sets an HttpOnly, Secure, SameSite=Lax cookie valid for 30 days,
and every API route except `/api/login` requires it. Changing the password signs out
all existing sessions.

If `JIM_PASSWORD_HASH` is unset the API stays open, which is how the app behaved before
sign-in existed. The static bundle stays public either way: it holds no secrets, and the
gate protects Jim's records and the tutor, not the page itself.

- If `LEO_API_TOKEN` is set, provide the same value in `VITE_LEO_API_TOKEN` during the frontend build. Those legacy variable names are retained from the engine. In the split deployment, set the server token on Railway and the frontend value on Vercel. A token compiled into browser JavaScript is not user authentication; private deployment access must come from the hosting layer.

## Checks and implementation notes

```sh
npm test
npm run build
```

Tests that require Postgres skip without `DATABASE_URL`. The new model/SQL boundary tests use stubs, not live services. See [implementation notes](docs/JIM_MATH_LAB.md) for the curriculum, behavior, validation evidence and remaining limitations.

Live frontend: https://jim-math-lab.vercel.app

Custom domain: `jim.boundstate.ai`, attached to the Vercel project on September 13, 2026. A `jim` CNAME to `cname.vercel-dns.com` was added at Namecheap; DNS propagation and Vercel's HTTPS verification were not yet confirmed at the time of writing. See `docs/JIM_MATH_LAB.md` for deployment IDs, verification and remaining setup.

AI hosting and validation: [OpenAI migration](docs/OPENAI_MIGRATION.md).
