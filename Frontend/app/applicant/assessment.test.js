import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentStore } from '../../context/assessment.js';
import { connectedAssessment, connectedPreflight, connectedResults } from '../../context/assessment-views.js';
import { escapeHtml } from '../../components/html.js';
const booking = { bookingId: 'booking-1', status: 'SCHEDULED', startsAt: '2026-11-13T10:00:00Z', endsAt: '2099-11-13T11:00:00Z', jobRole: { title: 'Mechatronics' }, instructions: 'Explain reasoning' };
const session = { id: 'session-1', status: 'ACTIVE', messages: [{ id: 'prompt-1', role: 'AI', text: '<script>untrusted</script>', scenarioIndex: 0 }], currentPromptId: 'prompt-1', hasPendingResponse: false, progress: { totalScenarios: 1, completedScenarios: 0 }, endsAt: booking.endsAt, speech: { stt: 'browser' }, preflight: { audioProcessingConsent: false }, policy: { allowText: true }, language: 'en', mode: 'TEXT' };
const preflight = { bookingId: booking.bookingId, session: null, canStart: true, startsAt: booking.startsAt, endsAt: booking.endsAt, policy: { allowText: true }, speech: { stt: 'browser' }, privacy: { camera: 'Local only', transcripts: 'Confirmed evidence' }, blockingReasons: [] };
const client = overrides => ({ bookings: async () => ({ data: [booking] }), bookingPreflight: async () => preflight, assessmentSession: async () => session, startAssessment: async () => session, assessmentResults: async () => ({ provisional: true, competencies: [{ name: 'Diagnostics', score: 60, requiredScore: 70, gap: 10 }] }), ...overrides });
const context = state => ({ assessmentState: state, escape: escapeHtml, heading: title => `<h1>${title}</h1>`, card: (title, body) => `<section><h2>${title}</h2>${body}</section>`, badge: text => `<span>${text}</span>`, button: (text, href) => `<a href="/${href}">${text}</a>` });
const ready = store => { store.device('camera', 'READY'); store.device('microphone', 'READY'); };
test('assessment restores booking/session ownership, starts explicitly and displays real messages', async () => {
  let starts = 0;
  const store = createAssessmentStore({ client: client({ startAssessment: async (_id, input) => { starts++; assert.equal(input.confirmed, true); return session; } }) });
  await store.load('owner', 'booking-1'); ready(store); assert.equal(starts, 0);
  assert.ok(connectedPreflight(context(store.snapshot())).includes('preflight-form'));
  await store.action('start', { confirmed: true, privacyAcknowledged: true, mode: 'TEXT', audioProcessingConsent: false });
  assert.equal(starts, 1); const html = connectedAssessment(context(store.snapshot()));
  assert.ok(html.includes('answer-form')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  store.reset(); assert.equal(store.snapshot().session, null);
});
test('unknown answer outcomes retain the exact key/body and prevent another answer until reconciled', async () => {
  const calls = []; let fail = true;
  const api = client({ bookingPreflight: async () => ({ ...preflight, session: { id: session.id } }), assessmentResponse: async (id, body, key) => { calls.push({ id, body, key }); if (fail) throw Object.assign(new Error('Offline'), { code: 'NETWORK_ERROR' }); return { ...session, currentPromptId: 'prompt-2' }; } });
  const store = createAssessmentStore({ client: api, makeKey: () => 'stable-key' });
  await store.load('owner'); ready(store); store.draft('Use safe isolation.'); await store.action('answer');
  assert.equal(store.snapshot().uncertain, true); store.draft('Changed draft'); await store.action('answer'); assert.equal(calls.length, 1);
  await store.load('owner', '', true); ready(store); assert.equal(store.snapshot().uncertain, true);
  fail = false; await store.action('resume'); assert.deepEqual(calls[0], calls[1]); assert.equal(store.snapshot().draft, '');
});
test('late private session reads and answer completions cannot restore a signed-out account', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const store = createAssessmentStore({ client: client({ startAssessment: () => waiting }) });
  await store.load('owner'); ready(store); const pending = store.action('start', {}); store.reset(); release(session); await pending;
  assert.equal(store.snapshot().owner, ''); assert.equal(store.snapshot().session, null);
});
test('completed scenarios show provisional results and block additional answers', async () => {
  const done = { ...session, status: 'AWAITING_REVIEW', currentPromptId: null, progress: { totalScenarios: 1, completedScenarios: 1 } };
  const store = createAssessmentStore({ client: client({ bookingPreflight: async () => ({ ...preflight, session: { id: session.id } }), assessmentSession: async () => done }) });
  await store.load('owner'); ready(store); const html = connectedAssessment(context(store.snapshot()));
  assert.ok(!html.includes('id="answer-form"')); assert.ok(html.includes('awaiting assessor review'));
  const results = connectedResults(context(store.snapshot())); assert.ok(results.includes('provisional AI proposals')); assert.ok(results.includes('Diagnostics')); assert.ok(!results.includes('77.3'));
});
test('preflight shows backend blocking reasons and mandatory microphone and camera controls', async () => {
  const store = createAssessmentStore({ client: client({ bookingPreflight: async () => ({ ...preflight, canStart: false, blockingReasons: ['Approved scenarios missing'], policy: { allowText: true, cameraRequired: true } }) }) });
  await store.load('owner'); ready(store); const html = connectedPreflight(context(store.snapshot()));
  assert.ok(html.includes('Approved scenarios missing')); assert.ok(html.includes('Check camera')); assert.ok(html.includes('Check microphone')); assert.ok(html.includes('disabled'));
});

test('assessment API sends explicit confirmation, CSRF, stable idempotency and owned session routes', async () => {
  const { createApi } = await import('../../lib/api.js'); const calls = [], timeouts = [];
  const timeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => { timeouts.push(ms); return timeout(ms); };
  try {
    const api = createApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'csrf' } : session })); } });
    await api.startAssessment('booking-1', { confirmed: true, privacyAcknowledged: true, mode: 'TEXT' });
    await api.assessmentResponse('session-1', { promptId: 'prompt-1', text: 'Safe isolation', confirmed: true, origin: 'TEXT' }, 'same-key');
    await api.resumeAssessment('session-1'); await api.assessmentResults('session-1');
    const response = calls.find(c => c.url.endsWith('/responses'));
    assert.equal(response.headers['Idempotency-Key'], 'same-key'); assert.equal(response.headers['X-CSRF-Token'], 'csrf'); assert.equal(response.credentials, 'include');
    assert.ok(timeouts.includes(150000)); assert.ok(calls.some(c => c.url === '/api/v1/assessment-sessions/session-1/results'));
  } finally { AbortSignal.timeout = timeout; }
});

test('explicit skip preserves the draft on failure, uses SKIP origin and retries the same confirmed payload', async () => {
  const calls = []; let offline = true;
  const store = createAssessmentStore({ client: client({ bookingPreflight: async () => ({ ...preflight, session: { id: session.id } }), assessmentResponse: async (id, body, key) => { calls.push({ id, body, key }); if (offline) throw Object.assign(new Error('Offline'), { code: 'NETWORK_ERROR' }); return { ...session, currentPromptId: 'next' }; } }), makeKey: () => 'skip-key' });
  await store.load('owner'); ready(store); store.draft('Unsubmitted work');
  assert.ok(connectedAssessment(context(store.snapshot())).includes('skip-assessment-form'));
  await store.action('skip'); assert.equal(store.snapshot().draft, 'Unsubmitted work'); assert.equal(calls[0].body.origin, 'SKIP'); assert.equal(calls[0].body.text, 'I don’t know / Skip this scenario.');
  await store.action('skip'); assert.equal(calls.length, 1);
  offline = false; await store.action('resume'); assert.deepEqual(calls[0], calls[1]);
});

test('camera and microphone are mandatory for start, answer, skip and resume in text mode', async () => {
  let calls = 0;
  const store = createAssessmentStore({ client: client({ startAssessment: async () => { calls++; return session; }, assessmentResponse: async () => { calls++; return session; }, resumeAssessment: async () => { calls++; return session; } }) });
  await store.load('owner');
  await store.action('start', {}); assert.equal(calls, 0);
  store.device('camera', 'READY'); await store.action('start', {}); assert.equal(calls, 0);
  store.device('microphone', 'READY'); await store.action('start', {}); assert.equal(calls, 1);
  store.device('microphone', 'UNAVAILABLE'); store.draft('Safe isolation');
  for (const kind of ['answer', 'skip', 'resume']) await store.action(kind);
  assert.equal(calls, 1); assert.ok(store.snapshot().error.includes('camera and microphone'));
  assert.ok(connectedAssessment(context(store.snapshot())).includes('Camera and microphone required'));
  store.clearDevices(); assert.equal(store.snapshot().devices.camera, 'NOT_REQUESTED'); assert.equal(store.snapshot().devices.microphone, 'NOT_REQUESTED');
});
test('device checks keep both live streams, detect disconnection and release hardware on exit', async () => {
  const { createAssessmentDevices } = await import('../../context/assessment-devices.js');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const state = { owner: 'user', bookingId: 'booking', session: { id: 'session' }, devices: { camera: 'NOT_REQUESTED', microphone: 'NOT_REQUESTED' } };
  const tracks = [], requests = [];
  const makeStream = () => { const track = { readyState: 'live', muted: false, stop() { this.readyState = 'ended'; } }; tracks.push(track); return { getTracks: () => [track] }; };
  const store = { snapshot: () => state, device(name, value) { state.devices[name] = value; }, clearDevices() { state.devices.camera = 'NOT_REQUESTED'; state.devices.microphone = 'NOT_REQUESTED'; }, message() {} };
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async options => { requests.push(options); return makeStream(); } } } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
    const devices = createAssessmentDevices({ store });
    assert.equal(requests.length, 0);
    await devices.check('camera'); await devices.check('microphone');
    assert.deepEqual(requests, [{ video: true }, { audio: true }]);
    assert.deepEqual(state.devices, { camera: 'READY', microphone: 'READY' });
    assert.ok(tracks.every(t => t.readyState === 'live'));
    tracks[1].readyState = 'ended'; tracks[1].onended(); assert.equal(state.devices.microphone, 'UNAVAILABLE');
    devices.reset(); assert.ok(tracks.every(t => t.readyState === 'ended')); assert.equal(state.devices.camera, 'NOT_REQUESTED');
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else delete globalThis.document;
  }
});
test('late device permissions cannot restore readiness after logout', async () => {
  const { createAssessmentDevices } = await import('../../context/assessment-devices.js');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); let release;
  const state = { owner: 'user', bookingId: 'booking', devices: {} }; let changed = 0, stopped = false;
  const store = { snapshot: () => state, clearDevices() {}, device() { changed++; }, message() {} };
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { release = resolve; }) } } });
    const devices = createAssessmentDevices({ store }); const pending = devices.check('camera'); devices.reset(); state.owner = '';
    release({ getTracks: () => [{ stop() { stopped = true; } }] }); await pending;
    assert.equal(changed, 0); assert.equal(stopped, true);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});


test('spoken questions read each current assessor prompt once, support replay and stop before dictation', async () => {
  const { createAssessmentDevices } = await import('../../context/assessment-devices.js');
  const saved = Object.fromEntries(['document', 'speechSynthesis', 'SpeechSynthesisUtterance', 'SpeechRecognition'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const state = { owner: 'owner', bookingId: 'booking', session: structuredClone(session), devices: { camera: 'READY', microphone: 'READY' }, spokenQuestions: false, speaking: false };
  state.session.preflight.audioProcessingConsent = true;
  const spoken = [], order = []; let devices, listening;
  const store = { snapshot: () => state, speech(settings) { Object.assign(state, settings); devices.attach(); }, clearDevices() {}, message(text) { state.error = text; }, transcribe() {} };
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } });
    Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: { cancel() { order.push('cancel'); }, speak(u) { spoken.push(u); } } });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
    Object.defineProperty(globalThis, 'SpeechRecognition', { configurable: true, value: class { constructor() { listening = this; } start() { order.push('listen'); } abort() { order.push('abort'); } } });
    devices = createAssessmentDevices({ store }); devices.attach(); assert.equal(spoken.length, 0);
    devices.toggleQuestions(); assert.equal(spoken.length, 1); assert.equal(spoken[0].text, session.messages[0].text);
    devices.attach(); assert.equal(spoken.length, 1); spoken[0].onend(); assert.equal(state.speaking, false);
    devices.speaker(); assert.equal(spoken.length, 2);
    devices.dictate(); assert.deepEqual(order.slice(-2), ['cancel', 'listen']); assert.equal(state.speaking, false);
    const staleRecognitionEnd = listening.onend;
    state.session.messages.push({ id: 'answer', role: 'APPLICANT', text: 'Private answer' }, { id: 'next', role: 'AI', text: 'Next question', scenarioIndex: 0 });
    state.session.currentPromptId = 'next'; devices.attach(); assert.equal(spoken.length, 3); assert.equal(spoken[2].text, 'Next question'); assert.ok(order.includes('abort'));
    await staleRecognitionEnd(); // An aborted recognition cannot submit an answer.
    devices.toggleQuestions(); assert.equal(state.spokenQuestions, false); assert.equal(state.speaking, false);
    state.session.currentPromptId = 'answer'; devices.attach(); devices.speaker(); assert.equal(spoken.length, 3);
    state.session.status = 'COMPLETED'; devices.attach(); devices.speaker(); assert.equal(spoken.length, 3);
    devices.reset(); assert.equal(state.spokenQuestions, false); spoken[2].onend(); assert.equal(state.speaking, false);
  } finally { for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});

test('spoken question controls are available in text mode and hidden after completion', async () => {
  const store = createAssessmentStore({ client: client({ bookingPreflight: async () => ({ ...preflight, session: { id: session.id } }) }) });
  await store.load('owner'); ready(store);
  let html = connectedAssessment(context(store.snapshot()));
  assert.ok(html.includes('Enable spoken questions')); assert.ok(html.includes('Read question aloud')); assert.ok(html.includes('Stop reading'));
  store.speech({ spokenQuestions: true }); assert.ok(connectedAssessment(context(store.snapshot())).includes('Turn off spoken questions'));
  store.snapshot().session = { ...session, status: 'COMPLETED' };
  html = connectedAssessment(context(store.snapshot())); assert.ok(!html.includes('Enable spoken questions')); assert.ok(!html.includes('Read question aloud'));
});

test('identity rejection preflight explains recovery and preserves the booked assessment', async () => {
  const store = createAssessmentStore({ client: client({ bookingPreflight: async () => ({ ...preflight, canStart: false, identityRecovery: { documentId: 'rejected/id' }, blockingReasons: ['Your identity document was rejected. Review the verification feedback and upload a replacement or provide the requested evidence.'] }) }) });
  await store.load('owner'); ready(store);
  const html = connectedPreflight(context(store.snapshot()));
  assert.ok(html.includes('Your booking remains scheduled'));
  assert.ok(html.includes('/document?id=rejected%2Fid')); assert.ok(html.includes('/upload?replace=rejected%2Fid'));
  assert.ok(html.includes('Manage booking')); assert.ok(html.includes('Refresh readiness'));
  assert.match(html, /class="btn primary" disabled>Enter assessment/);
  assert.equal(store.snapshot().bookingId, booking.bookingId);
});

test('a rejection detected during start still offers a readiness refresh', async () => {
  const store = createAssessmentStore({ client: client({ startAssessment: async () => { throw Object.assign(new Error('Your identity document was rejected.'), { status: 409, code: 'IDENTITY_REJECTED' }); } }) });
  await store.load('owner'); ready(store);
  assert.equal(await store.action('start', { mode: 'TEXT' }), false);
  const html = connectedPreflight(context(store.snapshot()));
  assert.ok(html.includes('identity document was rejected')); assert.ok(html.includes('Refresh readiness'));
  assert.equal(store.snapshot().session, null);
});
