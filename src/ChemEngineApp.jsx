import { MathLab } from "./MathLab.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  LOCAL_KEY,
  LEGACY_KEY,
  MODE_META,
  applyReview,
  buildQueue,
  createEmptyProgress,
  daysUntil,
  ensureCardState,
  getCardStage,
  getReviewMode,
  getWeakSpots,
  hasProgressData,
  isMastered,
  localRecallAssessment,
  markLogin,
  mergeProgress,
  normalizeProgress,
  toRemoteProgress,
  nextExam,
  examReadiness,
  inExamScope,
  EXAM_PREP_DAYS,
} from "./engine";
import { apiHeaders } from "./apiAuth";
import { VoiceCapture, splitForSpeech } from "./voiceCapture";

const LS = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const FONT_SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SF Mono', 'SFMono-Regular', monospace";
const C = {
  bgDeep: "var(--bg-deep)",
  bgCard: "var(--bg-card)",
  bgElevated: "var(--bg-elevated)",
  bgHover: "var(--bg-hover)",
  borderSubtle: "var(--border-subtle)",
  borderMedium: "var(--border-medium)",
  blue: "var(--accent-blue)",
  gold: "var(--accent-gold)",
  green: "var(--accent-green)",
  purple: "var(--accent-purple)",
  red: "var(--accent-red)",
  textPrimary: "var(--text-primary)",
  textSecondary: "var(--text-secondary)",
  textTertiary: "var(--text-tertiary)",
  blue12: "rgba(79, 140, 255, 0.12)",
  blue15: "rgba(79, 140, 255, 0.15)",
  blue22: "rgba(79, 140, 255, 0.22)",
  blue35: "rgba(79, 140, 255, 0.35)",
  gold12: "rgba(245, 166, 35, 0.12)",
  gold16: "rgba(245, 166, 35, 0.16)",
  gold18: "rgba(245, 166, 35, 0.18)",
  green12: "rgba(52, 211, 153, 0.12)",
  green18: "rgba(52, 211, 153, 0.18)",
  purple12: "rgba(167, 139, 250, 0.12)",
  purple18: "rgba(167, 139, 250, 0.18)",
  red12: "rgba(239, 68, 68, 0.12)",
  red18: "rgba(239, 68, 68, 0.18)",
};

const MODE_ACCENT = {
  write: C.blue,
  solve: C.green,
  teach: C.purple,
};

const MODE_SURFACE = {
  write: C.blue12,
  solve: C.green12,
  teach: C.purple12,
};

function modeAccent(mode) {
  return MODE_ACCENT[mode] || C.blue;
}

function feedbackSkin(verdict) {
  if (verdict === "CORRECT") {
    return {
      accent: C.green,
      borderColor: C.green18,
      background: `linear-gradient(180deg, ${C.green12} 0%, ${C.bgCard} 100%)`,
      boxShadow: "none",
      backgroundImage: [
        "radial-gradient(circle at 10% 16%, rgba(245,166,35,0.95) 0 2px, transparent 3px)",
        "radial-gradient(circle at 24% 10%, rgba(79,140,255,0.8) 0 2px, transparent 3px)",
        "radial-gradient(circle at 81% 14%, rgba(167,139,250,0.85) 0 2px, transparent 3px)",
        "radial-gradient(circle at 88% 26%, rgba(52,211,153,0.8) 0 2px, transparent 3px)",
      ].join(", "),
      animation: "winPulse .65s ease",
    };
  }

  if (verdict === "PARTIAL") {
    return {
      accent: C.gold,
      borderColor: C.gold18,
      background: `linear-gradient(180deg, ${C.gold12} 0%, ${C.bgCard} 100%)`,
      boxShadow: "none",
      backgroundImage: "none",
      animation: "gentlePulse .65s ease",
    };
  }

  return {
    accent: C.red,
    borderColor: C.red18,
    background: `linear-gradient(180deg, ${C.red12} 0%, ${C.bgCard} 100%)`,
    boxShadow: "none",
    backgroundImage: "none",
    animation: "gentlePulse .65s ease",
  };
}

function createStudyState() {
  return {
    answer: "",
    artifact: null,
    worked: null,
    workedLoading: false,
    loading: false,
    grading: false,
    feedback: null,
    error: "",
  };
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function verdictColor(verdict) {
  if (verdict === "CORRECT") return C.green;
  if (verdict === "PARTIAL") return C.gold;
  return C.red;
}

function formatAccuracy(avg) {
  if (!avg) return "--";
  return `${Math.round((avg / 5) * 100)}%`;
}

function formatNextReview(ts) {
  if (!ts) return "due now";
  const delta = Math.ceil((ts - Date.now()) / 864e5);
  if (delta <= 0) return "due now";
  if (delta === 1) return "1 day";
  return `${delta} days`;
}

function trimProgress(progress) {
  return {
    ...progress,
    gradeHistory: progress.gradeHistory.slice(-1000),
  };
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { reply: text };
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retry a couple of times before giving up: a single flaky request used to
// drop the app into "remote unknown" mode, and from there a blank device could
// mint a snapshot that outranked the server copy.
async function getProgressSnapshot(course = "chem", { attempts = 3 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`/api/progress?course=${encodeURIComponent(course)}`, { headers: apiHeaders() });
      const data = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(data.error || "Could not load progress.");
      }
      return data.progress || data;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastError || new Error("Could not load progress.");
}

async function putProgressSnapshot(progress, course = "chem", { reset = false } = {}) {
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: apiHeaders(JSON_HEADERS),
    body: JSON.stringify({ ...toRemoteProgress(progress), course, reset: Boolean(reset) }),
  });
  const data = await readResponseBody(response);
  if (!response.ok) {
    const error = new Error(data.error || "Could not save progress.");
    error.status = response.status;
    error.progress = data.progress || null;
    throw error;
  }
  return data;
}

async function listProgressHistory(course = "chem") {
  const response = await fetch(`/api/progress?course=${encodeURIComponent(course)}&history=list`, { headers: apiHeaders() });
  const data = await readResponseBody(response);
  if (!response.ok) throw new Error(data.error || "Could not load saved copies.");
  return Array.isArray(data.history) ? data.history : [];
}

async function restoreProgressSnapshot(course = "chem", id) {
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: apiHeaders(JSON_HEADERS),
    body: JSON.stringify({ course, restore: id }),
  });
  const data = await readResponseBody(response);
  if (!response.ok) throw new Error(data.error || "Could not restore.");
  return data.progress;
}

async function postChatAction(payload) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: apiHeaders(JSON_HEADERS),
    body: JSON.stringify(payload),
  });
  const data = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(data.error || data.reply || "Dr. Chem hit a wall.");
  }
  return data;
}

async function streamChat(payload, handlers) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: apiHeaders({
      ...JSON_HEADERS,
      Accept: "text/event-stream",
    }),
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    const data = await readResponseBody(response);
    throw new Error(data.error || data.reply || "Chat request failed.");
  }

  if (!response.body || !contentType.includes("text/event-stream")) {
    const data = await readResponseBody(response);
    if (data.reply) handlers.onToken?.(data.reply);
    handlers.onDone?.();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emit = rawEvent => {
    const lines = rawEvent.split("\n");
    let eventName = "message";
    const dataLines = [];

    lines.forEach(line => {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    });

    if (!dataLines.length) return;

    let payloadData = dataLines.join("\n");
    try {
      payloadData = JSON.parse(payloadData);
    } catch {}

    if (eventName === "token") {
      handlers.onToken?.(payloadData.text || "");
      return;
    }

    if (eventName === "error") {
      throw new Error(payloadData.error || "Streaming error.");
    }

    if (eventName === "done") {
      handlers.onDone?.(payloadData);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let splitIndex = buffer.indexOf("\n\n");

    while (splitIndex >= 0) {
      const eventChunk = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + 2);
      if (eventChunk) emit(eventChunk);
      splitIndex = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) emit(buffer.trim());
}

async function postVoiceAction(payload, signal) {
  const response = await fetch("/api/voice", {
    signal: signal || AbortSignal.timeout(30_000),
    method: "POST",
    headers: apiHeaders(JSON_HEADERS),
    body: JSON.stringify(payload),
  });
  const data = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(data.error || "Voice request failed.");
  }
  return data;
}


// Tutor replies carry LaTeX between $...$ / $$...$$ (and \(...\) / \[...\]).
// On screen it should be a drawn equation, never raw markup — the raw string
// still goes to /api/voice, where speakableMath turns it into spoken English.
// Inline $ must hug its content and not be followed by a digit, so "$50 off
// the $1800" stays money instead of becoming an accidental formula.
const MATH_SPLIT =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$(?=\S)[^$\n]*?(?<=\S)\$(?!\d))/g;

function renderKatex(tex, displayMode) {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: "ignore" });
  } catch {
    return null; // half-streamed or hopeless input falls back to plain text
  }
}

function MessageBody({ content }) {
  const parts = `${content || ""}`.split(MATH_SPLIT);
  return parts.map((part, index) => {
    if (!part) return null;
    const display = part.startsWith("$$") || part.startsWith("\\[");
    const inline = !display && (part.startsWith("\\(") || (part.startsWith("$") && part.endsWith("$")));
    if (display || inline) {
      const tex = part
        .replace(/^\$\$|^\\\[|^\\\(|^\$/, "")
        .replace(/\$\$$|\\\]$|\\\)$|\$$/, "");
      const html = renderKatex(tex, display);
      if (html !== null) {
        return (
          <span
            key={index}
            style={display ? S.chatMathBlock : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      }
    }
    return (
      <span key={index} style={S.chatProse}>
        {part}
      </span>
    );
  });
}

// Client-side TTS cache: the serverless API is stateless, so repeated
// hear-it taps on the same formula would otherwise pay for synthesis twice.
// Photos of problems ride along with a chat turn as image blocks. A phone
// photo is 3–12 MB; the tutor reads a 1568px JPEG just as well, the request
// stays far under Vercel's 4.5 MB body cap, and every later turn that carries
// the image costs a fraction of the tokens.
const MAX_CHAT_IMAGES = 4;
const IMAGE_MAX_EDGE = 1568;
const IMAGE_JPEG_QUALITY = 0.88;

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't read ${file.name || "that image"} — try a JPEG or PNG.`)); };
    image.src = url;
  });
}

async function prepareChatImage(file) {
  const image = await loadImageElement(file);
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PNG screenshots would otherwise go black
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || "photo",
    mediaType: "image/jpeg",
    dataUrl,
    data: dataUrl.split(",")[1] || "",
  };
}

function imageFilesFrom(dataTransferOrList) {
  const out = [];
  const items = dataTransferOrList?.items;
  if (items) {
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
    if (out.length) return out;
  }
  for (const file of dataTransferOrList?.files || dataTransferOrList || []) {
    if (file && `${file.type}`.startsWith("image/")) out.push(file);
  }
  return out;
}

// Chat transcripts are saved server-side (one row per message) so a reload
// keeps the conversation and the tutor can look back over weeks of chats.
// A session is one tab: its id lives in sessionStorage.
function chatSessionIdFor(storageKey) {
  const key = `${storageKey}-chat-session`;
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return `s-${Date.now().toString(36)}`;
  }
}

async function fetchChatLog(course, sessionId) {
  const response = await fetch(
    `/api/chats?course=${encodeURIComponent(course)}&session=${encodeURIComponent(sessionId)}&limit=80`,
    { headers: apiHeaders() },
  );
  const data = await readResponseBody(response);
  if (!response.ok) throw new Error(data.error || "Could not load the chat.");
  return Array.isArray(data.messages) ? data.messages : [];
}

// Fire-and-forget: a failed save never interrupts the conversation.
// The formula index rides along so the server can tag trouble spots against
// the same card ids the study engine grades — one taxonomy, not two.
function saveChatLog(course, sessionId, messages, { formulas = [], tutor = {} } = {}) {
  return fetch("/api/chats", {
    method: "POST",
    headers: apiHeaders(JSON_HEADERS),
    body: JSON.stringify({
      course,
      sessionId,
      messages,
      tutor: { persona: tutor.persona, subject: tutor.subject },
      formulas: formulas.map(f => ({ id: f.id, name: f.name, ch: f.ch })),
    }),
  }).catch(error => console.warn("chat log save failed:", error));
}

async function fetchTroubleSpots(course) {
  const response = await fetch(`/api/chats?course=${encodeURIComponent(course)}&issues=1&days=90`, { headers: apiHeaders() });
  const data = await readResponseBody(response);
  if (!response.ok) throw new Error(data.error || "Could not load trouble spots.");
  return Array.isArray(data.issues) ? data.issues : [];
}

const STRUGGLE_PROMPT = "Summarize where I've been struggling lately and what I should focus on this week.";

const TTS_CACHE = new Map();
const TTS_CACHE_MAX = 30;
// Let the speech model produce natural pacing; do not time-compress its output.
const TTS_PLAYBACK_RATE = 1;

// A/B ElevenLabs voices without a redeploy: leo.boundstate.ai/?voice=<voice_id>.
// No param → the server default.
const VOICE_OVERRIDE = (() => {
  try { return new URLSearchParams(window.location.search).get("voice") || undefined; }
  catch { return undefined; }
})();

// Lazily-built 0.1s silent WAV, played once on the first user gesture to "unlock"
// the reused audio element — mobile/iOS Safari blocks play() on any element that
// wasn't started inside a user gesture, which silently killed auto-read replies.
let _silentUrl = null;
function silentAudioUrl() {
  if (_silentUrl) return _silentUrl;
  const sr = 8000;
  const n = 800;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i += 1) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, n * 2, true);
  _silentUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return _silentUrl;
}

// Live level meter on the mic button while recording (a red halo that grows
// with the voice, so Leo can SEE whether the mic hears him). This is feedback,
// never a reason to discard quiet speech. Runs outside React state on purpose —
// 60 renders/s of a 3k-line app is not a meter.
function attachLevelMeter(stream, el) {
  let ctx = null;
  let raf = 0;
  let peak = 0;
  let trusted = false; // only judge silence if the audio graph actually ran
  let firstSoundAt = null; // when speech-level sound first appeared
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (ctx.state === "running") trusted = true;
      if (rms > peak) peak = rms;
      if (firstSoundAt === null && rms > 0.02) firstSoundAt = Date.now();
      if (el) el.style.boxShadow = `0 0 0 ${Math.min(14, Math.round(rms * 60))}px rgba(239, 68, 68, 0.35)`;
      raf = requestAnimationFrame(tick);
    };
    ctx.resume().catch(() => {});
    tick();
  } catch {}
  return {
    peak: () => peak,
    trusted: () => trusted,
    firstSoundAt: () => firstSoundAt,
    stop: () => {
      cancelAnimationFrame(raf);
      if (el) el.style.boxShadow = "";
      if (ctx) ctx.close().catch(() => {});
    },
  };
}

const micSupported =
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices) &&
  typeof window !== "undefined" &&
  Boolean(window.MediaRecorder);

// Push-to-talk button. Lives at module level on purpose: when it was defined
// inside the app component it was a brand-new component type on every render,
// so React unmounted and recreated the <button> the moment recording started
// (setMicState("recording") re-renders the app) — while the thumb was still on
// it. Touch browsers deliver the rest of that gesture to the original node, so
// the release never reached React and hold-to-talk silently left the mic open.
//
// Pointer capture + touch-action:none keep the whole gesture on this button: a
// thumb drifting a few pixels during a sentence no longer turns into a scroll
// that cancels the press. A cancelled gesture counts as a release.
//
// Keyboard activation (Enter/Space) arrives only as a click. It cannot be told
// apart by event.detail — Chromium's touch-synthesized clicks carry detail 0
// too, and treating those as keyboard presses cancelled every tap on Android —
// so a click is keyboard-only when no pointer touched the button first.
function MicButton({ micState, onMicDown, onMicUp, onMicClick, buttonRef, onTranscript, hint = null, disabled = false }) {
  const pointerSeenRef = useRef(false);
  if (!micSupported) return null;
  const label = micState === "opening" ? "Cancel microphone setup" : micState === "recording" ? "Stop recording and send" : micState === "busy" ? "Transcribing" : "Start microphone";
  return (
    <button ref={buttonRef} aria-label={label} aria-pressed={micState === "recording"}
      style={{ ...S.chatMic, ...(micState === "recording" ? S.chatMicLive : null) }}
      onPointerDown={event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        pointerSeenRef.current = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
        onMicDown(event, onTranscript, hint);
      }}
      onPointerUp={onMicUp}
      onPointerCancel={onMicUp}
      onClick={() => {
        if (pointerSeenRef.current) { pointerSeenRef.current = false; return; }
        onMicClick(onTranscript, hint);
      }}
      onContextMenu={event => event.preventDefault()}
      title="Tap to start, tap again to send. Or hold, wait for Listening, speak and release."
      disabled={disabled || micState === "busy"}>
      {micState === "busy" || micState === "opening" ? "…" : micState === "recording" ? "🔴" : "🎤"}
    </button>
  );
}

function modeAvailability(card, mode, online = true) {
  const safeCard = ensureCardState(card);

  if (mode === "write") {
    return { enabled: true, hint: "Start typed recall." };
  }

  if (!online) {
    return { enabled: false, hint: "This mode needs a connection." };
  }

  if (mode === "solve" && !safeCard.write.passedAt && !safeCard.solve.passedAt) {
    return { enabled: false, hint: "Pass Write It once first." };
  }

  if (mode === "teach" && safeCard.write.consecutiveCorrect < 3 && !safeCard.teach.passedAt) {
    return { enabled: false, hint: "Unlocks after 3 correct Write It recalls." };
  }

  return { enabled: true, hint: `Start ${MODE_META[mode].label}.` };
}

function ModeTrack({ card, compact = false, online = true, onSelect = null, currentMode = null }) {
  const safeCard = ensureCardState(card);
  const interactive = Boolean(onSelect) && !compact;

  return (
    <div style={compact ? S.mtCompact : S.mt}>
      {Object.entries(MODE_META).map(([mode, meta]) => {
        const passed = Boolean(safeCard[mode]?.passedAt);
        const availability = modeAvailability(safeCard, mode, online);
        const locked = !availability.enabled;
        const current = currentMode === mode;
        const accent = modeAccent(mode);
        const surface = MODE_SURFACE[mode] || C.blue12;
        const chipStyle = {
          ...S.modeChip,
          borderColor: locked ? C.borderSubtle : current ? accent : passed ? accent : C.borderMedium,
          color: locked ? C.textTertiary : current ? C.textPrimary : accent,
          background: locked ? C.bgCard : current ? surface : C.bgDeep,
          boxShadow: "none",
          opacity: locked ? 0.58 : 1,
        };

        if (!interactive) {
          return (
            <span key={mode} style={chipStyle} title={availability.hint}>
              {compact ? meta.short : meta.label}
            </span>
          );
        }

        return (
          <button
            key={mode}
            type="button"
            style={{
              ...chipStyle,
              ...S.modeChipButton,
              cursor: availability.enabled ? "pointer" : "not-allowed",
            }}
            disabled={!availability.enabled}
            title={availability.hint}
            onClick={() => onSelect(mode)}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}

export function ChemEngineApp({
  chapters,
  formulas,
  totalFormulas,
  debtStart,
  perFormula,
  // Pack-driven fields. Defaults reproduce the original chem app so nothing
  // changes when only the first five props are passed.
  brand = { title: "Chem Engine", logo: "⚛", subtitle: "leo · CH 121/123 · Dr. Nguyen · UAH" },
  exams = [{ label: "Exam 3", date: "2026-04-08" }, { label: "ACS Final", date: "2026-04-29" }],
  groups = [
    { key: "I", label: "CHEM I (Ch 1-10) — ACS Final Review" },
    { key: "II", label: "CHEM II (Ch 11-21) — Dr. Nguyen" },
  ],
  tutor = { persona: "Dr. Chem" },
  chatSeeds = ["Help me with Gibbs free energy", "Quiz me on Ch 9 gas laws", "Why is HF a weak acid?"],
  storageKey = LOCAL_KEY,
  legacyKey = LEGACY_KEY,
  course = "chem",
  rewardsEnabled = true,
}) {
  const [view, setView] = useState("home");
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [progress, setProgress] = useState(createEmptyProgress());
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [study, setStudy] = useState(createStudyState);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatImages, setChatImages] = useState([]);
  const [chatRestoring, setChatRestoring] = useState(false);
  const [troubleSpots, setTroubleSpots] = useState([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [voiceOn, setVoiceOn] = useState(() => Boolean(LS.get(`${storageKey}-voice`)));
  const [micState, setMicState] = useState("idle"); // idle | opening | recording | busy
  const [micDraft, setMicDraft] = useState("");
  const [micNote, setMicNote] = useState("");
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [flash, setFlash] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [syncState, setSyncState] = useState("loading");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyNote, setHistoryNote] = useState("");
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    partial: 0,
    incorrect: 0,
  });

  const progressRef = useRef(progress);
  const saveTimerRef = useRef(null);
  const flashTimerRef = useRef(null);
  const typingBufferRef = useRef("");
  const typingTimerRef = useRef(null);
  const scrollRef = useRef(null);
  const captureRef = useRef(null);
  const speechGenerationRef = useRef(0);
  const micHeldRef = useRef(false);
  const micDownAtRef = useRef(0);
  const replyAudioRef = useRef(null);
  const micButtonRef = useRef(null);
  const chatImagesRef = useRef([]); // read at send time so a mic transcript picks up a photo pasted mid-recording
  const chatFileRef = useRef(null);
  const chatSessionRef = useRef(null);
  const chatRestoredRef = useRef(false);
  // Set by the Reset button only: the one case a blank snapshot may be pushed.
  const pendingResetRef = useRef(false);
  // False until a GET /api/progress has succeeded this session.
  const remoteLoadedRef = useRef(false);

  const commitProgress = useCallback(nextProgress => {
    const trimmed = trimProgress({ ...nextProgress, userId: course === "uah-ma171" ? "uah-ma171-student" : "leo" });
    progressRef.current = trimmed;
    setProgress(trimmed);
  }, [course]);

  const loadHistory = useCallback(async () => {
    setHistoryBusy(true);
    try {
      setHistoryRows(await listProgressHistory(course));
    } catch (error) {
      setHistoryNote(error?.message || "Could not load saved copies.");
    } finally {
      setHistoryBusy(false);
    }
  }, [course]);

  const syncProgress = useCallback(
    async snapshot => {
      if (!online) {
        setSyncState("offline");
        return;
      }

      const reset = pendingResetRef.current;

      // Never push a snapshot with no earned work unless Leo pressed Reset.
      // Streak-only bookkeeping on a blank account stays local; it starts
      // syncing with the first graded card. This is what stops a fresh browser
      // from wiping the server copy.
      if (!reset && !hasProgressData(snapshot)) {
        setSyncState("local");
        return;
      }

      try {
        setSyncState("saving");
        const result = await putProgressSnapshot(snapshot, course, { reset });
        if (reset) {
          pendingResetRef.current = false;
          void loadHistory(); // the pre-reset copy is now archived — show it for undo
        }
        setProgress(current => {
          if (current.updatedAt !== snapshot.updatedAt) return current;
          const synced = {
            ...current,
            dirty: false,
            lastSyncedAt: Number(result.updatedAt) || Date.now(),
          };
          progressRef.current = synced;
          LS.set(storageKey, synced);
          return synced;
        });
        setSyncState("synced");
      } catch (error) {
        if (error?.status === 409 && error.progress) {
          // Server refused a blank overwrite and handed back the real copy: adopt it.
          const adopted = {
            ...normalizeProgress(error.progress),
            dirty: false,
            lastSyncedAt: Date.now(),
          };
          progressRef.current = adopted;
          setProgress(adopted);
          LS.set(storageKey, adopted);
          setSyncState("synced");
          return;
        }
        setSyncState(typeof navigator !== "undefined" && navigator.onLine ? "error" : "offline");
      }
    },
    [online, course, storageKey, loadHistory],
  );

  useEffect(() => {
    progressRef.current = progress;
    if (ready) LS.set(storageKey, progress);
  }, [progress, ready]);

  useEffect(() => {
    const browserOnline = typeof navigator === "undefined" ? true : navigator.onLine;
    const localSnapshot = normalizeProgress(LS.get(storageKey) || (legacyKey ? LS.get(legacyKey) : null));

    progressRef.current = localSnapshot;
    setProgress(localSnapshot);
    LS.set(storageKey, localSnapshot);
    if (legacyKey) LS.del(legacyKey);
    setReady(true);
    setSyncState(browserOnline ? "loading" : "offline");

    let cancelled = false;
    let loadingRemote = false;

    const loadRemote = async () => {
      if (loadingRemote || remoteLoadedRef.current) return;
      loadingRemote = true;
      try {
        const remoteSnapshot = normalizeProgress(await getProgressSnapshot(course));
        if (cancelled) return;
        remoteLoadedRef.current = true;
        // mergeProgress: newest wins, but a copy with earned work always beats a blank one.
        const merged = markLogin(mergeProgress(progressRef.current, remoteSnapshot));
        progressRef.current = merged;
        setProgress(merged);
        LS.set(storageKey, merged);
        setSyncState(merged.dirty ? (browserOnline ? "pending" : "offline") : "synced");
      } catch {
        if (!cancelled) {
          // Remote unknown. Only bump login/streak (and so updatedAt) when the
          // local copy holds real work; a blank copy must not be minted "newer"
          // than whatever the server has.
          const local = progressRef.current;
          const fallback = hasProgressData(local) ? markLogin(local) : local;
          progressRef.current = fallback;
          setProgress(fallback);
          LS.set(storageKey, fallback);
          setSyncState(fallback.dirty ? (browserOnline ? "pending" : "offline") : (browserOnline ? "local" : "offline"));
        }
      } finally {
        loadingRemote = false;
        if (!cancelled) setHydrated(true);
      }
    };

    void loadRemote();

    const handleOnline = () => {
      setOnline(true);
      setSyncState(progressRef.current.dirty ? "pending" : "synced");
      // Retry the initial load if it never succeeded (e.g. opened offline).
      void loadRemote();
    };

    const handleOffline = () => {
      setOnline(false);
      setSyncState("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearTimeout(saveTimerRef.current);
      clearTimeout(flashTimerRef.current);
      clearInterval(typingTimerRef.current);
      captureRef.current?.cancel();
      speechGenerationRef.current += 1;
      replyAudioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!ready || !hydrated || !progress.dirty) return;
    if (!online) {
      setSyncState("offline");
      return;
    }

    setSyncState("pending");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void syncProgress(progressRef.current);
    }, 5000);

    return () => clearTimeout(saveTimerRef.current);
  }, [progress.updatedAt, progress.dirty, ready, hydrated, online, syncProgress]);

  useEffect(() => {
    if (!ready || !hydrated || !online || !progress.dirty) return;
    void syncProgress(progressRef.current);
  }, [online, ready, hydrated, progress.dirty, syncProgress]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startTyping = useCallback(messageId => {
    if (typingTimerRef.current) return;

    typingTimerRef.current = window.setInterval(() => {
      const nextChunk = typingBufferRef.current.slice(0, 2);
      typingBufferRef.current = typingBufferRef.current.slice(2);

      if (!nextChunk) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
        return;
      }

      setMessages(current =>
        current.map(message =>
          message.id === messageId
            ? { ...message, content: `${message.content}${nextChunk}` }
            : message,
        ),
      );
    }, 18);
  }, []);

  const upcomingExam = nextExam(exams);
  const troubleIds = new Set(troubleSpots.map(spot => spot.formulaId).filter(Boolean));
  const queueOptions = { exam: upcomingExam, troubleIds };
  const readiness = examReadiness(formulas, progress.cardData, progress.gradeHistory, upcomingExam, troubleSpots, chapters);
  const queuePreview = buildQueue(
    formulas,
    null,
    progress.cardData,
    progress.gradeHistory,
    online,
    queueOptions,
  );
  const dueCount = queuePreview.filter(item => item.due).length;
  // Inside the prep window the weak-spot list and drill stay on the exam's
  // chapters; a chapter-9 miss can wait until after the 24th. Falls back to
  // everything when nothing in scope has been graded yet.
  const weakSpotsAll = getWeakSpots(formulas, progress.gradeHistory);
  const examWindow = Boolean(upcomingExam) && upcomingExam.days <= EXAM_PREP_DAYS;
  const weakInScope = examWindow ? weakSpotsAll.filter(item => inExamScope(item.formula, upcomingExam)) : weakSpotsAll;
  const weakSpotsScoped = examWindow && weakInScope.length > 0;
  const weakSpots = weakSpotsScoped ? weakInScope : weakSpotsAll;
  const examShortName = upcomingExam ? upcomingExam.label.replace(/\s*\(.*\)\s*$/, "") : "";
  const mastered = formulas.filter(formula => isMastered(progress.cardData[formula.id])).length;
  const solveReady = formulas.filter(formula => {
    const card = ensureCardState(progress.cardData[formula.id]);
    return getReviewMode(card, online) === "solve";
  }).length;
  const teachReady = formulas.filter(formula => {
    const card = ensureCardState(progress.cardData[formula.id]);
    return getReviewMode(card, online) === "teach";
  }).length;
  const debt = Math.max(0, debtStart - mastered * perFormula);
  const examCountdowns = exams.map(exam => ({ ...exam, days: daysUntil(exam.date) }));
  const exam3days = examCountdowns[0] ? examCountdowns[0].days : 0;
  const finalDays = examCountdowns.length ? examCountdowns[examCountdowns.length - 1].days : 0;

  const currentItem = queue[currentIndex];
  const currentFormula = currentItem?.formula || null;
  const currentMode = currentItem?.mode || "write";
  const currentCard = currentFormula ? ensureCardState(progress.cardData[currentFormula.id]) : ensureCardState();
  const currentChapter = currentFormula ? chapters.find(chapter => chapter.n === currentFormula.ch) : null;

  const queueForDisplay = chapter => {
    const ranked = buildQueue(formulas, chapter, progress.cardData, progress.gradeHistory, online, queueOptions);
    const due = ranked.filter(item => item.due);
    const selected = due.length ? due : ranked.slice(0, 12);
    return course === "uah-ma171" ? selected.slice(0, 12) : selected;
  };

  const launchSession = useCallback(items => {
    if (!items.length) return;
    setQueue(items);
    setCurrentIndex(0);
    setStudy(createStudyState());
    setSessionStats({ correct: 0, partial: 0, incorrect: 0 });
    setView("study");
  }, []);

  const startStudyAll = useCallback(() => {
    launchSession(queueForDisplay(null));
  }, [launchSession, progress.cardData, progress.gradeHistory, online]);

  const startChapterStudy = useCallback(
    chapter => {
      launchSession(queueForDisplay(chapter));
    },
    [launchSession, progress.cardData, progress.gradeHistory, online],
  );

  const startWeakSpotDrill = useCallback(() => {
    const ids = new Set(weakSpots.map(item => item.id));
    const ranked = buildQueue(
      formulas,
      null,
      progress.cardData,
      progress.gradeHistory,
      online,
      queueOptions,
    ).filter(item => ids.has(item.formula.id));
    launchSession(ranked.slice(0, 12));
  }, [weakSpots, launchSession, formulas, progress.cardData, progress.gradeHistory, online, upcomingExam, troubleSpots]);

  // Exam prep: only cards in the next exam's chapters, unmastered first,
  // trouble spots and weak spots bumped by the queue scoring.
  const startExamPrep = useCallback(() => {
    const ranked = buildQueue(formulas, null, progress.cardData, progress.gradeHistory, online, queueOptions)
      .filter(item => item.examScope);
    const unmastered = ranked.filter(item => !isMastered(item.card));
    launchSession((unmastered.length ? unmastered : ranked).slice(0, 12));
  }, [launchSession, formulas, progress.cardData, progress.gradeHistory, online, upcomingExam, troubleSpots]);

  const showWorkedExample = useCallback(async () => {
    if (!currentFormula || study.worked || study.workedLoading) return;
    setStudy(current => ({ ...current, workedLoading: true }));
    try {
      const worked = await postChatAction({ course, tutor,
        action: "generate_worked",
        problem: study.artifact?.problem,
        formula: {
          id: currentFormula.id,
          name: currentFormula.name,
          formula: currentFormula.formula,
          meaning: currentFormula.meaning,
          chapter: currentFormula.ch,
        },
      });
      setStudy(current => ({ ...current, workedLoading: false, worked }));
    } catch (error) {
      setStudy(current => ({ ...current, workedLoading: false }));
      setMicNote(error.message || "Couldn't fetch a worked example — try the problem anyway.");
    }
  }, [currentFormula, study.artifact, study.worked, study.workedLoading]);

  const startFormulaMode = useCallback(
    (formula, mode) => {
      launchSession([
        {
          formula,
          mode,
          due: true,
          score: 999,
          card: ensureCardState(progress.cardData[formula.id]),
        },
      ]);
    },
    [launchSession, progress.cardData],
  );

  useEffect(() => {
    if (view !== "study" || !currentItem) return;

    let cancelled = false;
    setStudy(createStudyState());

    if (currentMode === "write") return undefined;

    setStudy(current => ({ ...current, loading: true }));

    (async () => {
      try {
        const action = currentMode === "solve" ? "generate_problem" : "generate_teach";
        const artifact = await postChatAction({ course, tutor,
          action,
          formula: {
            id: currentFormula.id,
            name: currentFormula.name,
            formula: currentFormula.formula,
            meaning: currentFormula.meaning,
            example: currentFormula.example,
            mathTip: currentFormula.mathTip,
            chapter: currentFormula.ch,
          },
        });

        if (cancelled) return;
        setStudy(current => ({
          ...current,
          loading: false,
          artifact,
        }));
      } catch (error) {
        if (cancelled) return;
        setStudy(current => ({
          ...current,
          loading: false,
          error: error.message || "Could not generate the verification prompt.",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [view, currentIndex, currentItem, currentMode, currentFormula]);

  const flashMastery = useCallback(() => {
    clearTimeout(flashTimerRef.current);
    setFlash(true);
    flashTimerRef.current = setTimeout(() => setFlash(false), 2000);
  }, []);

  const finalizeStudy = useCallback(
    (verdict, explanation) => {
      const result = applyReview(
        progressRef.current,
        currentFormula,
        currentMode,
        verdict,
        explanation,
      );

      commitProgress(result.progress);
      setStudy(current => ({
        ...current,
        grading: false,
        feedback: {
          verdict,
          explanation,
          quality: result.quality,
        },
      }));

      if (result.masteredNow) flashMastery();

      setSessionStats(current => ({
        correct: current.correct + (verdict === "CORRECT" ? 1 : 0),
        partial: current.partial + (verdict === "PARTIAL" ? 1 : 0),
        incorrect: current.incorrect + (verdict === "INCORRECT" ? 1 : 0),
      }));
    },
    [commitProgress, currentFormula, currentMode, flashMastery],
  );

  const submitStudy = useCallback(async () => {
    if (!currentItem || study.grading) return;

    if (!study.answer.trim()) {
      setStudy(current => ({ ...current, error: "Put something down before grading." }));
      return;
    }

    setStudy(current => ({ ...current, grading: true, error: "" }));

    try {
      if (currentMode === "write") {
        const local = localRecallAssessment(study.answer, currentFormula.formula);

        if (course !== "uah-ma171" && !local.needsAi) {
          finalizeStudy(local.verdict, local.explanation);
          return;
        }

        if (!online) {
          setStudy(current => ({
            ...current,
            grading: false,
            error: "This answer needs a tutor check. Reconnect and resubmit.",
          }));
          return;
        }

        const result = await postChatAction({ course, tutor,
          action: "grade_recall",
          formulaName: currentFormula.name,
          correctAnswer: currentFormula.formula,
          studentAnswer: study.answer,
        });

        finalizeStudy(result.grade || "INCORRECT", result.explanation || "No explanation returned.");
        return;
      }

      if (!online) {
        setStudy(current => ({
          ...current,
          grading: false,
          error: "AI-backed solve and teach checks need a connection.",
        }));
        return;
      }

      if (currentMode === "solve") {
        const result = await postChatAction({ course, tutor,
          action: "grade_problem",
          formula: {
            name: currentFormula.name,
            formula: currentFormula.formula,
          },
          problem: study.artifact?.problem,
          solution: study.artifact?.solution,
          correctAnswer: study.artifact?.correctAnswer || study.artifact?.finalAnswer,
          studentAnswer: study.answer,
        });

        finalizeStudy(result.grade || "INCORRECT", result.explanation || "No explanation returned.");
        return;
      }

      const result = await postChatAction({ course, tutor,
        action: "grade_teach",
        formula: {
          name: currentFormula.name,
          formula: currentFormula.formula,
          meaning: currentFormula.meaning,
        },
        scenario: study.artifact?.scenario,
        rubric: study.artifact?.rubric,
        studentAnswer: study.answer,
      });

      finalizeStudy(result.grade || "INCORRECT", result.explanation || "No explanation returned.");
    } catch (error) {
      setStudy(current => ({
        ...current,
        grading: false,
        error: error.message || "Grading failed.",
      }));
    }
  }, [
    currentFormula,
    currentItem,
    currentMode,
    finalizeStudy,
    online,
    study.answer,
    study.artifact,
    study.grading,
  ]);

  const revealAsMiss = useCallback(() => {
    if (!currentItem || study.grading) return;
    finalizeStudy("INCORRECT", "Revealed before completing the verification.");
  }, [currentItem, study.grading, finalizeStudy]);

  const moveToNextCard = useCallback(() => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex(index => index + 1);
      return;
    }
    setView("done");
  }, [currentIndex, queue.length]);

  const downgradeToWrite = useCallback(() => {
    setQueue(current =>
      current.map((item, index) =>
        index === currentIndex ? { ...item, mode: "write" } : item,
      ),
    );
  }, [currentIndex]);

  // Spoken audio is a bonus everywhere — a broken speaker never blocks
  // studying, so failures here are silent and the text stands on its own.
  // Unlock the reused audio element on the first user gesture so async auto-read
  // replies can play on mobile/iOS Safari (which blocks play() outside a gesture).
  useEffect(() => {
    const unlock = () => {
      const audio = replyAudioRef.current || (replyAudioRef.current = new Audio());
      audio.src = silentAudioUrl();
      audio
        .play()
        .then(() => { try { audio.pause(); audio.currentTime = 0; } catch {} })
        .catch(() => {});
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("touchend", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);

  const speakAloud = useCallback(
    async text => {
      const clean = `${text || ""}`.trim();
      if (!clean) return;
      const generation = ++speechGenerationRef.current;
      const fetchSrc = async chunk => {
        const cacheKey = `${tutor.persona}:${VOICE_OVERRIDE || ""}:${chunk}`;
        const cached = TTS_CACHE.get(cacheKey);
        if (cached) return cached;
        const data = await postVoiceAction({
          action: "speak",
          text: chunk,
          persona: tutor.persona,
          subject: tutor.subject,
          voiceId: VOICE_OVERRIDE,
        });
        if (!data.audio) return null;
        const src = `data:${data.mime || "audio/mpeg"};base64,${data.audio}`;
        TTS_CACHE.set(cacheKey, src);
        if (TTS_CACHE.size > TTS_CACHE_MAX) TTS_CACHE.delete(TTS_CACHE.keys().next().value);
        return src;
      };
      try {
        // Reuse the one element unlocked on first tap — a fresh new Audio() per
        // reply is blocked by iOS Safari's autoplay policy (silent no-op).
        const audio = replyAudioRef.current || (replyAudioRef.current = new Audio());
        const chunks = splitForSpeech(clean);
        let next = fetchSrc(chunks[0]);
        for (let i = 0; i < chunks.length; i += 1) {
          const src = await next;
          if (generation !== speechGenerationRef.current) return;
          next = i + 1 < chunks.length ? fetchSrc(chunks[i + 1]) : null; // fetch ahead while this one plays
          if (!src) continue;
          try { audio.pause(); } catch {}
          audio.src = src;
          audio.preservesPitch = true;
          audio.playbackRate = TTS_PLAYBACK_RATE;
          await audio.play();
          await new Promise(resolve => {
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.onpause = resolve; // an external pause (new reply, mic opened) must not hang the loop
          });
          audio.onended = audio.onerror = audio.onpause = null;
        }
      } catch {
        if (generation === speechGenerationRef.current) setMicNote("The spoken reply could not play. The answer is still on screen; check sound permissions and try again.");
      }
    },
    [tutor],
  );

  // overrideText carries a mic transcript (release = said it, submits itself);
  // button/Enter events fall through to the typed input.
  const sendChat = useCallback(async (overrideText = null, { spoken = false, report = null } = {}) => {
    const text = (typeof overrideText === "string" ? overrideText : chatInput).trim();
    const images = chatImagesRef.current;
    if ((!text && !images.length) || chatBusy) return;
    if (!chatSessionRef.current) chatSessionRef.current = chatSessionIdFor(storageKey);
    const sessionId = chatSessionRef.current;
    const sentAt = Date.now();
    const userLog = { role: "user", content: text, hasPhoto: images.length > 0, ts: sentAt };
    const logTurn = reply =>
      void saveChatLog(
        course,
        sessionId,
        reply ? [userLog, { role: "assistant", content: reply, ts: Date.now() }] : [userLog],
        { formulas, tutor },
      );
    const assistantId = makeId("assistant");
    const conversation = [...messages, { id: makeId("user"), role: "user", content: text, images }];
    const payload = {
      action: "chat",
      course,
      ...(report ? { report } : {}),
      messages: conversation.map(message => ({
        role: message.role,
        content: message.content,
        ...(message.images?.length
          ? { images: message.images.map(image => ({ media_type: image.mediaType, data: image.data })) }
          : {}),
      })),
      debt,
      exam3days,
      finalDays,
      tutor,
      exams: examCountdowns,
      weaknesses: weakSpots.slice(0, 6).map(item => ({
        name: item.formula.name,
        formula: item.formula.formula,
        avg: item.avg || 0,
        missed: item.misses || 0,
      })),
    };

    if (typeof overrideText !== "string") setChatInput("");
    chatImagesRef.current = [];
    setChatImages([]);
    setMessages([
      ...conversation,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      },
    ]);
    setChatBusy(true);
    typingBufferRef.current = "";

    let sawToken = false;
    let fullReply = "";
    const wantSpokenReply = spoken || voiceOn;

    try {
      await streamChat(payload, {
          onToken: token => {
            if (!token) return;
            sawToken = true;
            fullReply += token;
            typingBufferRef.current += token;
            startTyping(assistantId);
          },
          onDone: () => {
            setMessages(current =>
              current.map(message =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: sawToken ? message.content : "Brain hiccup. Try again?",
                      streaming: false,
                    }
                  : message,
              ),
            );
          },
        });
      logTurn(sawToken ? fullReply : "");
      if (wantSpokenReply && sawToken) void speakAloud(fullReply);
    } catch (error) {
      if (!sawToken) {
        try {
          const fallback = await postChatAction(payload);
          const reply = fallback.reply || fallback.text || "";
          if (reply) {
            setMessages(current =>
              current.map(message =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: reply,
                      streaming: false,
                    }
                  : message,
              ),
            );
            logTurn(reply);
            if (wantSpokenReply) void speakAloud(reply);
            return;
          }
        } catch {}
      }
      logTurn(sawToken ? fullReply : "");

      setMessages(current =>
        current.map(message =>
          message.id === assistantId
            ? {
                ...message,
                content: error.message || "Connection dropped.",
                streaming: false,
              }
            : message,
        ),
      );
    } finally {
      setChatBusy(false);
    }
  }, [
    chatBusy,
    chatInput,
    course,
    storageKey,
    formulas,
    debt,
    exam3days,
    finalDays,
    tutor,
    examCountdowns,
    messages,
    speakAloud,
    startTyping,
    voiceOn,
    weakSpots,
  ]);

  if (!captureRef.current) {
    captureRef.current = new VoiceCapture({
      post: postVoiceAction, onState: setMicState, onDraft: setMicDraft, onNote: setMicNote,
      meter: stream => attachLevelMeter(stream, micButtonRef.current),
    });
  }
  const startMic = useCallback((onTranscript, hint) => {
    speechGenerationRef.current += 1;
    replyAudioRef.current?.pause();
    void captureRef.current.start({ onResult: onTranscript,
      hint: hint || `${tutor.subject || "science"} — ${tutor.course || ""}` });
  }, [tutor]);
  const onMicClick = useCallback((onTranscript, hint, cancel = false) => {
    const capture = captureRef.current;
    if (cancel || capture.session?.state === "opening") { capture.cancel(); return; }
    if (capture.session) { void capture.stop(); return; }
    startMic(onTranscript, hint);
  }, [startMic]);
  const onMicDown = useCallback((event, onTranscript, hint) => {
    event.preventDefault();
    if (captureRef.current.session) { onMicClick(onTranscript, hint); return; }
    micHeldRef.current = true;
    micDownAtRef.current = Date.now();
    startMic(onTranscript, hint);
  }, [onMicClick, startMic]);
  const onMicUp = useCallback(() => {
    if (!micHeldRef.current) return;
    micHeldRef.current = false;
    const session = captureRef.current.session;
    // Released while the mic was still being acquired (permission prompt, slow
    // device): there is nothing to send yet. Let it open in tap mode — the
    // note tells him to tap Stop — instead of cancelling and scolding.
    if (!session || session.state === "opening") return;
    if (Date.now() - micDownAtRef.current > 600) void captureRef.current.stop();
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceOn(current => {
      const next = !current;
      LS.set(`${storageKey}-voice`, next);
      if (!next) { speechGenerationRef.current += 1; replyAudioRef.current?.pause(); }
      return next;
    });
  }, [storageKey]);

  const addChatImages = useCallback(async files => {
    const room = MAX_CHAT_IMAGES - chatImagesRef.current.length;
    if (room <= 0) { setMicNote(`Up to ${MAX_CHAT_IMAGES} photos per message — send these first.`); return; }
    const picked = files.slice(0, room);
    if (!picked.length) return;
    try {
      const prepared = [];
      for (const file of picked) prepared.push(await prepareChatImage(file));
      chatImagesRef.current = [...chatImagesRef.current, ...prepared];
      setChatImages(chatImagesRef.current);
      setMicNote("");
    } catch (error) {
      setMicNote(error.message || "Couldn't read that image.");
    }
  }, []);
  const removeChatImage = useCallback(id => {
    chatImagesRef.current = chatImagesRef.current.filter(image => image.id !== id);
    setChatImages(chatImagesRef.current);
  }, []);
  // Chat-tagged trouble spots feed the queue and the readiness panel. Refreshed
  // whenever Leo lands on the home screen, since chats since then may have
  // added tags.
  useEffect(() => {
    if (view !== "home") return undefined;
    let cancelled = false;
    fetchTroubleSpots(course)
      .then(spots => { if (!cancelled) setTroubleSpots(spots); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [view, course]);

  // First visit to the chat this tab: pull back whatever this session already
  // said, so a reload or a wander to another screen never wipes the thread.
  useEffect(() => {
    if (view !== "chat" || chatRestoredRef.current) return;
    chatRestoredRef.current = true;
    if (!chatSessionRef.current) chatSessionRef.current = chatSessionIdFor(storageKey);
    let cancelled = false;
    setChatRestoring(true);
    fetchChatLog(course, chatSessionRef.current)
      .then(saved => {
        if (cancelled || !saved.length) return;
        setMessages(current =>
          current.length
            ? current
            : saved.map(row => ({
                id: `log-${row.id}`,
                role: row.role,
                content: row.content,
                hadPhoto: row.hasPhoto,
              })),
        );
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChatRestoring(false); });
    return () => { cancelled = true; };
  }, [view, course, storageKey]);

  // Paste anywhere in the chat view — Leo shouldn't have to click the box first.
  useEffect(() => {
    if (view !== "chat") return undefined;
    const onPaste = event => {
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void addChatImages(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [view, addChatImages]);

  // Leaving a section shouldn't leave its audio talking over the next one,
  // or a stale mic error explaining a problem from two screens ago.
  useEffect(() => {
    speechGenerationRef.current += 1;
    replyAudioRef.current?.pause();
    captureRef.current?.cancel();
    micHeldRef.current = false;
  }, [view]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) { captureRef.current?.cancel("Recording cancelled when the page was hidden."); speechGenerationRef.current += 1; replyAudioRef.current?.pause(); }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  // Voice-on reads grading feedback aloud the moment it lands — the study
  // loop stays hands-free end to end (speak the answer, hear the verdict).
  useEffect(() => {
    if (!voiceOn || !study.feedback) return;
    const opener =
      study.feedback.verdict === "CORRECT"
        ? "Correct!"
        : study.feedback.verdict === "PARTIAL"
          ? "Partially right."
          : "Not quite.";
    void speakAloud(`${opener} ${study.feedback.explanation || ""}`);
  }, [study.feedback, voiceOn, speakAloud]);

  useEffect(() => {
    if (view !== "done" || !voiceOn) return;
    void speakAloud(
      `Session complete. ${queue.length} cards: ${sessionStats.correct} correct, ` +
        `${sessionStats.partial} partial, ${sessionStats.incorrect} missed. ` +
        (rewardsEnabled ? (debt ? `$${debt} still on the tab.` : "Tab cleared. Go celebrate.") : "Keep practicing the skills that need another look."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- speak once per session end, not on every stat identity change
  }, [view, voiceOn]);

  const resetAllProgress = useCallback(() => {
    if (!window.confirm("Reset ALL progress? This also wipes the saved copy on the server (a backup is kept in history).")) return;
    pendingResetRef.current = true;
    const reset = markLogin(createEmptyProgress());
    commitProgress(reset);
    setMessages([]);
    setQueue([]);
    setCurrentIndex(0);
    setStudy(createStudyState());
    setSyncState(online ? "pending" : "offline");
    setHistoryOpen(true);
    setHistoryNote("Changed your mind? The copy from before this reset is listed here.");
  }, [commitProgress, online]);

  const restoreFromHistory = useCallback(
    async id => {
      if (!window.confirm("Restore this saved copy? The current copy is kept in history too.")) return;
      setHistoryBusy(true);
      try {
        const restored = await restoreProgressSnapshot(course, id);
        const adopted = { ...normalizeProgress(restored), dirty: false, lastSyncedAt: Date.now() };
        pendingResetRef.current = false;
        progressRef.current = adopted;
        setProgress(adopted);
        LS.set(storageKey, adopted);
        setMessages([]);
        setQueue([]);
        setCurrentIndex(0);
        setStudy(createStudyState());
        setSyncState("synced");
        setHistoryNote("Restored.");
        setHistoryRows(await listProgressHistory(course));
      } catch (error) {
        setHistoryNote(error?.message || "Restore failed.");
      } finally {
        setHistoryBusy(false);
      }
    },
    [course, storageKey],
  );

  const toggleHistory = useCallback(() => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) {
      setHistoryNote("");
      void loadHistory();
    }
  }, [historyOpen, loadHistory]);

  if (!ready) {
    return (
      <div style={S.loadingWrap}>
        <div style={S.loadingText}>loading...</div>
      </div>
    );
  }

  const SyncBadge = () => (
    <div style={S.syncRow}>
      <span style={S.syncPill}>{online ? syncState : "offline cache"}</span>
      <span style={S.syncMeta}>{progress.streakDays || 1} day streak</span>
    </div>
  );

  const VoiceToggle = () => (
    <button
      style={{ ...S.voiceToggle, ...(voiceOn ? S.voiceToggleOn : null) }}
      onClick={toggleVoice}
      title={voiceOn ? "Spoken replies and feedback are on — tap to mute" : "Tap to hear replies and feedback read aloud"}
    >
      {voiceOn ? "🔊 voice on" : "🔇 voice off"}
    </button>
  );

  const HearButton = ({ text, title = "Hear it" }) => (
    <button style={S.hearButton} onClick={() => void speakAloud(text)} title={title}>
      🔊
    </button>
  );

  const micProps = { micState, onMicDown, onMicUp, onMicClick, buttonRef: micButtonRef };
  const voiceStatus = <div style={S.micNote}>
    {micDraft && <div aria-live="polite"><strong>Hearing:</strong> {micDraft}</div>}
    {micNote && <div role="status">{micNote}</div>}
    {micState !== "idle" && <button onClick={() => { micHeldRef.current = false; captureRef.current.cancel(); }}>Cancel recording</button>}
  </div>;

  const Debt = ({ mini = false }) => {
    if (!rewardsEnabled) return <div style={mini ? S.debtMini : S.debtBox}>
      <div style={S.debtLabel}>{mastered} of {totalFormulas} skill checks complete</div>
      {!mini && <><div style={S.debtMeta}>Recall it · Solve it · Explain it. Keep reviewing to retain it.</div>
      <div style={S.progressTrack}><div style={{...S.progressFill, width: `${Math.round(mastered / totalFormulas * 100)}%`}} /></div></>}
    </div>;
    const pct = ((debtStart - debt) / debtStart) * 100;
    const earned = mastered * perFormula;

    if (mini) {
      return (
        <div
          style={{
            ...S.debtMini,
            ...(flash ? { animation: "debtPulse .8s ease" } : {}),
          }}
        >
          <span style={S.debtMiniAmount}>${earned}</span>
          <span style={S.debtMiniText}>earned</span>
          <span style={S.debtMiniGoal}>${debt} to go</span>
          {flash && <span style={S.debtMiniFlash}>-$20</span>}
        </div>
      );
    }

    return (
      <div
        style={{
          ...S.debtBox,
          ...(flash ? { animation: "debtPulse .8s ease" } : {}),
        }}
      >
        <div style={S.debtHead}>
          <div>
            <div style={S.debtLabel}>🏆 Earnings Tracker</div>
            <div style={S.debtMeta}>{mastered} mastered × ${perFormula} each</div>
          </div>
          <div style={S.debtAmountWrap}>
            <div style={S.debtAmount}>${debt}</div>
            <div style={S.debtGoal}>goal ${debtStart}</div>
          </div>
        </div>
        <div style={S.progressTrack}>
          <div style={{ ...S.progressFill, width: `${pct}%` }} />
        </div>
        <div style={S.debtFoot}>
          <span>${earned} earned</span>
          <span>${debt} to go</span>
        </div>
      </div>
    );
  };

  const Exams = () => {
    const titleStyle = days => ({
      color: days > 0 && days < 14 ? C.red : C.textPrimary,
      fontWeight: 700,
    });
    const fmt = date => {
      const d = new Date(date);
      return Number.isNaN(d.getTime())
        ? ""
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    return (
      <div style={S.examRow}>
        {examCountdowns
          .filter(exam => exam.days > 0)
          .map(exam => (
            <div key={exam.label} style={S.examItem}>
              <span style={titleStyle(exam.days)}>{exam.label}</span>
              <span style={{ ...S.examMeta, color: exam.days < 14 ? C.red : C.textTertiary }}>
                {fmt(exam.date)} · {exam.days}d
              </span>
            </div>
          ))}
      </div>
    );
  };

  const stats = [
    { key: "due", icon: "⏱", value: dueCount, label: "Due", iconStyle: S.statIconBlue },
    { key: "mastered", icon: "★", value: mastered, label: "Mastered", iconStyle: S.statIconGold },
    { key: "solve", icon: "∑", value: solveReady, label: "Solve", iconStyle: S.statIconGreen },
    { key: "teach", icon: "✦", value: teachReady, label: "Teach", iconStyle: S.statIconPurple },
  ];

  if (view === "home") {
    return (
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.logoRow}>
            <div style={S.logo}>{brand.logo}</div>
            <div>
              <div style={S.title}>{brand.title}</div>
              <div style={S.subtitle}>{brand.subtitle}</div>
            </div>
          </div>
          <div style={S.headerSide}>
            <SyncBadge />
            <VoiceToggle />
          </div>
        </div>

        <Debt />
        {course === "uah-ma171" && <MathLab chapters={chapters} formulas={formulas} cardData={progress.cardData} onStudy={startChapterStudy} onAsk={text => { setView("chat"); setChatInput(text); }} />}
        <Exams />

        {readiness && readiness.days <= 28 && (
          <div style={S.prepPanel}>
            <div style={S.prepHead}>
              <div>
                <div style={S.prepTitle}>🎯 Focus: {readiness.label}</div>
                <div style={S.prepMeta}>
                  {readiness.days} day{readiness.days === 1 ? "" : "s"} · {readiness.mastered} of {readiness.total} mastered
                  {readiness.remaining > 0 ? ` · pace: ${readiness.perDay} new a day + reviews` : " · all mastered — keep reviewing"}
                </div>
              </div>
              <div style={S.prepPct}>{readiness.pct}%</div>
            </div>
            <div style={S.prepBar}><div style={{ ...S.prepBarFill, width: `${readiness.pct}%` }} /></div>
            <div style={S.prepChapters}>
              {readiness.byChapter.map(chapter => (
                <button
                  key={chapter.n}
                  type="button"
                  style={{ ...S.prepChip, ...(chapter.mastered === chapter.total && chapter.total ? S.prepChipDone : null) }}
                  onClick={() => startChapterStudy(chapter.n)}
                  title={chapter.name}
                >
                  Ch {chapter.n} · {chapter.mastered}/{chapter.total}
                </button>
              ))}
            </div>
            {(readiness.trouble.length > 0 || readiness.weak.length > 0) && (
              <div style={S.prepTrouble}>
                {readiness.trouble.slice(0, 3).map(spot => (
                  <div key={spot.key || spot.topic} style={S.prepTroubleItem}>
                    💬 {spot.topic}{spot.count > 1 ? ` · ${spot.count}×` : ""}
                  </div>
                ))}
                {readiness.weak.slice(0, 3 - Math.min(3, readiness.trouble.length)).map(item => (
                  <div key={item.id} style={S.prepTroubleItem}>
                    📉 {item.formula.name} · missed {item.misses}×
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              style={{ ...S.primaryButton, ...S.primaryButtonHero, width: "100%", marginBottom: 0 }}
              onClick={startExamPrep}
            >
              Prep for {readiness.label.replace(/\s*\(.*\)\s*$/, "")} ({Math.min(12, Math.max(1, readiness.remaining || readiness.total))})
            </button>
          </div>
        )}

        <div style={S.statRow}>
          {stats.map(stat => (
            <div key={stat.key} style={S.statTile}>
              <div style={{ ...S.statIconWrap, ...stat.iconStyle }}>{stat.icon}</div>
              <div style={S.statValue}>{stat.value}</div>
              <div style={S.statLabel}>{stat.label}</div>
            </div>
          ))}
        </div>

        <div style={S.buttonRow}>
          <button
            style={{ ...S.primaryButton, ...S.primaryButtonHero }}
            onClick={startStudyAll}
          >
            Prove It ({course === "uah-ma171" ? Math.min(12, dueCount || 12) : dueCount || 12})
          </button>
          <button
            style={{ ...S.secondaryButtonHero }}
            onClick={() => setView("chat")}
          >
            {tutor.persona}
          </button>
        </div>

        {weakSpots.length > 0 && (
          <>
            <div style={S.section}>🎯 Trouble Spots{weakSpotsScoped ? ` · ${examShortName}` : ""}</div>
            {weakSpots.slice(0, 5).map(item => (
              <div key={item.id} style={S.weakItem}>
                <div>
                  <div style={S.weakName}>{item.formula.name}</div>
                  <div style={S.weakMeta}>
                    recall {formatAccuracy(item.writeAvg)} · solve {formatAccuracy(item.solveAvg)} · missed {item.misses}x
                  </div>
                </div>
                <ModeTrack card={progress.cardData[item.id]} compact />
              </div>
            ))}
            <button
              style={{ ...S.primaryButton, ...S.primaryButtonHero, width: "100%", marginBottom: 12 }}
              onClick={startWeakSpotDrill}
            >
              Drill Weak Spots{weakSpotsScoped ? ` (${examShortName})` : ""}
            </button>
          </>
        )}

        <div style={S.section}>Chapters</div>
        {groups.map(group => (
          <div key={group.key}>
            <div style={S.chapterHeading}>{group.label}</div>
            {chapters
              .filter(chapter => chapter.group === group.key)
              .map(chapter => {
                const chapterFormulas = formulas.filter(formula => formula.ch === chapter.n);
                const chapterMastered = chapterFormulas.filter(formula => isMastered(progress.cardData[formula.id])).length;
                const pct = chapterFormulas.length
                  ? Math.round((chapterMastered / chapterFormulas.length) * 100)
                  : 0;

                return (
                  <button
                    key={chapter.n}
                    style={S.chapterCard}
                    onClick={() => {
                      setSelectedChapter(chapter.n);
                      setView("topic");
                    }}
                  >
                    <div style={S.chapterContent}>
                      <div style={S.chapterTitleRow}>
                        <div style={S.chapterTitleWrap}>
                          <span
                            style={{
                              ...S.chapterStatus,
                              background: pct === 100 ? C.green12 : pct > 0 ? C.blue12 : C.bgElevated,
                              color: pct === 100 ? C.green : pct > 0 ? C.blue : C.textTertiary,
                            }}
                          >
                            {pct === 100 ? "✓" : pct > 0 ? "•" : "○"}
                          </span>
                          <div style={S.chapterTitle}>Ch {chapter.n}: {chapter.name}</div>
                        </div>
                        <div style={S.chapterSide}>
                          <div style={{ ...S.chapterCount, color: pct === 100 ? C.green : C.textSecondary }}>{chapterMastered}/{chapterFormulas.length}</div>
                          <div style={S.chapterChevron}>›</div>
                        </div>
                      </div>
                      <div style={S.chapterTrack}>
                        <div style={{ ...S.chapterFill, width: `${pct}%`, background: pct === 100 ? C.green : C.blue }} />
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        ))}

        <div style={S.dangerRow}>
          <button style={S.resetButton} onClick={resetAllProgress}>
            Reset All Progress
          </button>
          <button style={S.resetButton} onClick={toggleHistory}>
            {historyOpen ? "Hide saved copies" : "Saved copies (undo)"}
          </button>
        </div>
        {historyOpen && (
          <div style={S.historyList}>
            {historyNote ? <div style={S.historyNote}>{historyNote}</div> : null}
            {historyBusy && historyRows.length === 0 ? <div style={S.historyMeta}>loading…</div> : null}
            {!historyBusy && historyRows.length === 0 ? (
              <div style={S.historyMeta}>No saved copies yet. One is kept every time progress is overwritten.</div>
            ) : null}
            {historyRows.map(row => (
              <div key={row.id} style={S.historyRow}>
                <div>
                  <div style={S.historyTitle}>{new Date(row.updatedAt || row.replacedAt).toLocaleString()}</div>
                  <div style={S.historyMeta}>
                    {row.cards} cards · {row.grades} graded ·{" "}
                    {row.reason === "reset" ? "before a reset" : row.reason === "restore-replaced" ? "before a restore" : "before a save"}
                  </div>
                </div>
                <button style={S.historyRestore} onClick={() => restoreFromHistory(row.id)} disabled={historyBusy}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === "topic" && selectedChapter) {
    const chapter = chapters.find(item => item.n === selectedChapter);
    const chapterFormulas = formulas.filter(formula => formula.ch === selectedChapter);

    return (
      <div style={S.container}>
        <button style={S.backButton} onClick={() => setView("home")}>
          ← Back
        </button>
        <Debt mini />
        <div style={S.topicHeader}>
          <div style={S.topicTitle}>Ch {selectedChapter}: {chapter?.name}</div>
          <div style={S.topicMeta}>{chapterFormulas.length} {rewardsEnabled ? `formulas · $${chapterFormulas.length * perFormula} at stake` : "skills · build understanding through practice"}</div>
        </div>
        <button
          style={{ ...S.primaryButton, ...S.primaryButtonHero, width: "100%", marginBottom: 14 }}
          onClick={() => startChapterStudy(selectedChapter)}
        >
          Study Chapter {selectedChapter}
        </button>

        <div style={S.formulaList}>
          {chapterFormulas.map(formula => {
            const card = ensureCardState(progress.cardData[formula.id]);
            const stage = getCardStage(card);
            const stageColor =
              stage === "mastered" ? C.green : stage === "solve" ? C.blue : stage === "teach" ? C.purple : C.textTertiary;
            const stageBg =
              stage === "mastered" ? C.green12 : stage === "solve" ? C.blue12 : stage === "teach" ? C.purple12 : C.bgElevated;
            return (
              <div key={formula.id} style={S.formulaCard}>
                <div style={S.formulaHeader}>
                  <div>
                    <div style={S.formulaName}>{formula.name}</div>
                    <div style={S.formulaStageMeta}>
                      next: {MODE_META[getReviewMode(card, online)].label.toLowerCase()} · review {formatNextReview(card.nextReview)}
                    </div>
                  </div>
                  <div style={S.formulaHeaderSide}>
                    <HearButton
                      text={`${formula.name}. ${formula.formula}. ${formula.meaning}`}
                      title={`Hear ${formula.name} read aloud`}
                    />
                    <span style={{ ...S.stagePill, background: stageBg, color: stageColor }}>
                      {stage}
                    </span>
                  </div>
                </div>

                <ModeTrack
                  card={card}
                  online={online}
                  onSelect={mode => startFormulaMode(formula, mode)}
                />

                <div style={S.formulaText}>{formula.formula}</div>
                <div style={S.formulaMeaning}>{formula.meaning}</div>

                <details style={S.detailBlock}>
                  <summary style={S.detailSummary}>Example</summary>
                  <pre style={S.detailPre}>{formula.example}</pre>
                </details>
                <details style={S.detailBlock}>
                  <summary style={S.detailSummary}>Math Tip</summary>
                  <div style={S.tipBox}>{formula.mathTip}</div>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (view === "study") {
    if (!currentItem || !currentFormula) {
      setView("home");
      return null;
    }

    const percent = ((currentIndex + 1) / queue.length) * 100;
    const modeMeta = MODE_META[currentMode];
    const modeColor = modeAccent(currentMode);
    const feedbackTone = study.feedback ? feedbackSkin(study.feedback.verdict) : null;

    return (
      <div style={S.container}>
        <button style={S.backButton} onClick={() => setView("home")}>
          ← End
        </button>
        <Debt mini />

        <div style={S.sessionTrack}>
          <div style={{ ...S.sessionFill, width: `${percent}%` }} />
        </div>
        <div style={S.sessionMetaRow}>
          <span style={{ ...S.sessionMeta, marginBottom: 0 }}>{currentIndex + 1}/{queue.length}</span>
          <VoiceToggle />
        </div>

        <div
          style={{
            ...S.studyCard,
            borderColor: modeColor,
          }}
        >
          <div style={S.studyChapter}>Ch {currentFormula.ch}</div>
          <div style={{ ...S.studyMode, color: modeColor, background: MODE_SURFACE[currentMode] || C.blue12 }}>{modeMeta.label}</div>
          <div style={S.studyTitle}>{currentFormula.name}</div>
          <div style={S.studyPrompt}>{modeMeta.prompt}</div>

          <ModeTrack card={currentCard} currentMode={currentMode} />

          {currentMode === "write" && !study.feedback && (
            <>
              <div style={S.studyInputRow}>
                <input
                  style={{ ...S.studyInput, marginBottom: 0, width: "auto", flex: 1 }}
                  value={study.answer}
                  onChange={event => setStudy(current => ({ ...current, answer: event.target.value }))}
                  onKeyDown={event => event.key === "Enter" && submitStudy()}
                  placeholder="Type the formula exactly as you remember it"
                />
                <MicButton
                  {...micProps}
                  onTranscript={text => setStudy(current => ({ ...current, answer: text }))}
                  hint={`a ${tutor.subject || "science"} formula recited aloud: ${currentFormula.name}`}
                  disabled={study.grading}
                />
              </div>
              <div style={S.studyHint}>
                Local fuzzy match catches exact variants. If the answer is close, Sonnet breaks the tie.
              </div>
            </>
          )}

          {currentMode !== "write" && !study.feedback && (
            <>
              {study.loading && <div style={S.generatedBox}>{tutor.persona} is building the verification prompt...</div>}

              {!study.loading && study.error && (
                <div style={S.errorBox}>
                  <div>{study.error}</div>
                  <div style={S.errorActions}>
                    <button style={S.secondaryButton} onClick={downgradeToWrite}>
                      Switch To Write It
                    </button>
                  </div>
                </div>
              )}

              {!study.loading && !study.error && study.artifact && currentMode === "solve" && (
                <>
                  <div style={{ ...S.generatedBox, ...S.generatedBoxRow }}>
                    <div style={{ flex: 1 }}>{study.artifact.problem}</div>
                    <HearButton text={study.artifact.problem} title="Hear the problem read aloud" />
                  </div>
                  {study.worked ? (
                    <div style={S.workedBox}>
                      <div style={S.workedTitle}>Worked twin — study this, then do yours</div>
                      <div style={S.workedProblem}><MessageBody content={study.worked.problem} /></div>
                      <ol style={S.workedSteps}>
                        {study.worked.steps.map((step, index) => (
                          <li key={index} style={S.workedStep}><MessageBody content={step} /></li>
                        ))}
                      </ol>
                      {study.worked.answer && <div style={S.workedAnswer}><MessageBody content={`Answer: ${study.worked.answer}`} /></div>}
                      {study.worked.takeaway && <div style={S.workedTakeaway}><MessageBody content={study.worked.takeaway} /></div>}
                      <HearButton
                        text={[study.worked.problem, ...study.worked.steps, study.worked.answer, study.worked.takeaway].filter(Boolean).join(" ")}
                        title="Hear the worked example"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      style={{ ...S.secondaryButton, marginBottom: 10 }}
                      onClick={() => void showWorkedExample()}
                      disabled={study.workedLoading || study.grading}
                    >
                      {study.workedLoading ? "Working one out…" : "Show me one worked first"}
                    </button>
                  )}
                  <div style={S.studyInputRow}>
                    <input
                      style={{ ...S.studyInput, marginBottom: 0, width: "auto", flex: 1 }}
                      value={study.answer}
                      onChange={event => setStudy(current => ({ ...current, answer: event.target.value }))}
                      onKeyDown={event => event.key === "Enter" && submitStudy()}
                      placeholder="Type the final numerical answer"
                    />
                    <MicButton
                      {...micProps}
                      onTranscript={text => setStudy(current => ({ ...current, answer: text }))}
                      hint="a numerical answer with units, spoken aloud"
                      disabled={study.grading}
                    />
                  </div>
                </>
              )}

              {!study.loading && !study.error && study.artifact && currentMode === "teach" && (
                <>
                  <div style={{ ...S.generatedBox, ...S.generatedBoxRow }}>
                    <div style={{ flex: 1 }}>{study.artifact.scenario}</div>
                    <HearButton text={study.artifact.scenario} title="Hear the scenario read aloud" />
                  </div>
                  <textarea
                    style={S.studyArea}
                    value={study.answer}
                    onChange={event => setStudy(current => ({ ...current, answer: event.target.value }))}
                    placeholder="Explain it like you're teaching a friend who is smart but new to chemistry."
                  />
                  <div style={S.teachMicRow}>
                    <span style={S.teachMicLabel}>
                      Easier to say than type? Talk it through — the transcript adds on.
                    </span>
                    <MicButton
                      {...micProps}
                      onTranscript={text =>
                        setStudy(current => ({
                          ...current,
                          answer: current.answer ? `${current.answer.trim()} ${text}` : text,
                        }))
                      }
                      hint="a student explaining a concept out loud to a friend"
                      disabled={study.grading}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {study.error && currentMode === "write" && !study.feedback && <div style={S.errorBox}>{study.error}</div>}

          {!study.feedback && voiceStatus}

          {!study.feedback && (
            <div style={S.actionRow}>
              <button
                style={{
                  ...S.primaryButton,
                  flex: 1,
                  background: modeColor === C.blue
                    ? "linear-gradient(135deg, #4F8CFF, #3B6FE0)"
                    : `linear-gradient(135deg, ${modeColor}, ${modeColor})`,
                  boxShadow: modeColor === C.blue ? "0 4px 24px rgba(79, 140, 255, 0.15)" : "none",
                }}
                onClick={submitStudy}
                disabled={study.loading || study.grading}
              >
                {study.grading ? "Grading..." : "Submit"}
              </button>
              <button style={S.secondaryButton} onClick={revealAsMiss} disabled={study.grading}>
                Reveal & Take The Hit
              </button>
            </div>
          )}

          {study.feedback && (
            <div
              style={{
                ...S.feedbackWrap,
                borderColor: feedbackTone?.borderColor,
                background: feedbackTone?.background,
                backgroundImage: feedbackTone?.backgroundImage,
                boxShadow: feedbackTone?.boxShadow,
                animation: feedbackTone?.animation,
              }}
            >
              <div style={S.feedbackVerdictRow}>
                <div style={{ ...S.feedbackVerdict, marginBottom: 0, color: verdictColor(study.feedback.verdict) }}>
                  {study.feedback.verdict}
                </div>
                <HearButton
                  text={`${study.feedback.verdict}. ${study.feedback.explanation || ""}`}
                  title="Hear the verdict read aloud"
                />
              </div>
              <div style={S.feedbackText}>{study.feedback.explanation}</div>

              <div style={{ ...S.feedbackVerdictRow, marginBottom: 6 }}>
                <div style={{ ...S.referenceLabel, marginBottom: 0 }}>Reference</div>
                <HearButton
                  text={`${currentFormula.name}. ${currentFormula.formula}. ${currentFormula.meaning}`}
                  title="Hear the reference read aloud"
                />
              </div>
              <div style={S.referenceFormula}>{currentFormula.formula}</div>
              <div style={S.referenceMeaning}>{currentFormula.meaning}</div>

              {study.artifact?.solution && (
                <>
                  <div style={S.referenceLabel}>Worked solution</div>
                  <pre style={S.detailPre}>{study.artifact.solution}</pre>
                </>
              )}

              {study.artifact?.rubric && (
                <div style={S.tipBox}>Strong answer: {study.artifact.rubric}</div>
              )}

              <details style={S.detailBlock} open>
                <summary style={S.detailSummary}>Example</summary>
                <pre style={S.detailPre}>{currentFormula.example}</pre>
              </details>
              <div style={S.tipBox}>💡 {currentFormula.mathTip}</div>

              <button
                style={{ ...S.primaryButton, ...S.primaryButtonHot, marginTop: 14 }}
                onClick={moveToNextCard}
              >
                {currentIndex < queue.length - 1 ? "Next Card" : "Finish Session"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (view === "done") {
    return (
      <div style={S.container}>
        <div style={S.doneWrap}>
          <div style={S.doneEmoji}>🎉</div>
          <div style={S.doneTitle}>Verification Session Complete</div>
          <Debt />
          <div style={S.doneMeta}>
            Cards: {queue.length} · Correct: {sessionStats.correct} · Partial: {sessionStats.partial} · Incorrect: {sessionStats.incorrect}
          </div>
          <div style={S.doneMeta}>
            Completed: {mastered}/{totalFormulas}{rewardsEnabled && <> · Owed: <span style={{ color: debt ? C.textPrimary : C.green, fontWeight: 700 }}>${debt}</span></>}
          </div>
          <button
            style={{ ...S.primaryButton, ...S.primaryButtonHot, marginTop: 18 }}
            onClick={() => setView("home")}
          >
            Home
          </button>
        </div>
      </div>
    );
  }

  if (view === "chat") {
    return (
      <div
        style={S.container}
        onDragOver={event => { if (imageFilesFrom(event.dataTransfer).length || event.dataTransfer?.types?.includes("Files")) event.preventDefault(); }}
        onDrop={event => {
          const files = imageFilesFrom(event.dataTransfer);
          if (!files.length) return;
          event.preventDefault();
          void addChatImages(files);
        }}
      >
        <button style={S.backButton} onClick={() => setView("home")}>
          ← Back
        </button>
        <Debt mini />
        <Exams />

        <div style={S.chatHead}>
          <div>
            <div style={S.chatTitle}>⚗ {tutor.persona}</div>
            <div style={S.chatMeta}>Knows your weak spots and talks like a real tutor.</div>
          </div>
          <div style={S.chatHeadActions}>
            <button
              type="button"
              style={S.struggleButton}
              onClick={() => void sendChat(STRUGGLE_PROMPT, { report: "struggles" })}
              disabled={chatBusy || micState !== "idle"}
              title="Dr. reads the last 30 days of saved chats and names the recurring trouble spots"
            >
              📈 Where am I struggling?
            </button>
            <VoiceToggle />
          </div>
        </div>

        <div style={S.chatBox}>
          {messages.length === 0 && chatRestoring && <div style={S.chatEmpty}>Loading this chat…</div>}
          {messages.length === 0 && !chatRestoring && (
            <div style={S.chatEmpty}>
              <div style={S.chatEmptyEmoji}>🧪</div>
              {chatSeeds.map(seed => (
                <div key={seed} style={S.chatSeed}>"{seed}"</div>
              ))}
              {weakSpots.length > 0 && <div style={S.chatSeed}>"Target my weak spots"</div>}
            </div>
          )}

          {messages.map(message => (
            <div
              key={message.id}
              style={message.role === "user" ? S.chatUserRow : S.chatBotRow}
            >
              {message.role !== "user" && <div style={S.chatAvatar}>⚗</div>}
              <div
                style={
                  message.role === "user"
                    ? S.chatUserBubble
                    : {
                        ...S.chatBotBubble,
                        ...(message.streaming ? S.chatBotBubbleStreaming : null),
                      }
                }
              >
                {message.role !== "user" && <div style={S.chatBubbleLabel}>{tutor.persona}</div>}
                {message.hadPhoto && !message.images?.length ? <div style={S.chatPhotoChip}>📷 photo</div> : null}
                {message.images?.length ? (
                  <div style={S.chatBubbleImages}>
                    {message.images.map(image => (
                      <img key={image.id} src={image.dataUrl} alt="Photo of the problem" style={S.chatBubbleImage} />
                    ))}
                  </div>
                ) : null}
                {message.content ? (
                  <MessageBody content={message.content} />
                ) : message.streaming ? (
                  "typing..."
                ) : (
                  ""
                )}
              </div>
            </div>
          ))}

          <div ref={scrollRef} />
        </div>

        {chatImages.length > 0 && (
          <div style={S.chatAttachRow}>
            {chatImages.map(image => (
              <div key={image.id} style={S.chatThumbWrap}>
                <img src={image.dataUrl} alt={image.name} style={S.chatThumb} />
                <button
                  type="button"
                  style={S.chatThumbRemove}
                  onClick={() => removeChatImage(image.id)}
                  aria-label={`Remove ${image.name}`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            <span style={S.chatAttachHint}>Photo ready — add a question, or just send it.</span>
          </div>
        )}
        <div style={S.chatInputRow}>
          <input
            style={S.chatInput}
            value={chatInput}
            onChange={event => setChatInput(event.target.value)}
            onKeyDown={event => event.key === "Enter" && micState === "idle" && sendChat()}
            placeholder={chatImages.length ? "Ask about the photo (optional)..." : "Ask anything, or paste a photo of the problem..."}
          />
          <input
            ref={chatFileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={event => {
              void addChatImages(imageFilesFrom(event.target.files));
              event.target.value = "";
            }}
          />
          <button
            type="button"
            style={S.chatMic}
            onClick={() => chatFileRef.current?.click()}
            disabled={chatBusy}
            title="Attach a photo of the problem (or paste / drop one)"
            aria-label="Attach a photo of the problem"
          >
            📷
          </button>
          <MicButton
            {...micProps}
            onTranscript={text => void sendChat(text, { spoken: true })}
            disabled={chatBusy}
          />
          <button style={S.chatSend} onClick={() => sendChat()} disabled={chatBusy || micState !== "idle"}>
            →
          </button>
        </div>
        {voiceStatus}
      </div>
    );
  }

  return (
    <div style={S.container}>
      <button style={S.backButton} onClick={() => setView("home")}>
        ← Home
      </button>
    </div>
  );
}

const S = {
  container: {
    fontFamily: FONT_SANS,
    background: C.bgDeep,
    color: C.textPrimary,
    minHeight: "100vh",
    padding: "28px 20px 60px",
    maxWidth: 500,
    margin: "0 auto",
    boxSizing: "border-box",
  },
  loadingWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: C.bgDeep,
  },
  loadingText: {
    color: C.textSecondary,
    fontFamily: FONT_SANS,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 18,
  },
  logoRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
    color: C.blue,
    background: C.blue12,
    border: `1px solid ${C.blue22}`,
  },
  title: {
    fontSize: 21,
    fontWeight: 800,
    color: C.textPrimary,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
  },
  subtitle: {
    fontSize: 11,
    color: C.textTertiary,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginTop: 4,
  },
  syncRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
  },
  syncPill: {
    color: C.green,
    background: C.green12,
    fontSize: 10.5,
    fontWeight: 650,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    borderRadius: 999,
    padding: "4px 10px",
  },
  syncMeta: {
    fontSize: 11,
    color: C.textTertiary,
  },
  debtBox: {
    background: C.bgCard,
    border: `1px solid ${C.gold16}`,
    borderRadius: 14,
    padding: "16px 20px",
    marginBottom: 18,
    transition: "all 0.15s ease",
    boxShadow: "0 0 0 1px rgba(245, 166, 35, 0.12), 0 4px 28px rgba(245, 166, 35, 0.12)",
  },
  debtHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 14,
  },
  debtLabel: {
    color: C.gold,
    fontSize: 11.5,
    fontWeight: 650,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  debtMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 6,
    lineHeight: 1.5,
  },
  debtAmountWrap: {
    textAlign: "right",
  },
  debtAmount: {
    fontSize: 34,
    fontWeight: 800,
    color: C.gold,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  debtGoal: {
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 4,
  },
  progressTrack: {
    height: 5,
    background: C.bgDeep,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: C.gold,
    borderRadius: 999,
    transition: "width .5s",
  },
  debtFoot: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 10,
    fontSize: 11,
    color: C.textTertiary,
  },
  debtMini: {
    fontSize: 12,
    marginBottom: 12,
    padding: "10px 12px",
    background: C.bgCard,
    borderRadius: 14,
    border: `1px solid ${C.gold16}`,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  debtMiniAmount: {
    color: C.gold,
    fontWeight: 700,
    fontSize: 16,
  },
  debtMiniText: {
    color: C.textSecondary,
  },
  debtMiniGoal: {
    color: C.textTertiary,
    marginLeft: "auto",
    fontSize: 11,
  },
  debtMiniFlash: {
    color: C.green,
    fontWeight: 700,
    marginLeft: 8,
  },
  examRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
    marginBottom: 18,
  },
  examItem: {
    minWidth: 0,
    flexWrap: "wrap",
    gap: 6,
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 14,
    padding: "14px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    minHeight: 62,
    transition: "all 0.15s ease",
  },
  examMeta: {
    color: C.textTertiary,
    fontSize: 11,
  },
  prepPanel: {
    background: C.bgCard,
    border: `1px solid ${C.gold18}`,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
  },
  prepHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  prepTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: C.textPrimary,
  },
  prepMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 3,
    lineHeight: 1.5,
  },
  prepPct: {
    fontSize: 22,
    fontWeight: 800,
    color: C.gold,
    fontFamily: "'JetBrains Mono', monospace",
  },
  prepBar: {
    height: 8,
    borderRadius: 4,
    background: C.bgElevated,
    overflow: "hidden",
    marginBottom: 12,
  },
  prepBarFill: {
    height: "100%",
    background: C.gold,
    borderRadius: 4,
    transition: "width .4s ease",
  },
  prepChapters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  prepChip: {
    background: C.bgElevated,
    border: `1px solid ${C.borderMedium}`,
    borderRadius: 999,
    padding: "5px 10px",
    color: C.textPrimary,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "'JetBrains Mono', monospace",
  },
  prepChipDone: {
    background: C.green12,
    border: `1px solid ${C.green18}`,
    color: C.green,
  },
  prepTrouble: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 12,
  },
  prepTroubleItem: {
    fontSize: 13,
    color: C.textSecondary,
  },
  workedBox: {
    background: C.bgElevated,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    fontSize: 14,
    lineHeight: 1.6,
  },
  workedTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color: C.gold,
    marginBottom: 8,
  },
  workedProblem: {
    marginBottom: 8,
    color: C.textPrimary,
  },
  workedSteps: {
    margin: "0 0 8px 18px",
    padding: 0,
  },
  workedStep: {
    marginBottom: 6,
    color: C.textPrimary,
  },
  workedAnswer: {
    fontWeight: 700,
    color: C.textPrimary,
    marginBottom: 6,
  },
  workedTakeaway: {
    color: C.textSecondary,
    fontStyle: "italic",
    marginBottom: 8,
  },
  statRow: {
    display: "flex",
    gap: 10,
    marginBottom: 18,
  },
  statTile: {
    flex: 1,
    background: C.bgCard,
    borderRadius: 14,
    padding: "14px 12px",
    textAlign: "center",
    border: `1px solid ${C.borderSubtle}`,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 10px",
    fontSize: 16,
    fontWeight: 700,
  },
  statIconBlue: {
    background: C.blue12,
    color: C.blue,
  },
  statIconGold: {
    background: C.gold12,
    color: C.gold,
  },
  statIconGreen: {
    background: C.green12,
    color: C.green,
  },
  statIconPurple: {
    background: C.purple12,
    color: C.purple,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 750,
    color: C.textPrimary,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  statLabel: {
    fontSize: 10.5,
    color: C.textTertiary,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginTop: 8,
    fontWeight: 650,
  },
  buttonRow: {
    display: "flex",
    gap: 10,
    marginBottom: 18,
  },
  primaryButton: {
    border: "none",
    borderRadius: 12,
    color: C.textPrimary,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "center",
    padding: "15px 20px",
    minHeight: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    transition: "transform .2s ease, box-shadow .2s ease, filter .2s ease",
    touchAction: "manipulation",
  },
  primaryButtonHero: {
    background: "linear-gradient(135deg, #4F8CFF, #3B6FE0)",
    boxShadow: "0 4px 24px rgba(79, 140, 255, 0.15)",
    flex: 2,
  },
  primaryButtonHot: {
    background: "linear-gradient(135deg, #4F8CFF, #3B6FE0)",
    boxShadow: "0 4px 24px rgba(79, 140, 255, 0.15)",
  },
  secondaryButton: {
    background: "transparent",
    border: `1.5px solid ${C.blue35}`,
    borderRadius: 12,
    color: C.blue,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "15px 16px",
    minHeight: 52,
    touchAction: "manipulation",
  },
  secondaryButtonHero: {
    background: "transparent",
    border: `1.5px solid ${C.blue35}`,
    color: C.blue,
    fontSize: 15,
    fontWeight: 600,
    borderRadius: 12,
    padding: "15px 16px",
    minHeight: 52,
    flex: 1,
    cursor: "pointer",
  },
  section: {
    fontSize: 16,
    color: C.textPrimary,
    letterSpacing: "-0.01em",
    marginBottom: 12,
    fontWeight: 700,
    marginTop: 34,
  },
  weakItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "16px 20px",
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 14,
    marginBottom: 10,
    transition: "all 0.15s ease",
  },
  weakName: {
    fontSize: 14,
    color: C.textPrimary,
    fontWeight: 600,
  },
  weakMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 5,
    lineHeight: 1.5,
  },
  chapterHeading: {
    fontSize: 11,
    color: C.textTertiary,
    marginBottom: 10,
    letterSpacing: "0.05em",
    marginTop: 18,
    textTransform: "uppercase",
    fontWeight: 500,
  },
  chapterCard: {
    display: "flex",
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 14,
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: "inherit",
    padding: 0,
    marginBottom: 10,
    width: "100%",
    transition: "all 0.15s ease",
    touchAction: "manipulation",
  },
  chapterContent: {
    padding: "16px 20px",
    flex: 1,
  },
  chapterTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  chapterTitleWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  chapterStatus: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
  },
  chapterTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.textPrimary,
    minWidth: 0,
  },
  chapterSide: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  chapterCount: {
    fontSize: 13,
    color: C.textSecondary,
    fontWeight: 600,
  },
  chapterChevron: {
    fontSize: 16,
    color: C.textTertiary,
    lineHeight: 1,
  },
  chapterTrack: {
    height: 3,
    background: C.bgDeep,
    borderRadius: 999,
    overflow: "hidden",
    marginTop: 12,
  },
  chapterFill: {
    height: "100%",
    borderRadius: 999,
    transition: "width .3s",
  },
  resetButton: {
    background: "transparent",
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: "10px 14px",
    color: C.textSecondary,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    marginTop: 18,
    fontWeight: 600,
  },
  dangerRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  historyList: {
    marginTop: 12,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  historyRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "6px 4px",
    borderBottom: `1px solid ${C.borderSubtle}`,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.textPrimary,
  },
  historyMeta: {
    fontSize: 12,
    color: C.textSecondary,
  },
  historyNote: {
    fontSize: 12,
    color: C.gold,
    fontWeight: 600,
  },
  historyRestore: {
    background: "transparent",
    border: `1px solid ${C.borderMedium}`,
    borderRadius: 10,
    padding: "6px 12px",
    color: C.textPrimary,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 600,
  },
  backButton: {
    background: "none",
    border: "none",
    color: C.textSecondary,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "2px 0",
    marginBottom: 12,
    fontWeight: 600,
  },
  topicHeader: {
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    padding: "16px 20px",
    borderRadius: 14,
    marginBottom: 18,
  },
  topicTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: C.textPrimary,
    letterSpacing: "-0.01em",
  },
  topicMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 6,
    lineHeight: 1.5,
  },
  formulaList: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  formulaCard: {
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 14,
    padding: "16px 20px",
  },
  formulaHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  formulaName: {
    fontSize: 14,
    fontWeight: 600,
    color: C.textPrimary,
  },
  formulaStageMeta: {
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 4,
    lineHeight: 1.45,
  },
  stagePill: {
    fontSize: 10.5,
    padding: "5px 10px",
    borderRadius: 999,
    textTransform: "uppercase",
    fontWeight: 650,
    letterSpacing: "0.07em",
  },
  formulaText: {
    fontSize: 20,
    color: C.textPrimary,
    fontWeight: 700,
    marginBottom: 10,
    padding: "16px 18px",
    background: C.bgDeep,
    borderRadius: 12,
    border: `1px solid ${C.borderSubtle}`,
    whiteSpace: "pre-wrap",
    fontFamily: FONT_MONO,
    textAlign: "center",
    lineHeight: 1.5,
  },
  formulaMeaning: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 1.6,
    marginBottom: 6,
    whiteSpace: "pre-wrap",
  },
  detailBlock: {
    marginTop: 8,
  },
  detailSummary: {
    fontSize: 11,
    color: C.textTertiary,
    cursor: "pointer",
    fontWeight: 500,
  },
  detailPre: {
    fontSize: 12,
    color: C.textSecondary,
    background: C.bgDeep,
    padding: 12,
    borderRadius: 12,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    lineHeight: 1.6,
    border: `1px solid ${C.borderSubtle}`,
    margin: "8px 0 0",
    fontFamily: FONT_MONO,
  },
  tipBox: {
    fontSize: 12,
    color: C.textSecondary,
    background: C.bgDeep,
    padding: "12px 14px",
    borderRadius: 12,
    marginTop: 8,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    border: `1px solid ${C.borderSubtle}`,
  },
  mt: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  mtCompact: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  modeChip: {
    fontSize: 10.5,
    padding: "8px 12px",
    borderRadius: 999,
    border: `1px solid ${C.borderMedium}`,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    fontWeight: 650,
  },
  modeChipButton: {
    appearance: "none",
    backgroundClip: "padding-box",
    fontFamily: "inherit",
    lineHeight: 1,
    transition: "all 0.15s ease",
    minHeight: 44,
  },
  sessionTrack: {
    height: 5,
    background: C.bgDeep,
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 6,
  },
  sessionFill: {
    height: "100%",
    borderRadius: 999,
    transition: "width .3s",
    background: C.blue,
  },
  sessionMeta: {
    fontSize: 11,
    color: C.textTertiary,
    textAlign: "center",
    marginBottom: 16,
    fontWeight: 400,
  },
  studyCard: {
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 14,
    padding: "16px 20px",
    minHeight: 360,
  },
  studyChapter: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: C.textTertiary,
    marginBottom: 8,
    fontWeight: 500,
  },
  studyMode: {
    fontSize: 10.5,
    fontWeight: 650,
    marginBottom: 12,
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: 999,
    border: `1px solid ${C.borderMedium}`,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  studyTitle: {
    fontSize: 21,
    fontWeight: 800,
    color: C.textPrimary,
    marginBottom: 10,
    letterSpacing: "-0.03em",
    lineHeight: 1.2,
  },
  studyPrompt: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 1.6,
    marginBottom: 14,
  },
  studyInput: {
    width: "100%",
    boxSizing: "border-box",
    background: C.bgDeep,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: "15px 16px",
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: FONT_SANS,
    outline: "none",
    marginBottom: 10,
    minHeight: 48,
  },
  studyArea: {
    width: "100%",
    minHeight: 132,
    boxSizing: "border-box",
    background: C.bgDeep,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: "15px 16px",
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: FONT_SANS,
    outline: "none",
    marginBottom: 10,
    resize: "vertical",
    lineHeight: 1.6,
  },
  studyHint: {
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 10,
    lineHeight: 1.5,
  },
  generatedBox: {
    fontSize: 13,
    color: C.textPrimary,
    background: C.bgDeep,
    padding: "14px 16px",
    borderRadius: 12,
    border: `1px solid ${C.borderSubtle}`,
    lineHeight: 1.7,
    marginBottom: 12,
    whiteSpace: "pre-wrap",
  },
  errorBox: {
    fontSize: 12,
    color: C.textPrimary,
    background: C.bgDeep,
    border: `1px solid ${C.red18}`,
    borderRadius: 12,
    padding: "12px 14px",
    lineHeight: 1.6,
    marginBottom: 10,
  },
  errorActions: {
    display: "flex",
    gap: 8,
    marginTop: 10,
  },
  actionRow: {
    display: "flex",
    gap: 8,
    marginTop: 12,
  },
  feedbackWrap: {
    marginTop: 14,
    borderRadius: 14,
    border: `1px solid ${C.borderSubtle}`,
    padding: "14px 16px 16px",
    backgroundRepeat: "no-repeat",
  },
  feedbackVerdict: {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: "0.07em",
  },
  feedbackText: {
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 1.6,
    marginBottom: 12,
  },
  referenceLabel: {
    fontSize: 10.5,
    color: C.textTertiary,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 6,
    fontWeight: 650,
  },
  referenceFormula: {
    fontSize: 18,
    color: C.textPrimary,
    fontWeight: 700,
    padding: "14px 16px",
    background: C.bgDeep,
    borderRadius: 12,
    border: `1px solid ${C.borderSubtle}`,
    textAlign: "center",
    marginBottom: 10,
    whiteSpace: "pre-wrap",
    fontFamily: FONT_MONO,
    lineHeight: 1.5,
  },
  referenceMeaning: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 1.6,
    marginBottom: 10,
    whiteSpace: "pre-wrap",
  },
  doneWrap: {
    textAlign: "center",
    padding: "28px 12px",
  },
  doneEmoji: {
    fontSize: 44,
    marginBottom: 14,
  },
  doneTitle: {
    fontSize: 21,
    fontWeight: 800,
    color: C.textPrimary,
    marginBottom: 14,
    letterSpacing: "-0.03em",
  },
  doneMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 6,
    lineHeight: 1.6,
  },
  chatHead: {
    marginBottom: 14,
    padding: "16px 20px",
    borderRadius: 14,
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerSide: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },
  formulaHeaderSide: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  sessionMetaRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 16,
  },
  studyInputRow: {
    display: "flex",
    gap: 10,
    alignItems: "stretch",
    marginBottom: 10,
  },
  generatedBoxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  },
  teachMicRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginBottom: 10,
  },
  teachMicLabel: {
    fontSize: 11,
    color: C.textTertiary,
    lineHeight: 1.5,
    textAlign: "right",
  },
  hearButton: {
    background: "transparent",
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 999,
    minWidth: 34,
    minHeight: 30,
    padding: "2px 8px",
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
    touchAction: "manipulation",
  },
  feedbackVerdictRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  voiceToggle: {
    background: "transparent",
    border: `1px solid ${C.borderMedium}`,
    borderRadius: 999,
    padding: "8px 12px",
    color: C.textSecondary,
    fontSize: 11,
    fontWeight: 650,
    cursor: "pointer",
    whiteSpace: "nowrap",
    touchAction: "manipulation",
  },
  voiceToggleOn: {
    border: `1px solid ${C.blue35}`,
    background: C.blue12,
    color: C.blue,
  },
  chatTitle: {
    fontSize: 21,
    fontWeight: 800,
    color: C.textPrimary,
    letterSpacing: "-0.03em",
  },
  chatMeta: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 6,
    lineHeight: 1.6,
  },
  chatBox: {
    background: C.bgCard,
    borderRadius: 14,
    border: `1px solid ${C.borderSubtle}`,
    padding: 16,
    minHeight: 320,
    maxHeight: "56vh",
    overflowY: "auto",
    marginBottom: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  chatEmpty: {
    textAlign: "center",
    color: C.textSecondary,
    fontSize: 13,
    padding: "30px 8px",
  },
  chatEmptyEmoji: {
    fontSize: 28,
    marginBottom: 10,
  },
  chatSeed: {
    color: C.blue,
    fontSize: 12,
    marginTop: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "8px 12px",
    borderRadius: 999,
    background: "transparent",
    border: `1px solid ${C.blue35}`,
  },
  chatUserRow: {
    display: "flex",
    justifyContent: "flex-end",
    width: "100%",
  },
  chatBotRow: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
  },
  chatAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    background: C.blue12,
    color: C.blue,
    marginTop: 4,
  },
  chatUserBubble: {
    background: C.blue,
    color: C.textPrimary,
    padding: "12px 14px",
    borderRadius: "14px 14px 4px 14px",
    maxWidth: "86%",
    fontSize: 13,
    lineHeight: 1.6,
  },
  chatBotBubble: {
    background: C.bgDeep,
    color: C.textPrimary,
    padding: "12px 14px",
    borderRadius: "14px 14px 14px 4px",
    maxWidth: "86%",
    fontSize: 13,
    lineHeight: 1.65,
    border: `1px solid ${C.borderSubtle}`,
  },
  chatBotBubbleStreaming: {
    borderColor: C.borderMedium,
  },
  chatProse: {
    whiteSpace: "pre-wrap",
  },
  chatMathBlock: {
    display: "block",
    margin: "6px 0",
    overflowX: "auto",
    fontSize: 15,
  },
  chatBubbleLabel: {
    fontSize: 10.5,
    color: C.blue,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    fontWeight: 650,
    marginBottom: 6,
  },
  chatHeadActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  struggleButton: {
    background: C.bgElevated,
    border: `1px solid ${C.borderMedium}`,
    borderRadius: 999,
    padding: "6px 12px",
    color: C.textPrimary,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chatPhotoChip: {
    display: "inline-block",
    fontSize: 11,
    opacity: 0.8,
    marginBottom: 4,
  },
  chatAttachRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 8,
  },
  chatThumbWrap: {
    position: "relative",
  },
  chatThumb: {
    width: 64,
    height: 64,
    objectFit: "cover",
    borderRadius: 10,
    border: `1px solid ${C.borderMedium}`,
    display: "block",
  },
  chatThumbRemove: {
    position: "absolute",
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    border: `1px solid ${C.borderMedium}`,
    background: C.bgElevated,
    color: C.textPrimary,
    fontSize: 14,
    lineHeight: "20px",
    padding: 0,
    cursor: "pointer",
  },
  chatAttachHint: {
    fontSize: 12,
    color: C.textSecondary,
  },
  chatBubbleImages: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 6,
  },
  chatBubbleImage: {
    maxWidth: 220,
    maxHeight: 220,
    borderRadius: 10,
    border: `1px solid ${C.borderMedium}`,
    display: "block",
  },
  chatInputRow: {
    display: "flex",
    gap: 10,
  },
  chatInput: {
    flex: 1,
    minWidth: 0,
    background: C.bgCard,
    border: `1px solid ${C.borderSubtle}`,
    borderRadius: 12,
    padding: "15px 16px",
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    minHeight: 48,
  },
  chatMic: {
    background: C.bgCard,
    border: `1px solid ${C.borderMedium}`,
    borderRadius: 12,
    minWidth: 52,
    minHeight: 48,
    color: C.textPrimary,
    fontSize: 18,
    cursor: "pointer",
    // "none", not "manipulation": a thumb drifting mid-sentence must not start
    // a scroll — that cancels the press and drops the release.
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  },
  chatMicLive: {
    background: C.red12,
    border: `1px solid ${C.red18}`,
    animation: "gentlePulse 1.2s ease infinite",
  },
  micNote: {
    marginTop: 10,
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 1.6,
  },
  chatSend: {
    background: "linear-gradient(135deg, #4F8CFF, #3B6FE0)",
    border: "none",
    borderRadius: 12,
    minWidth: 52,
    minHeight: 48,
    color: C.textPrimary,
    fontSize: 18,
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 4px 24px rgba(79, 140, 255, 0.15)",
    touchAction: "manipulation",
  },
};
