import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceCapture, NOTES, SILENCE_RMS } from './voiceCapture.js';
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
function harness({ waitPermission = false, live = false, liveDelay = 0, postOverride, meter } = {}) {
  const states=[], notes=[], drafts=[], results=[], requests=[], tracks=[], recorders=[];
  let allow, gumCalls=0, channel, openChannel;
  const getUserMedia=async()=>{
    gumCalls++;
    if(waitPermission) await new Promise(r=>{allow=r});
    const track={enabled:true,readyState:'live',stop(){this.readyState='ended'}};
    tracks.push(track);return {getTracks:()=>[track]};
  };
  const createRecorder=()=>{
    const r={state:'inactive',mimeType:'audio/webm',start(){this.state='recording'},stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['quiet recording'])});this.onstop()})}};
    recorders.push(r);return r;
  };
  const peer={connectionState:'connected',addTrack(){},close(){},createDataChannel(){
    channel={readyState:'open',close(){this.readyState='closed'},send(value){this.sent=JSON.parse(value)}};return channel;
  }, async createOffer(){return {sdp:'v=0'}},async setLocalDescription(){},async setRemoteDescription(){
    openChannel=()=>channel.onopen();
    if(!liveDelay) openChannel(); else setTimeout(openChannel, liveDelay);
  }};
  const c=new VoiceCapture({getUserMedia,createRecorder,createPeer:()=>{if(!live)throw new Error('no WebRTC');return peer},meter,post:async(payload,signal)=>{requests.push(payload);return postOverride ? postOverride(payload,signal) : payload.action==='connect'?{sdp:'v=0'}:{text:'What is normal force?'}},onState:s=>states.push(s),onDraft:s=>drafts.push(s),onNote:s=>notes.push(s)});
  return {c,states,notes,drafts,results,requests,tracks,recorders,peer,get channel(){return channel},get gumCalls(){return gumCalls},allow:()=>allow(),start:()=>c.start({onResult:t=>results.push(t),hint:'physics'}),emit:e=>channel.onmessage({data:JSON.stringify(e)})};
}
const fakeMeter = ({ peak = 0.2, trusted = true, firstSoundAt = null } = {}) => () => ({ peak: () => peak, trusted: () => trusted, firstSoundAt: () => firstSoundAt, stop() {} });

test('permission startup is single-flight; cancelled pending permission stops late tracks',async()=>{
 const h=harness({waitPermission:true});const pending=h.start();await h.start();assert.equal(h.gumCalls,1);
 h.c.cancel();h.allow();await pending;assert.equal(h.tracks[0].readyState,'ended');assert.equal(h.recorders.length,0);assert.equal(h.c.session,null);
});
test('recording starts the moment the mic opens, before the live session is ready',async()=>{
 const h=harness({live:true,liveDelay:60});const started=h.start();await flush();
 assert.equal(h.recorders[0].state,'recording');assert.equal(h.states.at(-1),'recording');assert.equal(h.notes.at(-1),NOTES.connecting);
 assert.ok(h.tracks[0].enabled,'audio is never muted while waiting for captions');
 await started;assert.equal(h.notes.at(-1),NOTES.live);
});
test('stop before the live session is ready transcribes the file; a late channel open cannot hijack',async()=>{
 const h=harness({live:true,liveDelay:80});const started=h.start();await flush();h.c.session.startedAt-=500;
 await h.c.stop();await flush();
 assert.deepEqual(h.results,['What is normal force?']);assert.equal(h.requests.filter(r=>r.action==='transcribe').length,1);
 await started;await flush();assert.equal(h.results.length,1);assert.equal(h.states.at(-1),'idle');
});
test('recorded fallback preserves quiet speech and delivers once',async()=>{
 const h=harness();await h.start();h.c.session.startedAt-=500;
 await h.c.stop();await h.c.stop();await flush();assert.equal(h.requests.length,1);assert.equal(h.requests[0].action,'transcribe');assert.deepEqual(h.results,['What is normal force?']);assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});
test('live captions commit once and only submit final transcript',async()=>{
 const h=harness({live:true});await h.start();h.emit({type:'conversation.item.input_audio_transcription.delta',delta:'What is'});h.emit({type:'conversation.item.input_audio_transcription.delta',delta:' normal force?'});
 assert.equal(h.drafts.at(-1),'What is normal force?');assert.equal(h.results.length,0);
 await h.c.stop();await new Promise(r=>setTimeout(r,275));assert.equal(h.channel.sent.type,'input_audio_buffer.commit');
 h.emit({type:'conversation.item.input_audio_transcription.completed',transcript:'What is normal force?'});
 h.emit({type:'conversation.item.input_audio_transcription.completed',transcript:'duplicate'});
 assert.deepEqual(h.results,['What is normal force?']);assert.equal(h.requests.filter(r=>r.action==='transcribe').length,0);
});
test('speech that began before the live session was ready makes the file the final transcript',async()=>{
 const h=harness({live:true,meter:fakeMeter({firstSoundAt:Date.now()-1000})});await h.start();h.c.session.startedAt-=1500;
 await h.c.stop();await flush();
 assert.equal(h.channel.sent,undefined,'no live commit for a clip the live session only half heard');
 assert.equal(h.requests.filter(r=>r.action==='transcribe').length,1);assert.deepEqual(h.results,['What is normal force?']);
});
test('speech that began after the live session was ready uses the live transcript',async()=>{
 const h=harness({live:true,meter:fakeMeter({firstSoundAt:null})});await h.start();
 h.c.session.meter.firstSoundAt=()=>h.c.session.liveReadyAt+50;
 await h.c.stop();await new Promise(r=>setTimeout(r,275));assert.equal(h.channel.sent.type,'input_audio_buffer.commit');
 h.emit({type:'conversation.item.input_audio_transcription.completed',transcript:'live words'});
 assert.deepEqual(h.results,['live words']);assert.equal(h.requests.filter(r=>r.action==='transcribe').length,0);
});
test('a silent clip is never uploaded; the note names the wrong-mic fix',async()=>{
 const h=harness({meter:fakeMeter({peak:SILENCE_RMS/2})});await h.start();h.c.session.startedAt-=800;
 await h.c.stop();await flush();
 assert.equal(h.requests.filter(r=>r.action==='transcribe').length,0);assert.equal(h.results.length,0);
 assert.equal(h.notes.at(-1),NOTES.silent);assert.equal(h.states.at(-1),'idle');assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});
test('an untrusted meter never triggers the silence gate, and peak travels with the clip',async()=>{
 const h=harness({meter:fakeMeter({peak:0,trusted:false})});await h.start();h.c.session.startedAt-=800;
 await h.c.stop();await flush();
 const req=h.requests.find(r=>r.action==='transcribe');assert.ok(req);assert.equal(req.peak,0);assert.deepEqual(h.results,['What is normal force?']);
});
test('cancel prevents a late transcription from submitting after navigation',async()=>{
 let resolve;const h=harness({postOverride:()=>new Promise(r=>{resolve=r})});await h.start();h.c.session.startedAt-=500;await h.c.stop();await flush();h.c.cancel();resolve({text:'stale transcript'});await flush();assert.equal(h.results.length,0);assert.equal(h.states.at(-1),'idle');
});
test('live failure falls back once, with no duplicate late completion',async()=>{
 const h=harness({live:true});await h.start();h.c.session.startedAt-=500;await h.c.stop();h.emit({type:'error',error:{message:'disconnected'}});await flush();assert.deepEqual(h.results,['What is normal force?']);assert.equal(h.requests.filter(r=>r.action==='transcribe').length,1);
});
test('live connect failure keeps recording in recorded mode',async()=>{
 const h=harness({live:true,postOverride:p=>p.action==='connect'?Promise.reject(new Error('Live transcription unavailable (503).')):{text:'What is normal force?'}});
 await h.start();assert.equal(h.states.at(-1),'recording');assert.equal(h.notes.at(-1),NOTES.recorded);assert.equal(h.recorders[0].state,'recording');
 h.c.session.startedAt-=500;await h.c.stop();await flush();assert.deepEqual(h.results,['What is normal force?']);
});
test('recorder construction failure releases the acquired stream',async()=>{
 const h=harness();h.c.createRecorder=()=>{throw new Error('unsupported recorder')};await h.start();assert.equal(h.tracks[0].readyState,'ended');assert.equal(h.states.at(-1),'idle');
});
test('cancel closes live peer and prevents speech from cancelled sessions',async()=>{
 const h=harness({live:true});await h.start();h.c.cancel();h.emit({type:'conversation.item.input_audio_transcription.completed',transcript:'cancelled'});assert.equal(h.channel.readyState,'closed');assert.equal(h.results.length,0);assert.ok(h.tracks.every(t=>t.readyState==='ended'));
});

import { splitForSpeech, SPEECH_CHUNK_CHARS } from './voiceCapture.js';
test('splitForSpeech: sentence-sized pieces, decimals intact, long runs hard-split, short text untouched', () => {
  assert.deepEqual(splitForSpeech('So a equals 9.8 m/s². Got it?'), ['So a equals 9.8 m/s². Got it?']);
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says that g is 9.8 meters per second squared here.`).join(' ');
  const chunks = splitForSpeech(long);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(c => c.length <= SPEECH_CHUNK_CHARS));
  assert.ok(chunks.every(c => /\.$|\?$|!$/.test(c)), 'each piece ends on a sentence boundary');
  assert.equal(chunks.join(' '), long, 'nothing lost or duplicated');
  const run = 'x'.repeat(SPEECH_CHUNK_CHARS * 2 + 10);
  assert.deepEqual(splitForSpeech(run).map(c => c.length), [SPEECH_CHUNK_CHARS, SPEECH_CHUNK_CHARS, 10]);
  assert.deepEqual(splitForSpeech(''), []);
  assert.deepEqual(splitForSpeech('First line\nSecond line'), ['First line Second line']);
});
