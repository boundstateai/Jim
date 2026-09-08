// Turns the client's chat transcript into Anthropic message params, carrying
// photos of homework problems as image blocks so the tutor reads the page
// itself — no separate OCR hop.
//
// Photos ride only on the most recent few user turns. The tutor restates the
// problem in its first reply, so the text history carries the content forward
// and old images stop costing tokens on every turn.

export const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const MAX_IMAGES_PER_MESSAGE = 4;
// Client downsizes to ~1568px JPEG (a few hundred KB). Vercel caps the whole
// request body at 4.5 MB, so this is a per-image sanity bound, not a target.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const RECENT_IMAGE_TURNS = 3;
export const PHOTO_ONLY_TEXT = "Here's a photo of the problem.";
export const PHOTO_PLACEHOLDER = "[The student attached a photo of the problem here earlier — see your restatement of it above.]";

// "Where am I struggling?" — the tutor gets the saved transcript and is asked
// for an honest, specific read, not a pep talk. Also useful to Leo's dad, who
// can ask the same question in the same chat.
export function struggleAddendum({ count = 0, text = "", days = 30, persona = "the tutor", studentName = "Leo", unavailable = false, tracked = "", trackedDays = 90 } = {}) {
  const source = unavailable
    ? `The saved chat history could not be loaded right now, so base this on the current conversation and the weak-spot data above, and say that's all you had.`
    : count
      ? `Below is the saved chat history from the last ${days} days (${count} messages, oldest first, "${studentName}" is the student, "${persona}" is you).`
      : `There is no saved chat history yet for the last ${days} days, so base this on the weak-spot data above and the current conversation, and say so.`;
  return `

STRUGGLE REPORT — this turn is a request to summarize where ${studentName} is struggling. ${source}
Write the report, not a lesson:
1. The 3–5 recurring trouble spots, most costly first. For each, quote or closely paraphrase a concrete moment from the chats that shows it.
2. Patterns underneath them: misconceptions, math/algebra gaps, reading-the-problem habits, sign/unit slips, anything he keeps asking twice.
3. What's clearly improved or solid — be specific, not generous.
4. A 3-item focus plan for this week, each tied to one of the trouble spots and to a chapter/section.
Be direct and specific. No filler, no "great job". Plain prose with LaTeX for any math, headed by short bold labels.
${tracked ? `\n=== TRACKED TROUBLE SPOTS (tagged from chats, last ${trackedDays} days, ranked by recency × frequency; [id] = formula card) ===\n${tracked}\n=== END TRACKED ===\nLead with these — they are the pattern across weeks. Use the raw chats below for the specific moments.` : ""}
${text ? `\n=== SAVED CHATS ===\n${text}\n=== END SAVED CHATS ===` : ""}`;
}

export class ChatRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

function toImageBlock(image, index) {
  const mediaType = `${image?.media_type || image?.mediaType || ""}`.toLowerCase();
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new ChatRequestError(`Photo ${index + 1} is ${mediaType || "an unknown type"} — send JPEG, PNG, GIF, or WebP.`);
  }
  let data = `${image?.data || ""}`;
  const comma = data.indexOf(",");
  if (data.startsWith("data:") && comma !== -1) data = data.slice(comma + 1); // tolerate a data: URL
  data = data.replace(/\s+/g, "");
  if (!data) throw new ChatRequestError(`Photo ${index + 1} is empty.`);
  // base64 → bytes without decoding the whole thing
  const bytes = Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ChatRequestError(`Photo ${index + 1} is too large (${(bytes / 1048576).toFixed(1)} MB). Keep each under 3 MB.`, 413);
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

export function toAnthropicMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new ChatRequestError("messages required");
  const withImages = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role === "user" && Array.isArray(message.images) && message.images.length);
  const recent = new Set(withImages.slice(-RECENT_IMAGE_TURNS).map(({ index }) => index));

  return messages.map((message, index) => {
    const role = message?.role === "assistant" ? "assistant" : "user";
    const text = `${message?.content ?? ""}`;
    const images = role === "user" && Array.isArray(message?.images) ? message.images : [];
    if (!images.length) return { role, content: text };
    if (images.length > MAX_IMAGES_PER_MESSAGE) {
      throw new ChatRequestError(`Up to ${MAX_IMAGES_PER_MESSAGE} photos per message.`);
    }
    if (!recent.has(index)) {
      return { role, content: text ? `${text}\n\n${PHOTO_PLACEHOLDER}` : PHOTO_PLACEHOLDER };
    }
    return {
      role,
      content: [...images.map(toImageBlock), { type: "text", text: text.trim() || PHOTO_ONLY_TEXT }],
    };
  });
}
