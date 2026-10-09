# Micah’s Calculus Lab — UAH MA 171

A standalone version of Jim's Math Lab for **MA 171: Calculus I / Calculus A** at the University of Alabama in Huntsville. Based on [boundstateai/Jim](https://github.com/boundstateai/Jim) commit `5ec269b4ee511bd9f8f1954a7f202cd77cc7772a`, developed on branch `codex/uah-ma171`.

## What is included

- 48 original lessons in 12 units, from prerequisite algebra/trig through limits, derivatives, applications, antiderivatives, definite integrals, the Fundamental Theorem, and substitution.
- A 12-question starting check that recommends review without awarding mastery.
- Interactive secant/tangent and Riemann-sum explorers.
- Jim's recall, worked-example, solve, explain-back, spaced-review, photo and voice workflows.
- A server-selected calculus Coach that checks reasoning, domains, theorem hypotheses, chain-rule factors, endpoints, constants of integration, and signed area.
- Separate course, student-record, browser-storage and session-cookie identifiers.

This is independent BoundState study support. It is not an official UAH product, an instructor's syllabus, a placement exam or a course-grade predictor. Instructor, term, textbook, assigned exercises, exam dates and calculator rules have not been supplied.

## Run on Windows

Node 22 or newer is required. From this directory in PowerShell:

```powershell
npm ci
npm run build
npm start
```

Open http://localhost:8080. To choose another port:

```powershell
$env:PORT = "4181"
npm start
```

For development, use `npm run api:dev` and `npm run dev` in separate terminals. The development API command works in PowerShell; Vite proxies to port 3001.

Lessons, the starting check and explorers work without service credentials. Live AI coaching/generation/grading requires `OPENAI_API_KEY`. Saved progress, chats and activity synchronization require `DATABASE_URL`. Missing services display errors; they do not fabricate answers or successful saves. The starting check is stored only in this browser.

The server does not automatically load .env files. Set variables in the shell/host, or with Node 22+ use:

```powershell
node --env-file=.env.local scripts/server.mjs
```

See [.env.example](.env.example). Micah has a dedicated Railway project and database. With owner authorization, the working existing OpenAI provider key is reused; no Jim progress or database connection is shared.

## Isolation and hosting

Production uses Vercel project `micah-calculus` for the frontend at `micah.boundstate.ai`. `/api/*` is forwarded to `https://micah-api-production.up.railway.app/api/*`. Railway project `micah-calculus`, production environment, runs the Docker API service and its own Postgres. Vercel excludes local API handlers from deployment. See [deployment record](docs/MICAH_DEPLOYMENT.md) for IDs and DNS.

This remains a single-learner app. Set `CALCULUS_USERNAME` (default `student`) and `CALCULUS_PASSWORD_HASH`; generate the scrypt hash using `node scripts/hash-password.mjs`. Unconfigured authentication leaves the API open for local development, as in the source app. Configure authentication before publishing. It uses the `calculus_session` cookie, separate from Jim's cookie. Session enforcement runs inside API handlers as well as the Node server.

The shared-engine `LEO_API_TOKEN`/`VITE_LEO_API_TOKEN` names remain for compatibility. A browser-bundled token is not user authentication. OpenAI voice configuration is inherited. Production sign-in, signed session cookies, database read/save/read, and an OpenAI Terra calculus response were verified through the Vercel-to-Railway route on 2026-10-09. Voice recording and transcription were not live-tested.

## Evidence and limits

[Implementation and validation](docs/UAH_MA171.md) records scope, source links and checks. The earlier `docs/JIM_MATH_LAB.md` and `docs/STUDY_REWARDS.md` describe the upstream app, not this version's deployment. No monetary reward panel is enabled here.

```powershell
npm test
npm run build
```

AI hosting and validation: [OpenAI migration](docs/OPENAI_MIGRATION.md).
