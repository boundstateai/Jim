# OpenAI migration — 2026-10-09

Micah now uses OpenAI Responses with gpt-5.6-terra for tutoring, grading, problem generation, and learning-gap tagging. Image inputs retain existing size/type/recency limits. Audio remains on OpenAI speech and transcription models.

Settings: OPENAI_API_KEY, optional OPENAI_MODEL, OPENAI_GRADER_MODEL, OPENAI_TAGGER_MODEL, and OPENAI_REASONING_EFFORT (default medium). Requests set store:false; saved learning records remain in the existing application database. Output ceilings include room for reasoning tokens. Failed, refused, or incomplete grading responses do not count as successful grades; interrupted streams do not emit successful completion. Provider error bodies are not sent to the browser.

The active Anthropic SDK and integration module were removed. Existing inactive legacy deployment documentation is historical. No new database or learner identity was created. The working existing OpenAI account key was verified against Terra before use; keys are never committed.

## Verification

- 130 automated tests passed; three scratch-database integration tests skipped. Build succeeded.
- Live grading: correct physics setup and answer accepted; missing negative quadratic root graded partial; incorrect calculus derivative rejected.
- Live homework image read and answered correctly; JSON checks covered a trigonometric limit and integration constant.
- OpenAI speech generation and transcription completed a round trip.
- Production tutor streamed a correct answer and existing saved progress was readable.

## Deployment

Railway deployment f66bdeea-a6a7-4f8a-90a2-477becd94901 reached SUCCESS in project 2b25fe49-a705-4338-9ddd-353bbd8f82fc, production environment ae4144db-c560-4ea5-bfde-be70895ffc44, service 36ed2342-2d3f-4d13-8258-548c7fc20470. Vercel: https://micah-calculus-rllqwmsyq-bound-state.vercel.app.

Micah also verifies the session after password login, keeps the login screen visible when session checks fail, and returns to login when an API call reports 401. Three additional session tests and two browser checks cover these paths. Production login-cookie recognition and a subsequent Coach response passed.

Reference: https://developers.openai.com/api/docs/models/gpt-5.6-terra
