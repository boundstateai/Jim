# Jim's Math Lab

First implementation based on Leo's app at commit `c0ea0ced3e39bde1a394d6b7354bc62ebc79efe3`.

## Goal

Help Jim become comfortable manipulating algebra, interpreting functions and graphs, and using trigonometry before college. His starting level is unknown. The app suggests a starting point and offers practice; it does not certify college placement or calculus readiness.

## Implemented

- The root page and SPA fallback load Jim's course. This is a standalone repository adapted from Leo, with only Jim's course routed.
- 48 original skill cards across 12 units: number sense; equations and inequalities; lines and systems; exponents and radicals; polynomials and quadratics; rational expressions; functions and graphs; exponentials and logarithms; triangles and angle measure; unit circle; trig graphs and equations; college bridge.
- Every skill has a rule, meaning, worked example and common-error tip. Existing recall, solve and teach checks, review scheduling, photo input and voice components are reused.
- A 12-question starting check accepts numeric fractions or decimals, explains answers, and recommends the earliest sampled gap. It awards no course progress. The result is saved only on the current device. One question per unit is intentionally only an initial screen, not a mastery assessment.
- The home panel recommends an unfinished unit at or after that starting point. All units remain available; there is no hard prerequisite lock. A full passing starting check recommends the bridge unit for further assessment rather than claiming readiness.
- Interactive slope/intercept graph and unit circle with keyboard-accessible sliders, descriptive text and degree/radian readouts.
- Coach uses Jim's own persona and a question-first teaching approach. Generation supports expressions, intervals and multiple-root answers. Jim's solve rubric requires a demonstrated method; an unsupported answer is partial. Grading remains model-based, not a symbolic-math proof system.
- Jim's general review sessions are capped at 12 cards. The suggested session length is 15–20 minutes, not a timer or enforced schedule.
- Jim has no debt tracker or invented exam dates. His separate active-study allowance pays $10/hour, capped at $50/week, with parent approval; see `STUDY_REWARDS.md`. The completion display reports skill checks completed; long-term retention still requires review.
- Course `jim-math` maps to database user `jim` for progress, progress history, chats and issue reports. Existing courses keep user `leo`. Local progress, chat session and voice keys are also separate. This is data organization, not separate user authentication.

## Deployment

Production hosting is split between Vercel (static frontend) and Railway (Node API plus a dedicated persistent Postgres service). `vercel.json` forwards `/api/*` to the Railway service, while `.vercelignore` prevents Vercel from building duplicate API functions. Railway is linked to `BoundState-AI/Jim` on `main` and uses the Dockerfile and `/health` readiness check.

- Vercel project: `jim-math-lab` (`prj_VpuTuezxud95J9aaaJnfHtc5O5ac`) in the `bound-state` team. Live URL: `https://jim-math-lab.vercel.app`.
- Custom domain: `jim.boundstate.ai`, recorded in `vercel.json` and attached to the Vercel project on September 13, 2026 via `vercel --scope bound-state domains add jim.boundstate.ai jim-math-lab`. `boundstate.ai` resolves through Namecheap (`dns1`/`dns2.namecheaphosting.com`), not Vercel nameservers, so the subdomain needs a `jim` CNAME to `cname.vercel-dns.com` with automatic TTL — the same target `leo.boundstate.ai` uses. Vercel's CLI suggests an `A` record to `76.76.21.21` instead; the CNAME is preferred for a subdomain. The record was added at Namecheap; propagation and HTTPS verification were still unconfirmed when this was written.
- Vercel was deployed from source files through the connector; automatic GitHub deployments are not configured for the frontend. Railway is linked to GitHub.
- Railway project: `jim-math-lab` (`8044e51c-2aff-4c27-b803-7da5b9ab6719`).
- Production environment: `7e2f3d74-0e08-46eb-9adc-125f9257d524`.
- API service: `jim-api` (`e1b38ab5-28f9-413c-9dec-05bf26d8512e`).
- API origin: `https://jim-api-production.up.railway.app`.
- Postgres service: `96322891-b003-4deb-8d81-36c5289b8bda`; persistent volume mounted at `/var/lib/postgresql/data`.
- The API uses a Railway variable reference to `Postgres.DATABASE_URL`; no database credentials are stored in source or sent to the browser.

Live tutoring requires `ANTHROPIC_API_KEY` on Railway's `jim-api` service; voice also requires the relevant `OPENAI_API_KEY` and optional ElevenLabs configuration. The connected tools do not reveal existing provider secrets. Populate them in the hosting dashboard, then redeploy. See `.env.example` for names. No existing Leo student records or secrets were copied.

For a local all-in-one server, use `npm run build` and `npm start`. The old single-student DynamoDB handler and Leo's deployment scripts are not included.

## Sign in

Jim signs in with a username and password before the app will load his records. The
password is stored only as a scrypt digest in `JIM_PASSWORD_HASH` (`scrypt$<salt>$<hash>`),
generated by `node scripts/hash-password.mjs`, which reads stdin so the password never
enters shell history or a file. `JIM_USERNAME` defaults to `jim`.

`api/login.js` verifies the pair with `timingSafeEqual` and returns an HMAC-signed session
cookie: HttpOnly, Secure, SameSite=Lax, 30 days. `scripts/server.mjs` rejects every
`/api/*` request without a valid cookie except `/api/login` itself, so progress, chats,
voice, study time and tutoring are all gated server-side. Wrong username and wrong
password return one identical message, so the response cannot be used to probe which
half was wrong. The cookie signing key defaults to a digest of the password hash, so
rotating the password invalidates outstanding sessions without a second variable.

Limits worth stating plainly: this is a single shared credential for one student, not a
multi-user identity system, and it has no rate limiting, lockout or password reset. The
static bundle remains publicly downloadable — it contains no secrets, and `LoginGate` in
`src/Login.jsx` is a convenience so the UI does not fire doomed requests, not the gate
itself. The server is the gate.

## Verification and limits

- Production frontend build passes. Automated tests after the timer addition: 91 total, 88 pass, 3 database-dependent tests skipped.
- Chromium checks against the production build confirm root rendering, correct and skipped starting-check answers, earliest-gap recommendation, placement persistence after reload, keyboard graph controls, tangent shown as undefined at 90 degrees, chapter-practice navigation and absence of the inherited debt UI. A 390-pixel mobile viewport has no horizontal overflow; no page JavaScript exceptions were observed. The Node API rejects a non-Jim course with HTTP 400.
- Initial local browser verification used Playwright with a local Chromium binary after the agent-browser daemon could not start. On September 8, 2026, live Vercel HTML and the proxied Railway progress endpoint returned HTTP 200. An unchanged empty learner snapshot was saved and read back with the same server timestamp; no earned skill progress was added. The live app also rendered in the cloud browser.
- New tests cover fraction parsing and malformed inputs, diagnostic recommendations, skill catalog integrity, server-selected Jim context, learner-specific transcript labels, model request/rubric wiring and SQL parameters for progress/history/restore/chats/issues. Model and SQL boundary tests use stubs; they do not validate a live provider or database.
- Three existing database integration tests skip when `DATABASE_URL` is unset. Live AI, speech and photo interpretation still need provider keys and verification. Live database save/read was separately verified; physical cross-device interaction was not tested.
- Existing three-stage completion uses the engine's historical pass flags. It does not revoke completion after a later failure or prove performance on a delayed independent exam. A future stronger readiness gate should test fresh mixed problems on separate days and distinguish guided from independent attempts.
- The starting check is local to a device and does not personalize the server tutor automatically. Study and chat history do feed the existing weak-spot reporting.

Curriculum reference: [OpenStax Algebra and Trigonometry 2e](https://openstax.org/books/algebra-and-trigonometry-2e/pages/preface). Unit groupings and all lesson examples here were written for this app; this is not a full reproduction of the textbook or an official placement instrument.
