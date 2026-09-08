import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  transcribeAudio,
  synthesizeSpeech,
  speakableMath,
  buildTranscribePrompt,
  buildTtsInstructions,
  looksLikePromptEcho,
  connectLiveTranscription,
  TRANSCRIBE_MODEL,
  VoiceUnavailable,
  MAX_AUDIO_BYTES,
  MAX_TTS_CHARS,
  TTS_VOICE,
} from "./_lib/voice.js";

// No spoken reply may ever contain LaTeX plumbing — this is the "frac frac
// sum sub i" bug. Every speakableMath test runs its output through this.
function assertNoLatexArtifacts(spoken) {
  assert.doesNotMatch(spoken, /\\/, "backslash leaked into speech");
  assert.doesNotMatch(spoken, /[{}_^&]/, "LaTeX scaffolding leaked into speech");
  assert.doesNotMatch(spoken, /\b(?:frac|dfrac|tfrac|sqrt|cdot|left|right|begin|end|mathrm|text|displaystyle)\b/i,
    "LaTeX command word leaked into speech");
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.LEO_TTS_PROVIDER;
});

test("transcribe fails closed without OPENAI_API_KEY — typed chat message, 503", async () => {
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(
    () => transcribeAudio({ audio: Buffer.from("hi").toString("base64") }),
    error => error instanceof VoiceUnavailable && error.status === 503 && /typed chat/i.test(error.message),
  );
});

test("transcribe rejects missing, empty, and oversized clips with client statuses", async () => {
  await assert.rejects(() => transcribeAudio({}), error => error.status === 400);
  await assert.rejects(() => transcribeAudio({ audio: "" }), error => error.status === 400);
  const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString("base64");
  await assert.rejects(() => transcribeAudio({ audio: oversized }), error => error.status === 413);
});

test("transcribe posts the clip with model, language, and topic-hinted prompt", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ text: "  what is normal force  " }) };
  };

  const result = await transcribeAudio(
    { audio: Buffer.from("fake-audio").toString("base64"), mime: "audio/mp4;codecs=avc1", hint: "physics — PH 101" },
    fetchImpl,
  );

  assert.equal(result.text, "what is normal force");
  assert.match(captured.url, /audio\/transcriptions/);
  assert.equal(captured.options.headers.Authorization, "Bearer test-key");
  const form = captured.options.body;
  assert.equal(form.get("languages[]"), "en");
  assert.equal(form.get("language"), null);
  assert.equal(form.get("model"), TRANSCRIBE_MODEL);
  assert.match(form.get("prompt"), /physics — PH 101/);
  assert.equal(form.get("file").name, "speech.mp4");
});

test("transcribe drops a transcript that is the prompt leaking back", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ text: buildTranscribePrompt() }),
  });
  const result = await transcribeAudio({ audio: Buffer.from("noise").toString("base64") }, fetchImpl);
  assert.equal(result.text, "");
});

test("prompt-echo guard never eats a real answer that quotes a formula", () => {
  assert.equal(looksLikePromptEcho("sigma F equals m a, so a is F over m"), false);
  assert.equal(looksLikePromptEcho("mu sub k times the normal force"), false);
  assert.equal(looksLikePromptEcho("Topic: physics — PH 101"), false);
  assert.equal(looksLikePromptEcho("Can you explain how this equation should be spoken aloud?"), false);
  assert.equal(looksLikePromptEcho("In this problem I expect formulas for velocity."), false);
});

test("transcribe does not repeat invalid requests or discard vocabulary on a 400", async () => {
  let calls = 0;
  await assert.rejects(() => transcribeAudio({ audio: Buffer.from("x").toString("base64"), hint: "physics" }, async () => {
    calls++; return { ok: false, status: 400 };
  }), error => error.status === 503);
  assert.equal(calls, 1);
});

test("live connection uses a transcription-only session and keeps the key server-side", async () => {
  let request;
  const result = await connectLiveTranscription({ sdp: "v=0\r\n", hint: "Newton" }, async (url, options) => {
    request = { url, options }; return { ok: true, text: async () => "v=0\r\nanswer" };
  });
  assert.deepEqual(result, { sdp: "v=0\r\nanswer" });
  assert.match(request.url, /realtime\/calls$/);
  const session = JSON.parse(request.options.body.get("session"));
  assert.equal(session.type, "transcription");
  assert.equal(session.audio.input.transcription.model, "gpt-live-transcribe");
  assert.deepEqual(session.audio.input.transcription.languages, ["en"]);
  assert.equal(session.audio.input.turn_detection, null);
  assert.match(session.audio.input.transcription.prompt, /Newton/);
  assert.ok(request.options.signal);
});

test("live connection rejects invalid offers and surfaces provider errors", async () => {
  await assert.rejects(() => connectLiveTranscription({ sdp: "not SDP" }), e => e.status === 400);
  await assert.rejects(() => connectLiveTranscription({ sdp: "v=0" }, async () => ({ ok: false, status: 401 })), e => e.status === 503);
});

test("transcribe surfaces upstream failure as VoiceUnavailable, not a crash", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => transcribeAudio({ audio: Buffer.from("x").toString("base64") }, fetchImpl),
    error => error instanceof VoiceUnavailable && /500/.test(error.message),
  );
});

test("speak requires text and caps it at the TTS input limit", async () => {
  await assert.rejects(() => synthesizeSpeech({ text: "  " }), error => error.status === 400);

  let payload;
  const fetchImpl = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode("mp3-bytes").buffer };
  };
  await synthesizeSpeech({ text: "a".repeat(MAX_TTS_CHARS + 500) }, fetchImpl);
  assert.equal(payload.input.length, MAX_TTS_CHARS);
  assert.equal(payload.voice, TTS_VOICE);
});

test("speak returns base64 mp3 with persona-driven read-aloud instructions", async () => {
  let payload;
  const fetchImpl = async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode("spoken").buffer };
  };

  const result = await synthesizeSpeech(
    { text: "ΣF = ma, so a = F/m.", persona: "Dr. Newton", subject: "physics" },
    fetchImpl,
  );

  assert.equal(result.mime, "audio/mpeg");
  assert.equal(Buffer.from(result.audio, "base64").toString(), "spoken");
  assert.match(payload.instructions, /Dr\. Newton/);
  assert.match(payload.instructions, /physics/);
});

test("prompt builders keep course jargon in the loop", () => {
  assert.match(buildTranscribePrompt("physics"), /Topic: physics/);
  assert.match(buildTranscribePrompt(), /sigma F equals m a/);
  assert.match(buildTtsInstructions(), /the tutor/);
});

test("speakableMath: center of mass with nested subscripts — the reported leak", () => {
  const spoken = speakableMath("$$x_{cm} = \\frac{\\sum_{i} m_i x_i}{\\sum_{i} m_i}$$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /the sum of/);
  assert.match(spoken, /over/);
  assert.match(spoken, /equals/);
});

test("speakableMath: nested fractions resolve inside-out", () => {
  const spoken = speakableMath("\\frac{1}{\\frac{a}{b}}");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /1 over\s+a over b/);
});

test("speakableMath: kinetic energy reads like a professor", () => {
  const spoken = speakableMath("$E_k = \\frac{1}{2}mv^2$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /1 over 2/);
  assert.match(spoken, /squared/);
});

test("speakableMath: scientific notation speaks the negative exponent", () => {
  const spoken = speakableMath("$K_w = 1.0 \\times 10^{-14}$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /times 10 to the negative 14/);
});

test("speakableMath: ion charges are charges, not exponents", () => {
  const spoken = speakableMath("$Ca^{2+} + 2OH^- \\rightarrow Ca(OH)_2$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /2 plus/);
  assert.match(spoken, /minus/);
  assert.match(spoken, /goes to/);
  assert.doesNotMatch(spoken, /to the 2\s*\+|to the\s+plus/);
});

test("speakableMath: equilibrium arrow is spoken as equilibrium", () => {
  const spoken = speakableMath("$N_2 + 3H_2 \\rightleftharpoons 2NH_3$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /is in equilibrium with/);
});

test("speakableMath: thermo symbols — delta, text wrappers, log base", () => {
  const spoken = speakableMath(
    "$\\Delta G = \\Delta H - T\\Delta S$ and $pH = -\\log_{10} \\text{[H}^+\\text{]}$",
  );
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /delta G equals delta H/);
  assert.match(spoken, /log base 10 of/);
});

test("speakableMath: \\left \\right sizing never reaches the voice", () => {
  const spoken = speakableMath("$\\left(\\frac{P_1 V_1}{T_1}\\right) = \\left(\\frac{P_2 V_2}{T_2}\\right)$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /over/);
});

test("speakableMath: quadratic formula end-to-end", () => {
  const spoken = speakableMath("$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /plus or minus/);
  assert.match(spoken, /square root of/);
  assert.match(spoken, /squared/);
});

test("speakableMath: vectors and unit vectors are named, not spelled", () => {
  const spoken = speakableMath("$\\vec{F} = m\\vec{a}$ along $\\hat{i}$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /vector F/);
  assert.match(spoken, /i hat/);
});

test("speakableMath: money stays money, inline math stays math", () => {
  const spoken = speakableMath("**Nice!** That's $50 off the $1800. Now try $2x + 6 = 20$.");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /50 dollars/);
  assert.match(spoken, /1800 dollars/);
  assert.match(spoken, /2x \+ 6 equals 20/);
});

test("speakableMath: aligned environments become spoken clauses", () => {
  const spoken = speakableMath("$$\\begin{aligned} v &= v_0 + at \\\\ x &= x_0 + v_0 t \\end{aligned}$$");
  assertNoLatexArtifacts(spoken);
  assert.match(spoken, /v equals v naught \+ at/);
});

test("speakableMath: plain English passes through untouched", () => {
  const spoken = speakableMath("So you weight every position by how heavy the thing is there, then divide.");
  assert.equal(spoken, "So you weight every position by how heavy the thing is there, then divide.");
});
