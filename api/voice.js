// Vercel Function: two-way voice for the tutor chat.
// Route: /api/voice  (POST)
//
// actions:
//   connect     {sdp, hint}                         -> {sdp}
//   transcribe  {audio: base64, mime, hint}          -> {text}
//   speak       {text, persona, subject}             -> {audio: base64, mime}
//
// Mirrors HOVOR's per-turn voice loop: clip in, transcript out; reply text in,
// spoken audio out. Stateless — audio is never stored.

import { transcribeAudio, synthesizeSpeech, connectLiveTranscription, VoiceUnavailable } from "./_lib/voice.js";
import { requireApiAuth } from "./_lib/auth.js";

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

export default async function handler(req, res) {
  if (!requireApiAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = readBody(req);
  const action = body.action || "";

  try {
    let payload;
    if (action === "connect") payload = await connectLiveTranscription(body);
    else if (action === "transcribe") payload = await transcribeAudio(body);
    else if (action === "speak") payload = await synthesizeSpeech(body);
    else {
      res.status(400).json({ error: `Unsupported action: ${action || "(none)"}` });
      return;
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error("voice action error:", error);
    const status = error instanceof VoiceUnavailable ? error.status : 500;
    res.status(status).json({ error: error.message || "Voice request failed." });
  }
}
