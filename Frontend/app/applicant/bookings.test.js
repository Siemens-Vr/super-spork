import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createApi, ApiError } from '../../lib/api.js';
import { createBookingStore } from '../../context/bookings.js';
import { escapeHtml } from '../../components/html.js';
const slots = [{ id: 'slot-a', startsAt: '2026-12-01T06:00:00Z', endsAt: '2026-12-01T07:00:00Z', timezone: 'Africa/Nairobi', remainingCapacity: 2 }, { id: 'slot-b', startsAt: '2026-12-02T06:00:00Z', endsAt: '2026-12-02T07:00:00Z', timezone: 'Africa/Nairobi', remainingCapacity: 1 }];
const booking = { bookingId: 'booking-a', slotId: 'slot-a', status: 'SCHEDULED', ...slots[0], jobRole: { title: 'Engineering' }, blueprint: { id: 'blueprint-a' }, instructions: 'Bring your ID', durationMinutes: 60, events: [], rescheduleCount: 0 };
const eligibility = { eligible: true, attemptId: 'attempt-a', reasons: [], blueprints: [{ blueprintId: 'blueprint-a', reasons: [] }] };
const client = overrides => ({ bookings: async () => ({ data: [] }), bookingEligibility: async () => eligibility, bookingSlots: async () => slots, bookAssessment: async () => booking, cancelBooking: async () => ({}), rescheduleBooking: async () => booking, ...overrides });
const reply = data => new Response(JSON.stringify({ data }));
test('booking API uses authenticated backend endpoints, CSRF and explicit idempotency keys', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return reply(url.endsWith('/csrf') ? { csrfToken: 'csrf' } : []); } });
  await api.bookingEligibility(); await api.bookingSlots('blueprint-a'); await api.bookings(2);
  await api.bookAssessment('slot-a', 'unique-request-key');
  await api.rescheduleBooking('booking-a', 'slot-b', 'Change time', 'reschedule-key');
  await api.cancelBooking('booking-a', 'Cannot attend');
  const post = calls.find(call => call.url === '/api/v1/assessments/bookings' && call.method === 'POST');
  assert.equal(post.headers['Idempotency-Key'], 'unique-request-key'); assert.equal(post.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(JSON.parse(post.body), { slotId: 'slot-a' });
  const reschedule = calls.find(call => call.url.endsWith('/reschedule'));
  assert.equal(reschedule.headers['Idempotency-Key'], 'reschedule-key');
  assert.deepEqual(JSON.parse(reschedule.body), { slotId: 'slot-b', reason: 'Change time' });
  assert.ok(calls.every(call => call.credentials === 'include'));
});
test('booking uses server eligibility and never loads slots for incomplete or unprepared targets', async () => {
  let slotCalls = 0;
  const store = createBookingStore({ client: client({ bookingEligibility: async () => ({ ...eligibility, eligible: false, attemptId: null, reasons: ['PROFILE_INCOMPLETE'] }), bookingSlots: async () => { slotCalls++; return slots; } }) });
  await store.load('a'); assert.equal(slotCalls, 0); assert.equal(store.snapshot().blueprintId, '');
  assert.equal(await store.mutate('book'), false);
});
test('booking confirmation, reschedule and cancellation refresh persisted backend history', async () => {
  let rows = [], calls = [];
  const api = client({ bookings: async () => ({ data: rows }), bookAssessment: async (slot, key) => { calls.push([slot, key]); rows = [booking]; }, rescheduleBooking: async (id, slot, reason, key) => { calls.push([id, slot, reason, key]); rows = [{ ...booking, bookingId: 'booking-b', slotId: slot, ...slots[1] }, { ...booking, status: 'RESCHEDULED' }]; }, cancelBooking: async (id, reason) => { calls.push([id, reason]); rows[0].status = 'CANCELLED'; } });
  const store = createBookingStore({ client: api, makeKey: () => 'operation-key' });
  await store.load('a'); store.select('slot-a'); assert.equal(await store.mutate('book'), true);
  assert.equal(store.snapshot().bookings.length, 1); assert.deepEqual(calls[0], ['slot-a', 'operation-key']);
  store.mode('reschedule'); store.select('slot-b'); store.reason('  New time please  ');
  assert.equal(await store.mutate('reschedule'), true); assert.equal(store.snapshot().bookings[1].status, 'RESCHEDULED');
  assert.deepEqual(calls[1], ['booking-a', 'slot-b', 'New time please', 'operation-key']);
  store.mode('cancel'); store.reason('Unable to attend'); assert.equal(await store.mutate('cancel'), true);
  assert.equal(store.snapshot().bookings[0].status, 'CANCELLED');
});
test('timeouts and conflicts require reconciliation and never replay or duplicate mutations automatically', async () => {
  let calls = 0;
  const store = createBookingStore({ client: client({ bookAssessment: async () => { calls++; throw new ApiError('Offline'); } }) });
  await store.load('a'); store.select('slot-a'); assert.equal(await store.mutate('book'), false);
  assert.equal(store.snapshot().uncertain, true); await store.mutate('book'); assert.equal(calls, 1);
  await store.load('a', true); assert.equal(store.snapshot().uncertain, false);
});
test('late booking mutations and reads cannot leak across logout or a different user', async () => {
  let resolve, slotCalls = 0;
  const store = createBookingStore({ client: client({ bookings: () => new Promise(r => { resolve = r; }), bookingSlots: async () => { slotCalls++; return slots; } }) });
  const pending = store.load('a'); store.reset(); resolve({ data: [booking] }); await pending;
  assert.equal(store.snapshot().ownerId, null); assert.equal(slotCalls, 0); assert.equal(store.snapshot().bookings.length, 0);
  let finish;
  const mutations = createBookingStore({ client: client({ bookAssessment: () => new Promise(r => { finish = r; }) }) });
  await mutations.load('a'); mutations.select('slot-a'); const request = mutations.mutate('book'); mutations.reset(); finish(booking); await request;
  assert.equal(mutations.snapshot().notice, ''); assert.equal(mutations.snapshot().bookings.length, 0);
});
const compiled = await build({ entryPoints: [new URL('./assessments/booking.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', outfile: '/tmp/nexus-bookings-test.js' });
const { connectedBooking } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const context = data => ({ bookingState: { status: 'ready', bookings: [], slots, eligibility, blueprintId: 'blueprint-a', error: '', notice: '', selectedSlot: '', ...data }, careerState: { activeTarget: null }, escape: escapeHtml, heading: (t, sub, action) => `<h1>${t}</h1>${sub}${action}`, card: (t, body) => `<h2>${t}</h2>${body}`, badge: text => text, button: (text, path) => `<a href="/${path}">${text}</a>` });
test('booking page renders real slots, truthful blockers, history and escaped server text', () => {
  const html = connectedBooking(context({})); assert.ok(html.includes('data-slot-id="slot-a"')); assert.ok(!html.includes('demo booking'));
  assert.ok(html.includes('Africa/Nairobi')); assert.ok(html.includes('2 places'));
  const blocked = connectedBooking(context({ blueprintId: '', eligibility: { attemptId: null, reasons: ['PROFILE_INCOMPLETE'], blueprints: [] } }));
  assert.ok(blocked.includes('Complete your profile')); assert.ok(!blocked.includes('data-slot-id='));
  const active = connectedBooking(context({ bookings: [{ ...booking, instructions: '<script>bad</script>' }] }));
  assert.ok(active.includes('Reschedule')); assert.ok(active.includes('&lt;script&gt;')); assert.ok(!active.includes('<script>'));
});

test('dual-role applicants receive an administrator MFA handoff without bypassing backend gates', async () => {
  const store = createBookingStore({ client: client({ bookings: async () => { throw new ApiError('Complete admin MFA', 403, 'MFA_REQUIRED'); } }) });
  await store.load('a'); assert.equal(store.snapshot().requiresMfa, true);
  assert.ok(connectedBooking(context(store.snapshot())).includes('http://localhost:3002/dashboard'));
  assert.ok(connectedBooking(context(store.snapshot())).includes('Complete administrator security check'));
});

test('rejected identities block booking and link directly to verification history and replacement', async () => {
  let slotCalls = 0, reservations = 0;
  const rejected = { ...eligibility, eligible: false, reasons: ['IDENTITY_REJECTED'], blueprints: [{ blueprintId: 'blueprint-a', reasons: ['IDENTITY_REJECTED'] }], identityRecovery: { documentId: 'rejected/id' } };
  const store = createBookingStore({ client: client({ bookingEligibility: async () => rejected, bookingSlots: async () => { slotCalls++; return slots; }, bookAssessment: async () => { reservations++; } }) });
  await store.load('applicant');
  assert.equal(await store.mutate('book'), false); assert.equal(slotCalls, 0); assert.equal(reservations, 0);
  const html = connectedBooking(context(store.snapshot()));
  assert.match(html, /identity document was rejected/); assert.match(html, /provide the requested evidence/);
  assert.ok(html.includes('/document?id=rejected%2Fid')); assert.ok(html.includes('/upload?replace=rejected%2Fid'));
  assert.ok(!html.includes('data-slot-id='));
});

test('rejection after booking retains the scheduled booking and its change controls', async () => {
  let cancellations = 0;
  const rejected = { ...eligibility, eligible: false, reasons: ['IDENTITY_REJECTED'], blueprints: [], identityRecovery: { documentId: 'identity' } };
  const store = createBookingStore({ client: client({ bookings: async () => ({ data: [booking] }), bookingEligibility: async () => rejected, cancelBooking: async () => { cancellations++; } }) });
  await store.load('applicant');
  const html = connectedBooking(context(store.snapshot()));
  assert.equal(store.snapshot().bookings[0].status, 'SCHEDULED'); assert.equal(cancellations, 0);
  assert.match(html, /Your booking remains scheduled/); assert.match(html, /Before your assessment/);
  assert.match(html, /Cancel booking/); assert.match(html, /Review rejected identity/);
  assert.match(html, /Open assessment/);
});

test('refresh after successful identity recovery restores booking eligibility and removes rejection guidance', async () => {
  let valid = false, slotsLoaded = 0;
  const store = createBookingStore({ client: client({ bookingEligibility: async () => valid ? { ...eligibility, identityRecovery: null } : { ...eligibility, eligible: false, reasons: ['IDENTITY_REJECTED'], blueprints: [], identityRecovery: { documentId: 'old-id' } }, bookingSlots: async () => { slotsLoaded++; return slots; } }) });
  await store.load('applicant'); valid = true; await store.load('applicant', true);
  assert.equal(slotsLoaded, 1); assert.equal(store.snapshot().blueprintId, 'blueprint-a');
  const html = connectedBooking(context(store.snapshot()));
  assert.ok(!html.includes('Review rejected identity')); assert.ok(html.includes('data-slot-id="slot-a"'));
});

const immediateEligibility = { ...eligibility, blueprints: [{ blueprintId: 'blueprint-a', reasons: [], onDemand: { enabled: true, available: true, remainingCapacity: 1, durationMinutes: 10, setupMinutes: 5, reasons: [] } }] };
test('immediate admission reserves once without a selected scheduled slot and refreshes owned history', async () => {
  let rows = [], calls = [];
  const store = createBookingStore({ client: client({ bookingEligibility: async () => immediateEligibility, bookingSlots: async () => [], bookings: async () => ({ data: rows }), reserveOnDemand: async (id, key) => { calls.push([id, key]); rows = [{ ...booking, onDemand: true, setupExpiresAt: '2099-01-01T00:00:00Z' }]; return rows[0]; } }), makeKey: () => 'immediate-request-key' });
  await store.load('owner');
  const before = connectedBooking(context(store.snapshot()));
  assert.match(before, /Continue now/); assert.match(before, /full assessment time begins/);
  assert.equal(await store.mutate('on-demand'), true);
  assert.deepEqual(calls, [['blueprint-a', 'immediate-request-key']]); assert.equal(store.snapshot().reservationId, booking.bookingId);
  assert.equal(await store.mutate('on-demand'), false);
  const html = connectedBooking(context(store.snapshot()));
  assert.match(html, /Your immediate assessment/); assert.match(html, /Complete device checks and start by/);
  assert.match(html, /data-booking-action="reschedule" disabled/);
  assert.doesNotMatch(html, /data-booking-action="cancel" disabled/);
});
test('full capacity keeps scheduled times available and cannot submit an immediate request', async () => {
  let reservations = 0;
  const full = { ...immediateEligibility, blueprints: [{ ...immediateEligibility.blueprints[0], onDemand: { ...immediateEligibility.blueprints[0].onDemand, available: false, remainingCapacity: 0, reasons: ['ON_DEMAND_FULL'] } }] };
  const store = createBookingStore({ client: client({ bookingEligibility: async () => full, reserveOnDemand: async () => { reservations++; } }) });
  await store.load('owner'); assert.equal(await store.mutate('on-demand'), false); assert.equal(reservations, 0);
  const html = connectedBooking(context(store.snapshot()));
  assert.match(html, /Immediate assessment is currently unavailable/); assert.match(html, /data-slot-id="slot-a"/);
  assert.match(html, /data-booking-action="on-demand" disabled/);
});
test('unknown immediate reservation outcomes require refresh and never replay automatically', async () => {
  let calls = 0, rows = [];
  const store = createBookingStore({ client: client({ bookingEligibility: async () => immediateEligibility, bookings: async () => ({ data: rows }), reserveOnDemand: async () => { calls++; rows = [{ ...booking, onDemand: true }]; throw new ApiError('Disconnected'); } }) });
  await store.load('owner'); assert.equal(await store.mutate('on-demand'), false);
  assert.equal(store.snapshot().uncertain, true); await store.mutate('on-demand'); assert.equal(calls, 1);
  await store.load('owner', true); assert.equal(store.snapshot().bookings[0].onDemand, true);
  assert.equal(await store.mutate('on-demand'), false); assert.equal(calls, 1);
});
test('late immediate reservations cannot navigate or restore another account', async () => {
  let finish;
  const store = createBookingStore({ client: client({ bookingEligibility: async () => immediateEligibility, reserveOnDemand: () => new Promise(resolve => { finish = resolve; }) }) });
  await store.load('first'); const pending = store.mutate('on-demand'); store.reset(); await store.load('second');
  finish({ ...booking, onDemand: true }); assert.equal(await pending, false); assert.equal(store.snapshot().reservationId, ''); assert.equal(store.snapshot().ownerId, 'second');
});
test('immediate API carries explicit idempotency and CSRF without starting an interview', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return reply(url.endsWith('/csrf') ? { csrfToken: 'csrf-immediate' } : booking); } });
  await api.reserveOnDemand('blueprint-a', 'immediate-key');
  const call = calls.find(c => c.url.endsWith('/on-demand'));
  assert.equal(call.method, 'POST'); assert.equal(call.credentials, 'include'); assert.equal(call.headers['Idempotency-Key'], 'immediate-key'); assert.equal(call.headers['X-CSRF-Token'], 'csrf-immediate');
  assert.deepEqual(JSON.parse(call.body), { blueprintId: 'blueprint-a' }); assert.ok(!calls.some(c => c.url.endsWith('/start')));
});
