# Calculus Lab — UAH MA 171

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

Node 20 or newer is required. From this directory in PowerShell:

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

Lessons, the starting check and explorers work without service credentials. Live AI coaching/generation/grading requires `ANTHROPIC_API_KEY`. Saved progress, chats and activity synchronization require `DATABASE_URL`. Missing services display errors; they do not fabricate answers or successful saves. The starting check is stored only in this browser.

The server does not automatically load .env files. Set variables in the shell/host, or with Node 20.6+ use:

```powershell
node --env-file=.env.local scripts/server.mjs
```

See [.env.example](.env.example). No credentials, database connection or cloud project were copied from Jim or Leo.

## Isolation and hosting

Use a dedicated deployment and confirmed database configuration. Do not reconnect this version to Jim's production API. The inherited Jim domain alias and Railway proxy have been removed. The Dockerfile serves frontend and API together; Vercel can use the included local API handlers after its own environment is configured.

This remains a single-learner app. Set `CALCULUS_USERNAME` (default `student`) and `CALCULUS_PASSWORD_HASH`; generate the scrypt hash using `node scripts/hash-password.mjs`. Unconfigured authentication leaves the API open for local development, as in the source app. Configure authentication before publishing. It uses the `calculus_session` cookie, separate from Jim's cookie. Session enforcement runs inside API handlers as well as the Node server.

The shared-engine `LEO_API_TOKEN`/`VITE_LEO_API_TOKEN` names remain for compatibility. A browser-bundled token is not user authentication. Optional voice provider configuration is inherited. Live provider behavior and database integration have not been validated without this version's credentials.

## Evidence and limits

[Implementation and validation](docs/UAH_MA171.md) records scope, source links and checks. The earlier `docs/JIM_MATH_LAB.md` and `docs/STUDY_REWARDS.md` describe the upstream app, not this version's deployment. No monetary reward panel is enabled here.

```powershell
npm test
npm run build
```
