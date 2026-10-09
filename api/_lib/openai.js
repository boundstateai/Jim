// OpenAI Responses integration for tutoring, grading and learning-gap tagging.
import OpenAI from "openai";

export const CHAT_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-terra";
export const GRADER_MODEL = process.env.OPENAI_GRADER_MODEL || CHAT_MODEL;
export const TAGGER_MODEL = process.env.OPENAI_TAGGER_MODEL || GRADER_MODEL;
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "medium";
let sdk;
// Lazy initialization keeps local lessons/tests usable without a provider key.
export const client = { responses: { create(...args) {
  sdk ||= new OpenAI({ timeout: 90000, maxRetries: 1 });
  return sdk.responses.create(...args);
} } };

function outputBudget(visibleTokens) {
  // Responses counts reasoning tokens against the same output ceiling.
  return Math.max(4096, visibleTokens + 3072);
}

export function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output || []).flatMap(item => item.content || [])
    .filter(block => block.type === "output_text").map(block => block.text).join("").trim();
}

export function parseJsonReply(text) {
  const value = JSON.parse(text.trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Model returned an invalid JSON object.");
  return value;
}

function incomplete() {
  const error = new Error("The tutor response was incomplete. Please try again.");
  error.code = "MODEL_OUTPUT_INCOMPLETE";
  return error;
}

export async function runJsonPrompt(prompt, { maxTokens = 700, model = GRADER_MODEL, schema = null } = {}) {
  const response = await client.responses.create({
    model, input: [{ role: "user", content: prompt }],
    instructions: "Return only the requested JSON object. Do not add prose or Markdown fences.",
    reasoning: { effort: REASONING_EFFORT }, max_output_tokens: outputBudget(maxTokens), store: false,
    text: { format: schema ? { type: "json_schema", name: "study_result", strict: true, schema } : { type: "json_object" } },
  });
  if (response.status !== "completed") throw incomplete();
  const text = extractText(response);
  if (!text) throw incomplete();
  return parseJsonReply(text);
}

export async function* streamTutor(input, { system }) {
  const stream = await client.responses.create({
    model: CHAT_MODEL, input, instructions: system, stream: true, store: false,
    reasoning: { effort: REASONING_EFFORT }, max_output_tokens: outputBudget(1024),
  });
  let completed = false;
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") yield event.delta;
    if (event.type === "response.refusal.delta") yield event.delta;
    if (event.type === "response.completed") completed = true;
    if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw incomplete();
  }
  if (!completed) throw incomplete();
}

export function getErrorReply(error) {
  if (error?.status === 401 || error?.name === "AuthenticationError") return "OpenAI API key is missing or invalid. Check OPENAI_API_KEY.";
  if (error?.status === 429 || error?.name === "RateLimitError") return "Rate limited. Give it a few seconds and try again.";
  if (error?.code === "MODEL_OUTPUT_INCOMPLETE") return error.message;
  // Provider errors can contain credentials or request details; do not echo them.
  return "The tutor is unavailable right now. Please try again shortly.";
}
