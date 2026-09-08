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
- Jim has no monetary tracker or invented exam dates. The completion display reports skill checks completed; long-term retention still requires review.
- Course `jim-math` maps to database user `jim` for progress, progress history, chats and issue reports. Existing courses keep user `leo`. Local progress, chat session and voice keys are also separate. This is data organization, not separate user authentication.

## Deployment

The root README documents both supported hosts: Vercel functions and the Node/container server in `scripts/server.mjs`. Both use the same course-aware handlers. Jim's API rejects non-Jim courses. The root `package.json` owns all runtime dependencies.

Required for live use: a configured model provider, Postgres, the matching API token configuration if enabled, and the relevant speech provider settings for voice. Use a separate database and credentials for Jim. No credentials, hosting deployment, DNS changes or production-data writes are included in this repository push.

The old single-student DynamoDB handler, Leo's deployment scripts and chemistry/physics packs are not included. Leo's source repository and deployment are not modified by this push.

## Verification and limits

- Production frontend build passes. Automated tests: 82 total, 79 pass, 3 database-dependent tests skipped.
- Chromium checks against the production build confirm root rendering, correct and skipped starting-check answers, earliest-gap recommendation, placement persistence after reload, keyboard graph controls, tangent shown as undefined at 90 degrees, chapter-practice navigation and absence of monetary UI. A 390-pixel mobile viewport has no horizontal overflow; no page JavaScript exceptions were observed. The Node API rejects a non-Jim course with HTTP 400.
- Browser verification used Playwright with a local Chromium binary after the agent-browser daemon could not start. Database calls correctly failed because no Postgres was configured; this was not a live-service end-to-end test.
- New tests cover fraction parsing and malformed inputs, diagnostic recommendations, skill catalog integrity, server-selected Jim context, learner-specific transcript labels, model request/rubric wiring and SQL parameters for progress/history/restore/chats/issues. Model and SQL boundary tests use stubs; they do not validate a live provider or database.
- Three existing database integration tests skip when `DATABASE_URL` is unset. Live AI, speech, photo interpretation and cross-device persistence need verification with a configured preview before release.
- Existing three-stage completion uses the engine's historical pass flags. It does not revoke completion after a later failure or prove performance on a delayed independent exam. A future stronger readiness gate should test fresh mixed problems on separate days and distinguish guided from independent attempts.
- The starting check is local to a device and does not personalize the server tutor automatically. Study and chat history do feed the existing weak-spot reporting.

Curriculum reference: [OpenStax Algebra and Trigonometry 2e](https://openstax.org/books/algebra-and-trigonometry-2e/pages/preface). Unit groupings and all lesson examples here were written for this app; this is not a full reproduction of the textbook or an official placement instrument.
