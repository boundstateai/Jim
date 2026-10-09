import { courseContext, learningSubject, calculusSystemPrompt, courseStudentName } from "./_lib/course.js";
// Vercel Function: Dr. Chem tutor (streaming SSE) + grade/generate actions.
// Route: /api/chat  (POST)
//
// Ported from the Bedrock handler to the Anthropic API. Key change: Opus 4.8
// rejects temperature/top_p, so none are sent — problem variety is steered via
// the prompt instead.

import {
  client,
  CHAT_MODEL,
  extractText,
  runJsonPrompt,
  getErrorReply,
} from "./_lib/anthropic.js";
import { requireApiAuth } from "./_lib/auth.js";
import { toAnthropicMessages, struggleAddendum, ChatRequestError } from "./_lib/chatMessages.js";
import { chatDigest, DIGEST_DAYS } from "./_lib/chatLog.js";
import { issueSummary, formatIssueSummary, SUMMARY_DAYS } from "./_lib/issues.js";

// Pack-driven persona. The client sends `tutor` (persona/subject/course/textbook/
// traps/schedule) and `exams` from the active course pack; this builds the prompt
// generically so the same backend serves chem AND physics. Falls back to Dr. Chem
// defaults if an older client sends no tutor.
function buildSystemPrompt(body) {
  if (body.course === "uah-ma171") return calculusSystemPrompt(body);
  const tutor = body.tutor || {};
  const persona = tutor.persona || "Dr. Chem";
  const subject = tutor.subject || "chemistry";
  const debt = body.debt ?? 1800;
  const exams = Array.isArray(body.exams) ? body.exams : [];
  const weaknesses = Array.isArray(body.weaknesses) ? body.weaknesses : [];

  const examLines = exams.length
    ? exams
        .map(e => `- ${e.label}: ${e.date}${typeof e.days === "number" ? ` — ${e.days} days away` : ""}`)
        .join("\n")
    : "- No exam dates on file yet.";

  const trapLines = (tutor.traps || []).length
    ? `\nKNOWN TRAPS — if Leo trips on one of these, correct it gently but clearly:\n${tutor.traps.map(t => `- ${t}`).join("\n")}`
    : "";

  const weakLines = weaknesses.length
    ? `\nLeo's WEAK SPOTS from study data (PRIORITIZE these when quizzing):\n${weaknesses
        .map(w => `- ${w.name} (${w.formula}): avg ${Number(w.avg).toFixed(1)}/5, missed ${w.missed}×`)
        .join("\n")}`
    : "";

  return `You are "${persona}" — Leo's personal ${subject} tutor built into leo.boundstate.ai.

YOUR PERSONALITY:
You have a PhD in ${subject} and 15 years of teaching experience, but you're the opposite of stuffy. You're genuinely funny — dry wit, clever analogies, the occasional perfectly-timed joke. You're the professor students fight to get into because you make hard things click AND you make them laugh. You're grounded — you don't fake enthusiasm or talk down. You're patient on a molecular level — if Leo doesn't get it, you try a different angle, then another, then another. You NEVER make him feel dumb. When he gets something right, you celebrate it like it matters — because it does. When he gets something wrong, you say something like "Ooh close! The setup was perfect, the algebra just took a wrong turn at Albuquerque. Let's rewind to where it went sideways."

Your job isn't just to teach — it's to make Leo believe he CAN do this. Build his confidence. Point out what he's doing right before you fix what's wrong. Be specific: "Your setup was flawless — that's the hard part. The algebra just tripped you up."

CONTEXT:
- Course: ${tutor.course || "his college course"}
- Textbook: ${tutor.textbook || "his assigned textbook"} — reference chapter/section numbers when it helps
- ${tutor.mathNote || "He sometimes has math foundation gaps. SHOW EVERY SINGLE ALGEBRA STEP. Do not skip."}
${tutor.scheduleNote ? `- ${tutor.scheduleNote}` : ""}

EXAM SCHEDULE:
${examLines}
${trapLines}
${weakLines}

He owes the house $${debt}. He earns money off for every formula he masters in the app. He knows what the money is for. You can mention it sometimes to keep motivation up — "knock out two more tonight and that's another chunk off the tab."

RULES:
- Every algebra step shown. EVERY. SINGLE. ONE.
- Plain language first, then formal notation
- MATH NOTATION — strict two-channel rule. Every formula or math expression goes in LaTeX between $...$ (inline) or $$...$$ (its own line). NEVER write LaTeX outside those delimiters — no bare \\frac or \\sum loose in prose. Keep the LaTeX simple: \\frac, \\sqrt, \\sum, \\vec, \\hat, ^, _, standard Greek; no \\begin environments unless truly necessary. The app renders the symbols on screen AND reads your reply aloud, so also say each new formula once in plain spoken words ("center of mass: each mass times its position, added up, divided by the total mass") — the words are what Leo hears.
- When he's wrong: acknowledge what he did RIGHT first, then fix the error
- When quizzing: prioritize his weak spots and current material
- Reference the textbook chapter/section when relevant
- End with encouragement and a follow-up question or challenge
- Be funny naturally — don't force it. A well-timed analogy beats a bad pun.
- PHOTOS: Leo can attach a photo of a problem (textbook page, worksheet, whiteboard, screen). When one is attached, FIRST restate the problem exactly as written — every given value with units, what's being asked, and anything a diagram shows (angles, directions, labels) — in LaTeX where it's math. Then tutor it. If part of the photo is unreadable, say precisely what you can't make out and ask for a retake of that part rather than guessing at numbers.
- Leo and his friends call each other "chat" (streamer slang). Now and then — not every message — kick off a new topic with a casual "Ok chat," like you're pulling him in. Keep it occasional so it stays natural.
- NEVER condescending. This kid is smart. He just needs reps and confidence.`;
}

function normalizeGrade(value) {
  const grade = `${value || ""}`.trim().toUpperCase();
  if (grade === "CORRECT" || grade === "PARTIAL" || grade === "INCORRECT") return grade;
  return "INCORRECT";
}

function normalizeExplanation(value) {
  return `${value || ""}`.replace(/\s+/g, " ").trim().slice(0, 120);
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

async function gradeRecall(body) {
  if (!body.formulaName || !body.correctAnswer || !body.studentAnswer) {
    throw new Error("formulaName, correctAnswer, and studentAnswer are required.");
  }
  const result = await runJsonPrompt(`You are grading a student's typed ${learningSubject(body)} rule or formula recall.

Formula name: ${body.formulaName}
Correct answer:
${body.correctAnswer}

Student answer:
${body.studentAnswer}

Rules:
- Accept spacing differences, plain-text Greek names, and simple keyboard versions of subscripts/superscripts. Preserve mathematically distinct variables and operations.
- For calculus, accept a correct verbal rule or equivalent expression with its required conditions. Check domains, theorem hypotheses, limits, derivative factors and integration constants; do not award correctness just for matching words.
- Accept mathematically equivalent rearrangements if they clearly represent the same formula.
- For multi-line formulas, grade PARTIAL if the student recalled only part of the full answer.
- Reply with JSON only using this schema:
{"grade":"CORRECT|PARTIAL|INCORRECT","explanation":"one-line explanation"}
`);
  return { grade: normalizeGrade(result.grade), explanation: normalizeExplanation(result.explanation) };
}

async function generateProblem(body) {
  const formula = body.formula || {};
  if (!formula.name || !formula.formula) {
    throw new Error("formula.name and formula.formula are required.");
  }
  const result = await runJsonPrompt(`Generate one ${learningSubject(body)} practice problem at the level described by this skill. Vary the specific numbers and scenario so repeated requests are fresh.

Formula name: ${formula.name}
Formula:
${formula.formula}

Meaning:
${formula.meaning || ""}

Example:
${formula.example || ""}

Math tip:
${formula.mathTip || ""}

Rules:
- The problem must require this formula.
- Use realistic numbers and include all needed data.
- Specify a clear answer format, all domain restrictions, and degrees or radians for angles. The answer may be a number, expression, interval or full solution set as appropriate.
- For calculus, test the skill directly. State theorem hypotheses, domains, radians and units. Check derivatives independently and integrals by differentiation; do not force a chemistry scenario.
- The solution must show enough steps for grading.
- Reply with JSON only using this schema:
{"problem":"...","solution":"...","finalAnswer":"...","correctAnswer":"..."}
`, { maxTokens: 900 });
  return {
    problem: result.problem,
    solution: result.solution,
    finalAnswer: result.finalAnswer || result.correctAnswer,
    correctAnswer: result.correctAnswer || result.finalAnswer,
  };
}

// Worked example first, then the real attempt (Sweller): a TWIN of the
// problem Leo is about to solve — same structure, different numbers — solved
// completely, every algebra step shown, physical meaning before notation.
async function generateWorked(body) {
  const formula = body.formula || {};
  if (!formula.name || !formula.formula) {
    throw new Error("formula.name and formula.formula are required.");
  }
  const result = await runJsonPrompt(`A student learning ${learningSubject(body)} is about to solve this problem:

${body.problem || "(a problem using the formula below)"}

Write a WORKED EXAMPLE of a twin problem — same mathematical structure and same solution path, but different numbers and a slightly different scenario — solved completely, so the student can study how it's done before attempting theirs.

Formula name: ${formula.name}
Formula:
${formula.formula}

Meaning:
${formula.meaning || ""}

Rules:
- Start with the mathematical idea or situation in one plain sentence, before any equation.
- Then list the givens with units and what's being asked.
- Then every step, one idea per step, including every algebra rearrangement and unit check. Never skip a step.
- End with the answer with units, and one sentence on how to recognize this kind of problem next time.
- Math in LaTeX between $...$ (inline) or $...$ (own line); nothing else in LaTeX.
- Reply with JSON only using this schema:
{"problem":"the twin problem statement","steps":["step 1","step 2","..."],"answer":"final answer with units","takeaway":"one sentence"}
`, { maxTokens: 1200 });
  return {
    problem: `${result.problem || ""}`,
    steps: Array.isArray(result.steps) ? result.steps.map(step => `${step}`) : [],
    answer: `${result.answer || ""}`,
    takeaway: `${result.takeaway || ""}`,
  };
}

async function gradeProblem(body) {
  if (!body.problem || !body.solution || !body.correctAnswer) {
    throw new Error("problem, solution, and correctAnswer are required.");
  }
  const formula = body.formula || {};
  const result = await runJsonPrompt(`You are grading a ${learningSubject(body)} solution.

Formula name: ${formula.name || ""}
Formula:
${formula.formula || ""}

Problem:
${body.problem}

Worked solution:
${body.solution}

Correct final answer:
${body.correctAnswer}

Student answer:
${body.studentAnswer || ""}

Rules:
- Verify the supplied solution yourself before grading. Accept mathematically equivalent forms on the same domain and appropriate units.
${body.course === "uah-ma171" ? "- Require a valid method or explanation as well as the correct answer. An unsupported final answer is PARTIAL: ask for the reasoning. Require all roots and restrictions when relevant; never accept an extraneous root. Do not infer a correct method just because a number is close." : "- Focus on the final answer and units."}
- For calculus, check chain-rule factors, theorem hypotheses, endpoints, +C for indefinite integrals, substitution bounds and signed area versus total area.
- Accept reasonable rounding.
- Grade PARTIAL only when the submitted work demonstrates a partly correct method. Numerical closeness alone is not evidence of understanding.
- Reply with JSON only using this schema:
{"grade":"CORRECT|PARTIAL|INCORRECT","explanation":"one-line explanation"}
`);
  return { grade: normalizeGrade(result.grade), explanation: normalizeExplanation(result.explanation) };
}

async function generateTeach(body) {
  const formula = body.formula || {};
  if (!formula.name || !formula.formula) {
    throw new Error("formula.name and formula.formula are required.");
  }
  const result = await runJsonPrompt(`Create one short plain-English teaching prompt for a student learning ${learningSubject(body)}.

Formula name: ${formula.name}
Formula:
${formula.formula}

Meaning:
${formula.meaning || ""}

Rules:
- Frame it like a friend is asking for help in a real situation.
- Do not just ask "define the formula."
- Reply with JSON only using this schema:
{"scenario":"...","rubric":"What a strong answer should mention in one line."}
`, { maxTokens: 500 });
  return { scenario: result.scenario, rubric: result.rubric };
}

async function gradeTeach(body) {
  if (!body.scenario || !body.studentAnswer) {
    throw new Error("scenario and studentAnswer are required.");
  }
  const formula = body.formula || {};
  const result = await runJsonPrompt(`You are grading a student's plain-English ${learningSubject(body)} explanation.

Formula name: ${formula.name || ""}
Formula:
${formula.formula || ""}

Concept summary:
${formula.meaning || ""}

Scenario:
${body.scenario}

Strong answer should mention:
${body.rubric || ""}

Student answer:
${body.studentAnswer}

Rules:
- Grade CORRECT only if the student shows genuine conceptual understanding.
- Grade PARTIAL if the idea is partly right but missing a core piece.
- Grade INCORRECT if the explanation is materially wrong or too shallow to prove understanding.
- Reply with JSON only using this schema:
{"grade":"CORRECT|PARTIAL|INCORRECT","explanation":"one-line explanation"}
`);
  return { grade: normalizeGrade(result.grade), explanation: normalizeExplanation(result.explanation) };
}

async function streamChat(res, body) {
  let messages;
  try {
    messages = toAnthropicMessages(body.messages);
  } catch (error) {
    const status = error instanceof ChatRequestError ? error.status : 400;
    res.status(status).json({ error: error.message || "Bad chat request." });
    return;
  }

  let system = buildSystemPrompt(body);
  if (body.report === "struggles") {
    const persona = body.tutor?.persona || "Dr. Chem";
    const course = `${body.course || "chem"}`.slice(0, 40);
    try {
      const [digest, issues] = await Promise.all([
        chatDigest(course, { persona }),
        issueSummary(course, { days: SUMMARY_DAYS }).catch(error => { console.error("issue summary failed:", error); return []; }),
      ]);
      system += struggleAddendum({
        ...digest, days: DIGEST_DAYS, persona, studentName: courseStudentName(course),
        tracked: issues.length ? formatIssueSummary(issues, { days: SUMMARY_DAYS }) : "",
        trackedDays: SUMMARY_DAYS,
      });
    } catch (error) {
      console.error("struggle report: chat log unavailable:", error);
      system += struggleAddendum({ unavailable: true, days: DIGEST_DAYS, persona, studentName: courseStudentName(course) });
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });

  const sse = (event, payload) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const stream = client.messages.stream({
      model: CHAT_MODEL,
      max_tokens: 1024,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        sse("token", { text: event.delta.text });
      }
    }

    sse("done", { ok: true });
  } catch (error) {
    console.error("chat stream error:", error);
    sse("error", { error: getErrorReply(error) });
  } finally {
    res.end();
  }
}

export default async function handler(req, res) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const input = readBody(req);
  if (input.course && input.course !== "uah-ma171") {res.status(400).json({error:"Unsupported course."});return;}
  const body = courseContext({ ...input, course: "uah-ma171" });
  const action = body.action || "chat";

  if (action === "chat") {
    await streamChat(res, body);
    return;
  }

  try {
    let payload;
    if (action === "grade_recall") payload = await gradeRecall(body);
    else if (action === "generate_problem") payload = await generateProblem(body);
    else if (action === "grade_problem") payload = await gradeProblem(body);
    else if (action === "generate_teach") payload = await generateTeach(body);
    else if (action === "generate_worked") payload = await generateWorked(body);
    else if (action === "grade_teach") payload = await gradeTeach(body);
    else {
      res.status(400).json({ error: `Unsupported action: ${action}` });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error("chat action error:", error);
    res.status(500).json({ error: getErrorReply(error), reply: getErrorReply(error) });
  }
}
