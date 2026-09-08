// Shared Anthropic client + JSON helpers for the Vercel Functions.
// Underscore-prefixed dir → Vercel does NOT treat these as routes.
//
// Model note: default is claude-opus-4-8. Opus 4.8 REJECTS temperature/top_p/top_k
// (400), so we never send them — steer variety through the prompt instead.
// To cut cost, set ANTHROPIC_MODEL / ANTHROPIC_GRADER_MODEL to claude-sonnet-5
// or claude-haiku-4-5 in the Vercel env.

import Anthropic from "@anthropic-ai/sdk";

// Reads ANTHROPIC_API_KEY from the environment.
export const client = new Anthropic();

export const CHAT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
export const GRADER_MODEL = process.env.ANTHROPIC_GRADER_MODEL || CHAT_MODEL;
// Per-turn issue tagging is small and frequent; a cheaper model is fine here.
export const TAGGER_MODEL = process.env.ANTHROPIC_TAGGER_MODEL || GRADER_MODEL;

export function extractText(content) {
  return (content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("")
    .trim();
}

function cleanJsonText(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
}

export function parseJsonReply(text) {
  const cleaned = cleanJsonText(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model returned invalid JSON.");
  }
}

// Non-streaming JSON prompt for the grade/generate actions.
export async function runJsonPrompt(prompt, { maxTokens = 700, model = GRADER_MODEL } = {}) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return parseJsonReply(extractText(response.content));
}

export function getErrorReply(error) {
  if (error?.status === 401 || error?.name === "AuthenticationError") {
    return "Anthropic API key is missing or invalid. Check ANTHROPIC_API_KEY.";
  }
  if (error?.status === 429 || error?.name === "RateLimitError") {
    return "Rate limited. Give it a few seconds and try again.";
  }
  return error?.message || "Something went wrong on my end.";
}
