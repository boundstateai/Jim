// Voice layer for two-way tutor chat, ported from the HOVOR pattern: the
// browser records push-to-talk audio, the server transcribes it, and the
// tutor's reply text comes back as spoken audio per turn. Audio is
// transcribed and discarded — never stored.
//
// ASR/TTS run on OpenAI (Anthropic has no speech API). Voice is optional:
// without OPENAI_API_KEY the endpoints fail with a clear message and the
// typed chat keeps working untouched.

const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const TTS_URL = "https://api.openai.com/v1/audio/speech";

export const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";
export const LIVE_TRANSCRIBE_MODEL = process.env.OPENAI_LIVE_TRANSCRIBE_MODEL || "gpt-live-transcribe";
export const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
export const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "cedar";

// OpenAI is the default. Set LEO_TTS_PROVIDER=elevenlabs explicitly to use
// the optional ElevenLabs voice and model settings.
const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
export const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "ErXwobaYiN019PkySvjV";
export const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";

// Push-to-talk clips are seconds, not songs — and Vercel caps request bodies
// at ~4.5 MB, so the base64 payload has to stay under that anyway.
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
// OpenAI TTS rejects inputs over 4096 chars; tutor replies cap at 1024 tokens
// so this only trims pathological cases.
export const MAX_TTS_CHARS = 4000;

export class VoiceUnavailable extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "VoiceUnavailable";
    this.status = status;
  }
}

function requireKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new VoiceUnavailable("Voice needs OPENAI_API_KEY — typed chat still works.");
  }
  return key;
}

// Few-shot style guide for the ASR so course jargon survives transcription
// ("mu sub k", "sigma F equals m a" instead of phonetic guesses).
export function buildTranscribePrompt(hint) {
  const base =
    "College tutoring session, English. Expect formulas, units, and Greek letters " +
    "spoken aloud: sigma F equals m a, mu sub k, delta G, moles, newtons, joules.";
  return hint ? `${base} Topic: ${hint}.` : base;
}

// The reply is chat text; the voice model needs to know how a professor says
// it out loud, not how a screen reader would spell it.
export function buildTtsInstructions(persona, subject) {
  return `You are ${persona || "the tutor"}, explaining ${subject || "science"} to one student. ` +
    "Speak naturally: warm, thoughtful, and conversational. Use a comfortable pace and brief pauses " +
    "around equations and new ideas. Let emphasis follow meaning; avoid a presenter voice or forced excitement. " +
    "Read formulas as a teacher would, and do not read markdown punctuation aloud.";
}

// The browser exchanges its SDP through our authenticated endpoint. Only the
// transcription session reaches the client; the permanent API key stays here.
export async function connectLiveTranscription({ sdp, hint }, fetchImpl = fetch) {
  const key = requireKey();
  if (typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 100_000) {
    throw new VoiceUnavailable("A valid microphone connection offer is required.", 400);
  }
  const session = {
    type: "transcription",
    audio: { input: {
      transcription: {
        model: LIVE_TRANSCRIBE_MODEL,
        languages: ["en"],
        prompt: buildTranscribePrompt(typeof hint === "string" ? hint.slice(0, 500) : ""),
        delay: "medium",
      },
      turn_detection: null,
    } },
  };
  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(session));
  const response = await fetchImpl("https://api.openai.com/v1/realtime/calls", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new VoiceUnavailable(`Live transcription unavailable (${response.status}). Use recorded mode.`);
  return { sdp: await response.text() };
}

function extensionFor(mime) {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

// Only discard a near-verbatim copy of our full prompt. Ordinary questions
// containing words such as "spoken aloud" or "topic" are valid speech.
export function looksLikePromptEcho(text, hint) {
  const normalize = value => `${value || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const actual = normalize(text);
  return actual === normalize(buildTranscribePrompt(hint)) || actual === normalize(buildTranscribePrompt());
}

export async function transcribeAudio({ audio, mime, hint, peak }, fetchImpl = fetch) {
  const key = requireKey();
  if (!audio || typeof audio !== "string") {
    throw new VoiceUnavailable("audio (base64) is required.", 400);
  }

  let bytes;
  try {
    bytes = Buffer.from(audio, "base64");
  } catch {
    throw new VoiceUnavailable("audio must be base64.", 400);
  }
  if (!bytes.length) throw new VoiceUnavailable("audio is empty.", 400);
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new VoiceUnavailable("Audio clip too large — keep it under 30 seconds.", 413);
  }

  const contentType = typeof mime === "string" && mime ? mime.split(";")[0] : "audio/webm";
  const started = Date.now();
  const form = new FormData();
  form.append("model", TRANSCRIBE_MODEL);
  form.append(TRANSCRIBE_MODEL.startsWith("gpt-transcribe") ? "languages[]" : "language", "en");
  form.append("prompt", buildTranscribePrompt(typeof hint === "string" ? hint.slice(0, 500) : ""));
  form.append("file", new Blob([bytes], { type: contentType }), `speech.${extensionFor(contentType)}`);
  const response = await fetchImpl(TRANSCRIBE_URL, {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new VoiceUnavailable(`Transcription upstream returned ${response.status}.`);
  }
  const data = await response.json();
  let text = `${data.text || ""}`.trim();
  const echo = looksLikePromptEcho(text, hint);
  if (echo) text = "";
  // Shape only, never content: enough to tell "mic sent silence" (bytes fine,
  // 0 chars, low peak) from "clip never arrived" or "upstream slow".
  console.log(
    `voice transcribe: ${contentType} ${bytes.length}B peak=${peak ?? "n/a"} -> ${text.length} chars` +
      `${echo ? " (prompt echo dropped)" : ""} in ${Date.now() - started}ms`,
  );
  return { text };
}

// Turn on-screen math notation into what a professor SAYS at a whiteboard.
// ElevenLabs reads text literally, so "v_x = v\cos\theta" would be voiced as
// "v underscore x equals v backslash cos backslash theta" — hieroglyphics.
// This keeps the pretty notation on screen but speaks it like a human.
//
// Structure matters here: the brace-argument rules ({...} args) can only match
// arguments that contain no braces themselves, so they run in a fixpoint loop —
// each pass resolves the innermost layer, and \frac{\sum_{i} m_i x_i}{M}
// unwinds inside-out instead of leaking "frac" into the audio.

// How a power is SAID: x^2 "squared", 10^{-14} "to the negative 14",
// Ca^{2+} "two plus" (ion charge — sign LAST is charge, sign FIRST is exponent).
function spokenPower(exp) {
  const t = `${exp}`.trim();
  const charge = t.match(/^(\d*)\s*([+\-−])$/);
  if (charge) return ` ${charge[1] ? `${charge[1]} ` : ""}${charge[2] === "+" ? "plus" : "minus"} `;
  if (/^\\?circ$/.test(t) || t === "°") return " degrees ";
  if (t === "2") return " squared ";
  if (t === "3") return " cubed ";
  const negative = t.match(/^[-−]\s*(.+)$/);
  if (negative) return ` to the negative ${negative[1]} `;
  return ` to the ${t} `;
}

export function speakableMath(raw) {
  let s = `${raw || ""}`;
  s = s.replace(/```[\s\S]*?```/g, " ");            // code fences
  s = s.replace(/\*\*|__|[*`#>]/g, "");             // markdown emphasis/code/headers
  // PAIRED math delimiters unwrap first; only then is a lone "$1800" money.
  // (Inline math must hug its content — "$50 off the $1800" has no valid pair.)
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, " $1 ");
  s = s.replace(/\$(?=\S)([^$\n]+?)(?<=\S)\$(?!\d)/g, " $1 ");
  s = s.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, " $1 dollars ");
  s = s.replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, " "); // stray LaTeX $ $$ \( \) \[ \]
  // environments, alignment, and LaTeX line breaks say nothing
  s = s.replace(/\\begin\s*\{[a-zA-Z*]+\}|\\end\s*\{[a-zA-Z*]+\}/g, " ");
  s = s.replace(/\\\\/g, ", ").replace(/&/g, " ");
  // \left( \right) sizing — the lookahead keeps \rightarrow/\rightleftharpoons whole
  s = s.replace(/\\(?:left|right)(?![A-Za-z])\s*\.?/g, " ");
  s = s.replace(/\\(?:,|;|:|!|quad|qquad|displaystyle|limits|nolimits)/g, " ");

  // Brace-argument constructs, innermost-out. Each pass only matches args with
  // no nested braces; the loop reruns until nothing changes (bounded).
  for (let pass = 0; pass < 12; pass += 1) {
    const before = s;
    // wrappers that just hold text: \text{x} -> x
    s = s.replace(
      /\\(?:text|textrm|textit|textbf|mathrm|mathbf|mathit|mathcal|operatorname|mbox|ce)\s*\{([^{}]*)\}/g,
      " $1 ",
    );
    // decorated symbols professors name out loud
    s = s.replace(/\\vec\s*\{([^{}]*)\}/g, " vector $1 ");
    s = s.replace(/\\hat\s*\{([^{}]*)\}/g, " $1 hat ");
    s = s.replace(/\\(?:bar|overline)\s*\{([^{}]*)\}/g, " $1 bar ");
    s = s.replace(/\\ddot\s*\{([^{}]*)\}/g, " $1 double dot ");
    s = s.replace(/\\dot\s*\{([^{}]*)\}/g, " $1 dot ");
    // fractions and roots
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, " $1 over $2 ");
    s = s.replace(/\\sqrt\s*\[([^[\]]*)\]\s*\{([^{}]*)\}/g, " the $1 root of $2 ");
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, " square root of $1 ");
    // log base: \log_{10} x -> log base 10 of
    s = s.replace(/\\log\s*_\s*\{([^{}]*)\}/g, " log base $1 of ");
    s = s.replace(/\\log\s*_\s*([0-9A-Za-z]+)/g, " log base $1 of ");
    // exponents and subscripts (braced forms resolve here, layer by layer)
    s = s.replace(/\^\s*\{([^{}]*)\}/g, (_, exp) => spokenPower(exp));
    s = s.replace(/_\s*\{\s*0\s*\}/g, " naught ");
    s = s.replace(/_\s*\{([^{}]*)\}/g, " $1 ");
    if (s === before) break;
  }
  // unbraced exponent/subscript forms
  s = s.replace(/\^\s*([+\-−]?[0-9A-Za-z]+|[+\-−])/g, (_, exp) => spokenPower(exp));
  s = s.replace(/²/g, " squared ").replace(/³/g, " cubed ");
  s = s.replace(/_\s*0(?![0-9A-Za-z])/g, " naught ");
  s = s.replace(/₀/g, " naught ");
  s = s.replace(/_\s*([0-9A-Za-z]+)/g, " $1 ");
  s = s.replace(/[₁₂₃₄₅₆₇₈₉]/g, d => ` ${"₁₂₃₄₅₆₇₈₉".indexOf(d) + 1} `);
  s = s.replace(/√\s*\(?\s*([^)\s]+)\)?/g, " square root of $1 ");
  // big operators (\sum is what models actually emit; \Sigma kept below)
  s = s.replace(/\\sum\b/g, " the sum of ");
  s = s.replace(/\\prod\b/g, " the product of ");
  s = s.replace(/\\int\b/g, " the integral of ");
  s = s.replace(/\\lim\b/g, " the limit of ");
  s = s.replace(/\\infty|∞/g, " infinity ");
  s = s.replace(/\\partial|∂/g, " partial ");
  s = s.replace(/\\cdots|\\dots|\\ldots|⋯|…/g, " and so on ");
  // greek — LaTeX command or unicode char only (never bare English words)
  const greek = [
    [/\\theta|θ/g, " theta "], [/\\Delta|Δ|δ/g, " delta "],
    [/\\Sigma|Σ/g, " the sum of "], [/\\alpha|α/g, " alpha "],
    [/\\omega|ω/g, " omega "], [/\\Omega|Ω/g, " omega "],
    [/\\mu|μ/g, " mew "], [/\\rho|ρ/g, " roe "],
    [/\\pi|π/g, " pie "], [/\\lambda|λ/g, " lambda "],
    [/\\phi|φ/g, " fie "], [/\\tau|τ/g, " tau "],
    [/\\nu|ν/g, " new "], [/\\sigma/g, " sigma "],
    [/\\epsilon|\\varepsilon|ε/g, " epsilon "], [/\\gamma|γ/g, " gamma "],
    [/\\beta|β/g, " beta "], [/\\eta|η/g, " eta "],
    [/\\kappa|κ/g, " kappa "], [/\\chi|χ/g, " kai "],
    [/\\psi|ψ/g, " sigh "],
  ];
  for (const [re, rep] of greek) s = s.replace(re, rep);
  // functions and operators
  s = s.replace(/\\?\bcos\b/g, " cosine ").replace(/\\?\bsin\b/g, " sine ").replace(/\\?\btan\b/g, " tangent ");
  s = s.replace(/\\ln\b/g, " natural log of ").replace(/\\log\b/g, " log ").replace(/\\exp\b/g, " e to the ");
  s = s.replace(/\\times|×|\\cdot|·/g, " times ");
  s = s.replace(/\\div|÷/g, " divided by ");
  s = s.replace(/\\pm|±/g, " plus or minus ");
  s = s.replace(/\\mp|∓/g, " minus or plus ");
  s = s.replace(/\\approx|\\sim|≈|∼/g, " approximately ");
  s = s.replace(/\\propto|∝/g, " proportional to ");
  s = s.replace(/\\geq|\\ge\b|≥/g, " greater than or equal to ");
  s = s.replace(/\\leq|\\le\b|≤/g, " less than or equal to ");
  s = s.replace(/\\neq|\\ne\b|≠/g, " not equal to ");
  s = s.replace(/\\equiv|≡/g, " is equivalent to ");
  s = s.replace(/\\gg|≫/g, " much greater than ").replace(/\\ll|≪/g, " much less than ");
  // chemistry: equilibrium and reaction arrows come before the generic arrow
  s = s.replace(/\\rightleftharpoons|\\leftrightharpoons|⇌|↔/g, " is in equilibrium with ");
  s = s.replace(/\\Rightarrow|⇒/g, " implies ");
  s = s.replace(/\\(?:long)?rightarrow|\\to\b|→|⟶|->/g, " goes to ");
  s = s.replace(/°\s*C\b/g, " degrees Celsius ").replace(/°\s*F\b/g, " degrees Fahrenheit ").replace(/°/g, " degrees ");
  s = s.replace(/\\%|%/g, " percent ");
  s = s.replace(/\s*=\s*/g, " equals ");
  // clean up any remaining LaTeX scaffolding + whitespace
  s = s.replace(/[\\{}]/g, " ").replace(/\s{2,}/g, " ").replace(/ +([.,!?;:])/g, "$1");
  return s.trim();
}

async function synthesizeElevenLabs(input, voiceId, fetchImpl) {
  const key = process.env.ELEVENLABS_API_KEY;
  const url = `${ELEVENLABS_TTS_URL}/${voiceId || ELEVEN_VOICE_ID}?output_format=mp3_44100_128`;
  const response = await fetchImpl(url, {
    // The function may run 60 s; a full-length chunk of speech can take
    // longer than the old 25 s to synthesize. Clients send sentence-sized
    // pieces now, so this is the safety net, not the expected path.
    signal: AbortSignal.timeout(50_000),
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: input,
      model_id: ELEVEN_MODEL,
      // Lower stability + some style = more lively/expressive, less flat.
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.75,
        style: 0.4,
        use_speaker_boost: true,
      },
    }),
  });
  if (!response.ok) {
    throw new VoiceUnavailable(`ElevenLabs TTS returned ${response.status}.`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return { audio: audio.toString("base64"), mime: "audio/mpeg" };
}

export async function synthesizeSpeech({ text, persona, subject, voiceId }, fetchImpl = fetch) {
  // Speak the math, don't spell the notation.
  const input = speakableMath(text).slice(0, MAX_TTS_CHARS);
  if (!input) throw new VoiceUnavailable("text is required.", 400);

  // Explicit selection prevents an old ElevenLabs key from silently overriding Cedar.
  if (process.env.LEO_TTS_PROVIDER === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY) throw new VoiceUnavailable("ElevenLabs voice is not configured.");
    return synthesizeElevenLabs(input, voiceId, fetchImpl);
  }

  const key = requireKey();
  const response = await fetchImpl(TTS_URL, {
    signal: AbortSignal.timeout(50_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input,
      instructions: buildTtsInstructions(persona, subject),
      response_format: "mp3",
    }),
  });
  if (!response.ok) {
    throw new VoiceUnavailable(`TTS upstream returned ${response.status}.`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return { audio: audio.toString("base64"), mime: "audio/mpeg" };
}
