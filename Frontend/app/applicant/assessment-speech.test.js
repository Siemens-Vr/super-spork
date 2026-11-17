import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../lib/api.js';
import { createAssessmentStore } from '../../context/assessment.js';
import { createAssessmentDevices } from '../../context/assessment-devices.js';
import { voiceCapability, encodePcmWav, createServerRecording } from '../../context/assessment-speech.js';
import { connectedPreflight, connectedAssessment } from '../../context/assessment-views.js';
import { escapeHtml } from '../../components/html.js';

const limits = { stt: 'compatible', maxAudioBytes: 8 * 1024 * 1024, maxAudioSeconds: 180 };
const booking = { bookingId: 'booking', status: 'SCHEDULED', startsAt: '2026-11-01T10:00:00Z', endsAt: '2099-11-01T10:10:00Z', jobRole: { title: 'PLC Programmer' }, instructions: 'Explain safely' };
const preflight = { ...booking, session: null, canStart: true, policy: { allowText: false }, speech: limits, privacy: { camera: 'Local preview only', transcripts: 'Evidence is saved' } };
const session = { id: 'session', status: 'ACTIVE', currentPromptId: 'prompt', messages: [{ id: 'prompt', role: 'AI', text: 'How would you isolate this PLC?', scenarioIndex: 0 }], endsAt: booking.endsAt, hasPendingResponse: false, progress: { totalScenarios: 2, completedScenarios: 0 }, policy: { allowText: false }, preflight: { audioProcessingConsent: true }, speech: limits, language: 'en', mode: 'VOICE' };
const transcript = { id: 'transcript', originalText: 'Isolate the PLC supply and verify it is de-energized.' };
const client = overrides => ({ bookings: async () => ({ data: [booking] }), bookingPreflight: async () => ({ ...preflight, session: { id: session.id } }), assessmentSession: async () => structuredClone(session), ...overrides });
const context = state => ({ assessmentState: state, escape: escapeHtml, heading: title => `<h1>${title}</h1>`, card: (title, body) => `<section><h2>${title}</h2>${body}</section>`, badge: text => text, button: (text, href) => `<a href="/${href}">${text}</a>` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const audioBuffer = (seconds = 1, rate = 48000, channels = 2) => ({ length: seconds * rate, sampleRate: rate, numberOfChannels: channels, getChannelData: () => new Float32Array(seconds * rate).fill(0.25) });

function fakeAudio(options = {}) {
  const instances = [], decoders = [], timers = new Map(); let nextTimer = 0;
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, config) { this.stream = stream; this.config = config; this.mimeType = config?.mimeType || 'audio/webm'; this.state = 'inactive'; instances.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['synthetic recording'], { type: this.mimeType }) });
      this.finished = this.onstop?.();
    }
  }
  class Decoder {
    constructor() { decoders.push(this); this.closed = false; }
    async decodeAudioData() { if (options.decode) return options.decode(); return audioBuffer(); }
    async close() { this.closed = true; }
  }
  return { instances, decoders, timers, runtime: { MediaRecorder: Recorder, AudioContext: Decoder, setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) } };
}

function globals(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
}
async function readyStore(overrides) {
  const store = createAssessmentStore({ client: client(overrides) }); await store.load('applicant');
  store.device('camera', 'READY'); store.device('microphone', 'READY'); return store;
}
async function recordingFixture(t, overrides = {}, options = {}) {
  const fake = fakeAudio(options);
  const track = { readyState: 'live', muted: false, stop() { this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track] };
  globals(t, { MediaRecorder: fake.runtime.MediaRecorder, AudioContext: fake.runtime.AudioContext, SpeechRecognition: undefined, webkitSpeechRecognition: undefined, navigator: { mediaDevices: { getUserMedia: async () => stream } }, document: { querySelector: () => null } });
  const store = await readyStore({ assessmentAudioTranscript: async () => transcript, ...overrides });
  const devices = createAssessmentDevices({ store }); t.after(() => devices.reset());
  await devices.check('microphone');
  return { ...fake, store, devices, track, stream };
}

test('voice capability follows the configured provider and detects missing recording support', () => {
  const fake = fakeAudio();
  assert.equal(voiceCapability(limits, fake.runtime).available, true);
  assert.equal(voiceCapability({ stt: 'browser' }, fake.runtime).available, false);
  assert.equal(voiceCapability({ stt: 'browser' }, { webkitSpeechRecognition: class {} }).available, true);
  assert.equal(voiceCapability(limits, { MediaRecorder: class {} }).available, false);
  assert.equal(voiceCapability(limits, { ...fake.runtime, MediaRecorder: class { static isTypeSupported() { return false; } } }).available, false);
  assert.equal(voiceCapability({ stt: 'disabled' }, fake.runtime).available, false);
});

test('recordings are converted to bounded mono PCM WAV regardless of capture sample rate', async () => {
  for (const rate of [8000, 16000, 44100, 48000, 96000]) {
    const blob = encodePcmWav(audioBuffer(1, rate), limits), bytes = await blob.arrayBuffer(), view = new DataView(bytes);
    assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 32044);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
    assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 16000); assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 32000); assert.equal(view.getInt16(44, true), 8192);
  }
  assert.throws(() => encodePcmWav(audioBuffer(2), { ...limits, maxAudioSeconds: 1 }), /limit/);
  assert.throws(() => encodePcmWav(audioBuffer(), { ...limits, maxAudioBytes: 32043 }), /limit/);
  assert.throws(() => encodePcmWav(audioBuffer(0), limits), /no usable audio/);
  assert.throws(() => encodePcmWav(audioBuffer(), {}), /limits are unavailable/);
});

test('server recorder stops at the stricter duration/PCM byte limit and closes its decoder', async () => {
  const fake = fakeAudio(), phases = [], uploads = [];
  const capture = createServerRecording({ stream: {}, speech: { ...limits, maxAudioBytes: 32044 }, runtime: fake.runtime, isCurrent: () => true, onState: phase => phases.push(phase), onAudio: async blob => uploads.push(blob), onError: error => assert.fail(error.message) });
  capture.start(); assert.ok([...fake.timers.values()][0].ms < 1000);
  [...fake.timers.values()][0].fn(); await fake.instances[0].finished;
  assert.equal(uploads[0].type, 'audio/wav'); assert.equal(phases[0], 'recording'); assert.equal(phases.at(-1), 'idle');
  assert.equal(fake.decoders[0].closed, true); assert.equal(fake.timers.size, 0);
});

test('oversized capture is discarded and never uploaded', () => {
  const fake = fakeAudio(), errors = []; let uploads = 0;
  const capture = createServerRecording({ stream: {}, speech: { ...limits, maxAudioBytes: 50 }, runtime: fake.runtime, isCurrent: () => true, onState() {}, onAudio: async () => uploads++, onError: error => errors.push(error.message) });
  capture.start(); fake.instances[0].ondataavailable({ data: new Blob(['x'.repeat(51)]) });
  assert.equal(uploads, 0); assert.equal(fake.instances[0].state, 'inactive'); assert.equal(fake.timers.size, 0); assert.match(errors[0], /size limit/);
});

test('cancelled recordings and stale decodes cannot upload audio', async () => {
  const wait = deferred(), fake = fakeAudio({ decode: () => wait.promise }); let uploads = 0;
  const capture = createServerRecording({ stream: {}, speech: limits, runtime: fake.runtime, isCurrent: () => true, onState() {}, onAudio: async () => uploads++, onError: error => assert.fail(error.message) });
  capture.start(); capture.stop();
  await new Promise(resolve => setImmediate(resolve)); capture.cancel(); wait.resolve(audioBuffer()); await fake.instances[0].finished;
  assert.equal(uploads, 0); assert.equal(fake.decoders[0].closed, true); assert.equal(fake.timers.size, 0);
});

test('server voice-only preflight includes consent and allows supported server recording', async t => {
  const fake = fakeAudio(); globals(t, { MediaRecorder: fake.runtime.MediaRecorder, AudioContext: fake.runtime.AudioContext, SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  let started;
  const store = await readyStore({ bookingPreflight: async () => preflight, startAssessment: async (_id, input) => { started = input; return session; } });
  const html = connectedPreflight(context(store.snapshot()));
  assert.match(html, /recording and sending my audio/); assert.match(html, /name="audioProcessingConsent" required/);
  assert.doesNotMatch(html, /class="btn primary" disabled>Enter assessment/);
  store.device('speakerConfirmed', true);
  assert.equal(await store.action('start', { mode: 'VOICE', confirmed: true, privacyAcknowledged: true, audioProcessingConsent: true }), true);
  assert.equal(started.mode, 'VOICE'); assert.equal(started.audioProcessingConsent, true);
});

test('unsupported voice-only preflight blocks entry but text-permitted assessments retain typed fallback', async t => {
  globals(t, { MediaRecorder: undefined, AudioContext: undefined, webkitAudioContext: undefined, SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  const store = await readyStore({ bookingPreflight: async () => preflight, startAssessment: async () => assert.fail('Unsupported voice must not start') });
  assert.match(connectedPreflight(context(store.snapshot())), /class="btn primary" disabled>Enter assessment/);
  assert.equal(await store.action('start', { mode: 'VOICE' }), false);
  store.snapshot().preflight = { ...preflight, policy: { allowText: true } };
  const html = connectedPreflight(context(store.snapshot()));
  assert.match(html, /continue by typing/); assert.doesNotMatch(html, /class="btn primary" disabled>Enter assessment/);
});

test('server dictation registers a transcript and submits only after review with its transcription ID', async t => {
  let uploads = 0, submitted;
  const { store, devices, instances } = await recordingFixture(t, {
    assessmentAudioTranscript: async (id, blob) => { uploads++; assert.equal(id, session.id); assert.equal(blob.type, 'audio/wav'); return transcript; },
    assessmentResponse: async (_id, body) => { submitted = body; return { ...session, currentPromptId: 'next' }; },
  });
  devices.dictate(); assert.equal(store.snapshot().recording, 'recording'); assert.equal(await store.action('answer'), false);
  const recordingHtml = connectedAssessment(context(store.snapshot()));
  assert.match(recordingHtml, /data-assessment-action="stop-dictation" >Stop dictation/);
  assert.ok(recordingHtml.indexOf('stop-dictation') < recordingHtml.indexOf('id="answer-form"'));
  devices.stop(); await instances[0].finished;
  assert.equal(uploads, 1); assert.equal(submitted, undefined); assert.equal(store.snapshot().recording, 'idle');
  assert.equal(store.snapshot().draft, transcript.originalText);
  store.draft('Isolate the PLC power supply and test for absence of voltage.');
  assert.equal(await store.action('answer'), true); assert.equal(submitted.origin, 'VOICE');
  assert.equal(submitted.transcriptionId, transcript.id); assert.match(submitted.text, /absence of voltage/);
});

test('server audio upload uses a single multipart audio field and retains backend errors without replay', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'csrf' } : transcript }));
  } });
  await api.assessmentAudioTranscript('session/id', encodePcmWav(audioBuffer(), limits));
  const request = calls.at(-1); assert.equal(request.url, '/api/v1/assessment-sessions/session%2Fid/audio/transcribe');
  assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'include'); assert.equal(request.headers['X-CSRF-Token'], 'csrf');
  assert.equal(request.headers['Content-Type'], undefined); assert.deepEqual([...request.body.keys()], ['audio']);
  assert.equal(request.body.get('audio').name, 'response.wav'); assert.equal(request.body.get('audio').type, 'audio/wav');
  let attempts = 0;
  const unavailable = createApi({ fetcher: async url => { if (url.endsWith('/csrf')) return new Response(JSON.stringify({ data: { csrfToken: 'csrf' } })); attempts++; return new Response(JSON.stringify({ error: { code: 'STT_UNAVAILABLE', message: 'Speech service unavailable' } }), { status: 503 }); } });
  await assert.rejects(unavailable.assessmentAudioTranscript('session', new Blob()), error => error.code === 'STT_UNAVAILABLE'); assert.equal(attempts, 1);
});

test('transcription failures preserve the draft and permit another recording without submitting an answer', async t => {
  const { store, devices, instances } = await recordingFixture(t, { assessmentAudioTranscript: async () => { throw new ApiError('Speech service unavailable', 503, 'STT_UNAVAILABLE'); } });
  store.draft('Keep this draft'); devices.dictate(); devices.stop(); await instances[0].finished;
  assert.equal(store.snapshot().draft, 'Keep this draft'); assert.equal(store.snapshot().transcript, null);
  assert.equal(store.snapshot().busy, false); assert.equal(store.snapshot().uncertain, false); assert.equal(store.snapshot().recording, 'idle');
  assert.match(store.snapshot().error, /Speech service unavailable/);
  devices.dictate(); assert.equal(instances.length, 2); assert.equal(store.snapshot().recording, 'recording');
});

test('codec failures keep draft text and release recording resources', async t => {
  const { store, devices, instances, decoders } = await recordingFixture(t, { assessmentAudioTranscript: async () => assert.fail('Invalid audio must not be uploaded') }, { decode: async () => { throw new Error('Unsupported recording codec'); } });
  store.draft('Saved draft'); devices.dictate(); devices.stop(); await instances[0].finished;
  assert.equal(store.snapshot().draft, 'Saved draft'); assert.equal(store.snapshot().recording, 'idle');
  assert.equal(decoders[0].closed, true); assert.match(store.snapshot().error, /Unsupported recording codec/);
});

test('microphone loss discards a recording and denied permission never starts capture', async t => {
  const { store, devices, instances, track } = await recordingFixture(t);
  devices.dictate(); track.readyState = 'ended'; track.onended();
  assert.equal(instances[0].state, 'inactive'); assert.equal(store.snapshot().recording, 'idle');
  assert.equal(store.snapshot().devices.microphone, 'UNAVAILABLE'); assert.equal(store.snapshot().transcript, null);
  globalThis.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Microphone access denied'), { name: 'NotAllowedError' }); };
  await devices.check('microphone'); devices.dictate(); assert.equal(instances.length, 1); assert.equal(store.snapshot().devices.microphone, 'DENIED');
});

test('navigation cleanup, changed prompts and missing consent prevent stale recordings from uploading', async t => {
  let uploads = 0;
  const { store, devices, instances } = await recordingFixture(t, { assessmentAudioTranscript: async () => { uploads++; return transcript; } });
  store.snapshot().session.preflight.audioProcessingConsent = false; devices.dictate(); assert.equal(instances.length, 0);
  store.snapshot().session.preflight.audioProcessingConsent = true;
  devices.dictate(); store.snapshot().session.currentPromptId = 'next-prompt'; devices.attach();
  assert.equal(instances[0].state, 'inactive'); assert.equal(uploads, 0);
  devices.dictate(); devices.reset(); assert.equal(store.snapshot().recording, 'idle'); assert.equal(uploads, 0);
});

test('late transcription results cannot replace a different account or a newer question', async () => {
  for (const changed of ['logout', 'account', 'prompt']) {
    const wait = deferred(); const store = await readyStore({ assessmentAudioTranscript: () => wait.promise });
    const transcribing = store.transcribeAudio(new Blob());
    if (changed === 'logout') store.reset();
    if (changed === 'account') await store.load('different-applicant');
    if (changed === 'prompt') store.snapshot().session.currentPromptId = 'next-prompt';
    wait.resolve(transcript); await transcribing;
    assert.equal(store.snapshot().transcript, null); assert.equal(store.snapshot().draft, '');
  }
});

test('browser dictation remains available and registers final text before explicit voice submission', async t => {
  let recognition, submitted, registrations = 0;
  globals(t, { SpeechRecognition: class { constructor() { recognition = this; } start() {} stop() { this.finished = this.onend?.(); } abort() {} }, document: { querySelector: () => null } });
  const store = await readyStore({ assessmentSession: async () => ({ ...structuredClone(session), speech: { ...limits, stt: 'browser' } }), assessmentTranscript: async (_id, body) => { registrations++; assert.equal(body.isFinal, true); return transcript; }, assessmentResponse: async (_id, body) => { submitted = body; return { ...session, currentPromptId: 'next' }; } });
  const devices = createAssessmentDevices({ store }); t.after(() => devices.reset());
  devices.dictate(); recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: transcript.originalText }], { isFinal: true })] });
  devices.stop(); await recognition.finished;
  assert.equal(registrations, 1); assert.equal(submitted, undefined); assert.equal(store.snapshot().recording, 'idle');
  await store.action('answer'); assert.equal(submitted.origin, 'VOICE'); assert.equal(submitted.transcriptionId, transcript.id);
});

test('leaving during a transcription discards its response and immediately releases the busy state', async t => {
  const pending = deferred();
  const { store, devices, instances } = await recordingFixture(t, { assessmentAudioTranscript: () => pending.promise });
  store.draft('Preserve my draft'); devices.dictate(); devices.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.snapshot().busy, true);
  devices.reset(); assert.equal(store.snapshot().busy, false); assert.equal(store.snapshot().recording, 'idle');
  pending.resolve(transcript); await instances[0].finished;
  assert.equal(store.snapshot().transcript, null); assert.equal(store.snapshot().draft, 'Preserve my draft');
});

test('a cancelled transcription cannot clear a newer transcription busy state or replace its text', async () => {
  const older = deferred(), newer = deferred(); let reads = 0;
  const store = await readyStore({ assessmentAudioTranscript: () => ++reads === 1 ? older.promise : newer.promise });
  const old = store.transcribeAudio(new Blob()); store.cancelTranscription();
  const fresh = store.transcribeAudio(new Blob()); older.resolve(transcript); await old;
  assert.equal(store.snapshot().busy, true); assert.equal(store.snapshot().transcript, null);
  newer.resolve({ ...transcript, id: 'newer', originalText: 'Use the newer recording.' }); await fresh;
  assert.equal(store.snapshot().transcript.id, 'newer'); assert.equal(store.snapshot().busy, false);
});

test('an expired assessment discards live capture and cannot request a new transcription', async t => {
  let uploads = 0;
  const { store, devices, instances } = await recordingFixture(t, { assessmentAudioTranscript: async () => { uploads++; return transcript; } });
  devices.dictate(); store.snapshot().session.endsAt = '2000-01-01T00:00:00Z'; devices.attach();
  assert.equal(instances[0].state, 'inactive'); assert.equal(store.snapshot().recording, 'idle');
  await store.transcribeAudio(new Blob()); assert.equal(uploads, 0);
});
