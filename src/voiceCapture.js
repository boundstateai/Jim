// One capture session owns its tracks, timers, peer and cancellation signal.
// The session is reserved before getUserMedia resolves: repeated taps cannot
// create orphan microphones. Recorded audio is kept locally only until completion.
//
// Recording starts the instant the microphone opens. The live-caption session
// (WebRTC to the transcriber) is opened in parallel and attaches when it is
// ready — it never gates capture. Audio that reached the mic before the live
// session was up never reached the transcriber, so at Stop the final transcript
// comes from the live session only when it heard the whole clip; otherwise the
// locally recorded file is transcribed. Captions are a preview either way.

// A clip whose loudest moment never clears this RMS never contained speech: a
// muted or wrong-default mic, not a quiet talker (auto-gain puts speech near
// 0.05–0.3). Uploading it is worse than useless — the transcriber invents words
// for silence and room noise, which comes back as gibberish.
export const SILENCE_RMS = 0.004;
// Live-session readiness this close to recording start counts as covering the
// clip when the meter cannot say when speech began.
export const LIVE_GRACE_MS = 300;

export const NOTES = {
  opening: 'Getting the microphone ready…',
  connecting: 'Listening. Captions are connecting — tap Stop to send, or Cancel to discard.',
  live: 'Listening live. Tap Stop to send, or Cancel to discard.',
  recorded: 'Listening in recorded mode. Tap Stop to send, or Cancel to discard.',
  finishing: 'Finishing your transcript…',
  silent: 'I only heard silence — the browser is probably listening to the wrong mic. Click the mic icon in the address bar (or Site settings → Microphone) and pick the one you’re talking into, then try again.',
  nothing: 'No clear words came through. Try speaking closer to the microphone, or type it.',
  cutOff: 'Reached the 30-second limit. Sent what was recorded; continue with another clip.',
  liveDropped: 'Live captions dropped. Still recording — tap Stop to send.',
};

// Long replies (a restated photo problem plus the working) run past what a
// single text-to-speech request can return before a serverless function times
// out. Speak them in sentence-sized pieces instead: first audio in seconds,
// each request small, and the next piece is fetched while the current plays.
export const SPEECH_CHUNK_CHARS = 700;
export function splitForSpeech(text, max = SPEECH_CHUNK_CHARS) {
  const parts = `${text || ""}`.split(/(?<=[.!?])\s+|\n+/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const part of parts) {
    if (part.length > max) {
      if (current) { chunks.push(current); current = ""; }
      for (let i = 0; i < part.length; i += max) chunks.push(part.slice(i, i + max));
      continue;
    }
    if (current && current.length + 1 + part.length > max) { chunks.push(current); current = part; }
    else current = current ? `${current} ${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks;
}

export class VoiceCapture {
  constructor({ post, onState, onDraft, onNote, getUserMedia, createRecorder, createPeer, meter }) {
    Object.assign(this, { post, onState, onDraft, onNote, meter });
    this.getUserMedia = getUserMedia || (() => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
    this.createRecorder = createRecorder || (stream => new MediaRecorder(stream));
    this.createPeer = createPeer || (() => new RTCPeerConnection());
    this.session = null;
  }
  active(s) { return this.session === s && !s.cancelled; }
  state(s, value) { if (this.active(s)) { s.state = value; this.onState(value); } }
  timer(s, fn, ms) { const id = setTimeout(fn, ms); s.timers.add(id); return id; }
  clear(s, id) { clearTimeout(id); s.timers.delete(id); }
  closeLive(s) {
    s.channel?.close(); s.peer?.close(); s.channel = null; s.peer = null;
  }
  release(s) {
    s.cancelled = true;
    for (const id of s.timers) clearTimeout(id);
    s.abort.abort();
    s.rejectOpening?.(new Error("Capture cancelled."));
    this.closeLive(s);
    s.stream?.getTracks().forEach(track => track.stop());
    if (s.recorder?.state === 'recording') s.recorder.stop();
    s.meter?.stop();
    if (this.session === s) this.session = null;
  }
  cancel(note = '') {
    const s = this.session;
    if (s) this.release(s);
    this.onState('idle'); this.onDraft(''); this.onNote(note);
  }
  fail(s, error) {
    if (!this.active(s)) return;
    this.release(s); this.onState('idle'); this.onNote(error?.message || 'Speech did not go through. Try again or type it.');
  }
  async start({ onResult, hint, recorded = false }) {
    if (this.session) return;
    const s = { state: 'opening', abort: new AbortController(), timers: new Set(), chunks: [], onResult, hint, committed: false, final: null, draft: '', fallback: false, liveReadyAt: 0 };
    this.session = s;
    this.onState('opening'); this.onDraft(''); this.onNote(NOTES.opening);
    const opening = this.timer(s, () => this.cancel('Microphone setup timed out. Check its permission, then try again.'), 15_000);
    try {
      const stream = await this.getUserMedia();
      if (!this.active(s)) { stream.getTracks().forEach(track => track.stop()); return; }
      s.stream = stream;
      s.recorder = this.createRecorder(stream);
      s.mime = s.recorder.mimeType || 'audio/webm';
      s.blob = new Promise(resolve => { s.resolveBlob = resolve; });
      s.recorder.ondataavailable = event => { if (event.data.size) s.chunks.push(event.data); };
      s.recorder.onstop = () => s.resolveBlob(new Blob(s.chunks, { type: s.mime }));
      s.recorder.onerror = () => this.fail(s, new Error('The microphone stopped unexpectedly. Please try again.'));
      stream.getTracks().forEach(track => track.addEventListener?.('ended', () => {
        if (this.active(s) && s.state === 'recording') this.fail(s, new Error('The microphone disconnected. Reconnect it and try again.'));
      }));
      this.clear(s, opening);
      // Capture from the first instant, before anything else can delay it.
      s.recorder.start();
      s.startedAt = Date.now();
      s.meter = this.meter?.(stream);
      this.state(s, 'recording');
      this.onNote(recorded ? NOTES.recorded : NOTES.connecting);
      this.timer(s, () => { s.cutOff = true; void this.stop(); }, 30_000);
      if (recorded) { s.fallback = true; return; }
      try {
        await this.openLive(s);
        if (!this.active(s) || s.state !== 'recording' || s.fallback) return;
        s.liveReadyAt = Date.now();
        this.onNote(NOTES.live);
      } catch {
        if (!this.active(s) || s.fallback) return;
        this.closeLive(s);
        s.fallback = true;
        if (s.state === 'recording') this.onNote(NOTES.recorded);
      }
    } catch (error) {
      if (error?.name === 'NotAllowedError') error = new Error('Microphone access is blocked. Allow it in your browser’s site settings, then try again.');
      else if (error?.name === 'NotFoundError') error = new Error('No microphone was found on this device. Plug one in or pick one in your browser’s site settings, then try again.');
      this.fail(s, error);
    }
  }
  async openLive(s) {
    const peer = this.createPeer(); s.peer = peer;
    s.stream.getTracks().forEach(track => peer.addTrack(track, s.stream));
    const channel = peer.createDataChannel('oai-events'); s.channel = channel;
    let rejectOpening;
    const ready = new Promise((resolve, reject) => {
      rejectOpening = reject; s.rejectOpening = reject;
      channel.onopen = resolve;
      channel.onerror = () => reject(new Error('Live connection failed.'));
    });
    // Attach rejection handling now, before SDP awaits, to avoid unhandled errors.
    ready.catch(() => {});
    const deadline = this.timer(s, () => rejectOpening(new Error('Live connection timed out.')), 10_000);
    peer.onconnectionstatechange = () => {
      if (!this.active(s) || s.fallback) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        rejectOpening(new Error('Live connection disconnected.'));
        s.fallback = true;
        this.closeLive(s);
        if (s.state === 'recording') this.onNote(NOTES.liveDropped);
        if (s.state === 'busy') void this.transcribeFile(s);
      }
    };
    channel.onmessage = ({ data }) => {
      if (!this.active(s) || s.fallback) return;
      let event; try { event = JSON.parse(data); } catch { return; }
      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        s.draft += event.delta || ''; this.onDraft(s.draft);
      } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
        s.final = `${event.transcript || ''}`.trim();
        if (s.committed) this.complete(s, s.final);
      } else if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
        rejectOpening(new Error('Live transcription unavailable.'));
        s.fallback = true;
        this.closeLive(s);
        if (s.state === 'recording') this.onNote(NOTES.liveDropped);
        if (s.state === 'busy') void this.transcribeFile(s);
      }
    };
    try {
      const offer = await peer.createOffer();
      if (!this.active(s)) return;
      await peer.setLocalDescription(offer);
      const answer = await this.post({ action: 'connect', sdp: offer.sdp, hint: s.hint }, AbortSignal.any([s.abort.signal, AbortSignal.timeout(8_000)]));
      if (!this.active(s)) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      await ready;
    } finally { this.clear(s, deadline); s.rejectOpening = null; }
  }
  // Did the live session hear everything worth hearing? Only then is its
  // transcript the final one; otherwise the recorded file is.
  liveCoversClip(s) {
    if (s.fallback || s.channel?.readyState !== 'open' || !s.liveReadyAt) return false;
    const firstSoundAt = s.meter?.firstSoundAt?.();
    if (typeof firstSoundAt === 'number') return firstSoundAt >= s.liveReadyAt;
    return s.liveReadyAt - s.startedAt <= LIVE_GRACE_MS;
  }
  async stop() {
    const s = this.session;
    if (!s || s.state === 'busy') return;
    if (s.state === 'opening') { this.cancel('Microphone setup cancelled. Tap once and wait for “Listening” before speaking.'); return; }
    this.state(s, 'busy'); this.onNote(NOTES.finishing);
    s.stream.getTracks().forEach(track => { track.enabled = false; });
    if (s.recorder.state === 'recording') s.recorder.stop();
    const peak = s.meter?.peak?.();
    s.peak = typeof peak === 'number' ? Number(peak.toFixed(4)) : undefined;
    const silent = Boolean(s.meter?.trusted?.()) && typeof peak === 'number' && peak < SILENCE_RMS;
    s.meter?.stop();
    if (silent) { s.stream.getTracks().forEach(track => track.stop()); this.complete(s, '', NOTES.silent); return; }
    const useLive = this.liveCoversClip(s);
    // Local capture ends immediately. Briefly keep the peer open so the last
    // RTP packets reach the server before committing over the data channel.
    s.stream.getTracks().forEach(track => track.stop());
    if (useLive) {
      this.timer(s, () => {
        if (!this.active(s)) return;
        try {
          s.committed = true;
          s.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          if (s.final !== null) this.complete(s, s.final);
        } catch { void this.transcribeFile(s); }
      }, 250);
      this.timer(s, () => { if (this.active(s)) void this.transcribeFile(s); }, 8_000);
    } else void this.transcribeFile(s);
  }
  async transcribeFile(s) {
    if (!this.active(s) || s.fileRequest) return;
    s.fileRequest = true; s.fallback = true; this.closeLive(s);
    const deadline = this.timer(s, () => this.fail(s, new Error('Transcription timed out. Please try again or type your question.')), 30_000);
    try {
      const blob = await s.blob;
      if (!this.active(s)) return;
      if (blob.size > 3 * 1024 * 1024) throw new Error('Recording is too large. Try a shorter clip.');
      if (!blob.size || Date.now() - s.startedAt < 200) { this.complete(s, ''); return; }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      const result = await this.post({ action: 'transcribe', audio: btoa(binary), mime: s.mime, hint: s.hint, peak: s.peak }, s.abort.signal);
      if (this.active(s)) this.complete(s, `${result.text || ''}`.trim());
    } catch (error) { this.fail(s, error); }
    finally { this.clear(s, deadline); }
  }
  complete(s, text, note) {
    if (!this.active(s)) return;
    const callback = s.onResult, cutOff = s.cutOff;
    this.release(s); this.onState('idle'); this.onDraft('');
    this.onNote(note ?? (text ? (cutOff ? NOTES.cutOff : '') : NOTES.nothing));
    if (text) callback(text);
  }
}
