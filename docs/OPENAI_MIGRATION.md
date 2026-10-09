# OpenAI migration — 2026-10-09

Jim now uses OpenAI Responses with gpt-5.6-terra for tutoring, grading, problem generation, and learning-gap tagging. Image inputs retain existing size/type/recency limits. Audio remains on OpenAI speech and transcription models.

Settings: OPENAI_API_KEY, optional OPENAI_MODEL, OPENAI_GRADER_MODEL, OPENAI_TAGGER_MODEL, and OPENAI_REASONING_EFFORT (default medium). Requests set store:false; saved learning records remain in the existing application database. Output ceilings include room for reasoning tokens. Failed, refused, or incomplete grading responses do not count as successful grades; interrupted streams do not emit successful completion. Provider error bodies are not sent to the browser.

The active Anthropic SDK and integration module were removed. Existing inactive legacy deployment documentation is historical. No new database or learner identity was created. The working existing OpenAI account key was verified against Terra before use; keys are never committed.

## Verification

- 122 automated tests passed; three scratch-database integration tests skipped. Build succeeded.
- Live grading: correct physics setup and answer accepted; missing negative quadratic root graded partial; incorrect calculus derivative rejected.
- Live homework image read and answered correctly; JSON checks covered a trigonometric limit and integration constant.
- OpenAI speech generation and transcription completed a round trip.
- Production tutor streamed a correct answer and existing saved progress was readable.

## Deployment

Railway deployment a8992c2a-4a96-4784-bb4e-9a1f12f93744 reached SUCCESS in project 8044e51c-2aff-4c27-b803-7da5b9ab6719, production environment 7e2f3d74-0e08-46eb-9adc-125f9257d524, service e1b38ab5-28f9-413c-9dec-05bf26d8512e. Existing Vercel frontend proxy is unchanged.

Reference: https://developers.openai.com/api/docs/models/gpt-5.6-terra
