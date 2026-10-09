# UAH MA 171 variant

## Scope and provenance — 2026-10-09

The user confirmed MA 171, not MA 150. UAH currently lists [MA 171 as Calculus I](https://www.uah.edu/ssc/pass/pass-schedule). Its [historical CS 214 prerequisite summary, slide 0.16](https://www.uah.edu/images/research/cmsa/pdf/CS214/CS_214_15S_Course_Introduction_v19.pdf) describes MA 171 Calculus A in terms of limits/derivatives, definite/indefinite integrals and exponential/logarithmic/trigonometric functions.

These sources establish course identity and broad topic scope, not the current instructor's exact sequence. The live UAH catalog could not be retrieved during this build. The 12-unit sequence is an independently authored study design. Newton iteration and other subtopics must be reconciled with the actual class syllabus before claiming exact assignment/exam coverage.

[OpenStax Calculus Volume 1](https://openstax.org/details/books/calculus-volume-1) is linked as optional further reading. No textbook chapters, answer keys or exercise banks were imported. Lesson text, examples and diagnostic questions were authored for this variant using standard calculus mathematics.

Upstream: `boundstateai/Jim`, commit `5ec269b4ee511bd9f8f1954a7f202cd77cc7772a`. The existing `D:\BoundState\jim` checkout and the upstream main branch were not edited.

## Implementation

The new pack is `src/packs/uahCalculus.js`. IDs use descriptive, stable `ma171-*` suffixes. Do not reassign an existing ID to a new skill. App entrypoints, API course validation, tutor context, grading rubric and saved transcript labels use the calculus profile. The original algebra pack remains as an upstream reference and regression fixture.

- Course: `uah-ma171`
- Progress student ID: `uah-ma171-student`
- Browser progress key: `uah-ma171-v1`
- Starting check: `uah-ma171-v1-placement`
- Session cookie: `calculus_session`
- Credentials: `CALCULUS_USERNAME` / `CALCULUS_PASSWORD_HASH`

The new version does not import Jim's browser progress. All active data routes reject the old course. Course/student SQL parameters are checked with an in-memory query stub, including history restoration. This is isolation for a single learner, not a multi-user tenancy model.

The graph models are bounded demonstrations of x², not a symbolic calculator. Secant slope is computed as 2a+h to avoid cancellation for small h. The h=0 quotient is intentionally disallowed. The Riemann explorer uses right endpoints on [0,2], where x² is increasing, so the displayed sums overestimate 8/3.

## Validation

- Full suite: 130 tests, 127 passed, 3 database integration tests skipped because no scratch DATABASE_URL is supplied. The final calculus prompt adjustment also passed the focused API tests.
- Production build succeeds. The inherited combined app/math-rendering bundle still produces a size advisory.
- Browser checks: all 12 golden diagnostic answers accepted; the result survives reload; completing it awards no mastery.
- Secant step h=−0.01 at a=1 shows 1.990 approaching tangent slope 2.000.
- 64 Riemann rectangles give 2.72949 versus exact 8/3, error 0.06283.
- Chapter 5 opens all four differentiation-rule cards.
- At 390px viewport width, the home page has no horizontal overflow.
- Provider and database calls are not live-validated. The local preview reports unavailable synchronization; it does not claim records were saved remotely.
- No new cloud resources were created and no existing deployment was changed.

## Follow-up configuration

Supply the actual instructor syllabus to align order, textbook notation, optional topics and exam coverage. Confirm the intended learner name and existing hosting/database setup before provisioning. Set this version's credentials and test live coaching and persistence before release.
