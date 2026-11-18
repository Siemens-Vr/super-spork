import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminApi } from './api.js';
import { createAdminStore, transitions } from './store.js';
import { loadView } from '../../test-utils/load-view.mjs';
const views = await loadView(new URL('./views.js', import.meta.url));
const { authView, shell, documentPage, applicantPage, documentsPage, overview, accountStatusDialog, previewDialog } = views;
const admin = { id: 'admin-a', legalName: 'Admin Example', email: 'admin@example.test', phone: null, roles: ['ADMIN'], permissions: ['users.manage', 'documents.review', 'documents.verify'], emailVerifiedAt: '2026-11-01' };
const document = { id: 'doc-a', applicantId: 'applicant-a', category: 'BACHELOR', title: 'Degree.pdf', size: 1234, mimeType: 'application/pdf', courseName: 'Engineering', institutionName: 'Example College', status: 'UNDER_REVIEW', scanStatus: 'CLEAN', createdAt: '2026-11-13T08:00:00Z', history: [], reviews: [], evidence: [] };
const applicant = { id: 'applicant-a', legalName: 'Applicant Example', email: 'applicant@example.test', phone: '+254712345678', status: 'ACTIVE', profile: { country: 'KE', discipline: 'Engineering' }, documents: [document] };
const response = (data, meta) => ({ data, meta });
const client = overrides => ({
  me: async () => admin, clear() {}, login: async () => ({}), logout: async () => {},
  applicants: async () => response([applicant], { total: 1, page: 1, limit: 20 }),
  applicant: async () => applicant,
  reviewDocuments: async () => response([document], { page: 1, limit: 20 }), reviewDocument: async () => document,
  review: async () => ({}), evidence: async () => ({}), accountStatus: async () => ({}),
  setupMfa: async () => ({ provisioningUri: 'otpauth://totp/NEXUS?secret=TESTKEY', recoveryCodes: ['test-recovery-code'] }),
  verifyMfa: async () => ({}), download: async () => ({ blob: new Blob(['test'], { type: 'application/pdf' }) }), ...overrides,
});
const failure = (code, status = 403) => Object.assign(new Error(code), { code, status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('admin API preserves pagination and uses exact protected endpoints with cookies and CSRF', async () => {
  const calls = [];
  const api = createAdminApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/csrf')) return Response.json({ data: { csrfToken: 'csrf-one' } });
    if (url.endsWith('/download')) return new Response('file', { headers: { 'Content-Type': 'application/pdf' } });
    return Response.json({ data: [], meta: { total: 37, page: 2, limit: 20 } });
  } });
  assert.equal((await api.applicants({ search: 'a+b@example.test', status: 'ACTIVE', page: 2 })).meta.total, 37);
  assert.equal(calls[0].url, '/api/v1/admin/applicants?search=a%2Bb%40example.test&status=ACTIVE&page=2');
  await api.reviewDocuments({ identity: 'true', applicantId: 'a/b' });
  await api.applicant('a/b'); await api.reviewDocument('d/a');
  await api.accountStatus('a/b', { status: 'SUSPENDED', reason: 'A recorded reason' });
  await api.review('d/a', { outcome: 'UNDER_REVIEW', method: 'MANUAL', reason: 'Starting manual review' });
  await api.evidence('d/a', { note: 'Supporting evidence' });
  await api.setupMfa(); await api.verifyMfa('123456'); await api.reauthenticate('test-password');
  assert.equal((await api.download('d/a')).blob.type, 'application/pdf');
  const writes = calls.filter(call => call.method === 'POST' || call.method === 'PATCH');
  assert.ok(calls.every(call => call.credentials === 'include'));
  assert.ok(writes.every(call => call.headers['X-CSRF-Token'] === 'csrf-one'));
  assert.deepEqual(writes.map(call => call.url), ['/api/v1/admin/applicants/a%2Fb/status', '/api/v1/admin/documents/d%2Fa/reviews', '/api/v1/admin/documents/d%2Fa/evidence', '/api/v1/auth/mfa/setup', '/api/v1/auth/mfa/verify', '/api/v1/auth/reauthenticate']);
  assert.deepEqual(JSON.parse(writes[4].body), { code: '123456' });
});

test('MFA gates privileged data, rejects invalid codes without logging out, and clears setup secrets after verification', async () => {
  let verified = false, valid = false, reads = 0;
  const store = createAdminStore({ client: client({
    applicants: async () => { reads++; if (!verified) throw failure('MFA_REQUIRED'); return response([], { total: 0 }); },
    verifyMfa: async () => { if (!valid) throw failure('MFA_INVALID', 401); verified = true; },
  }) });
  await store.boot(); assert.equal(store.snapshot().auth, 'mfa'); assert.equal(store.snapshot().data, null);
  await store.authAction('setup'); assert.equal(store.snapshot().setup.recoveryCodes.length, 1);
  assert.equal(await store.authAction('mfa', { code: '123456' }), false);
  assert.equal(store.snapshot().auth, 'mfa'); assert.equal(store.snapshot().user.id, admin.id);
  assert.equal(store.snapshot().authError, 'MFA_INVALID');
  valid = true; await store.authAction('mfa', { code: '654321' });
  assert.equal(store.snapshot().auth, 'ready'); assert.equal(store.snapshot().setup, null); assert.equal(reads, 2);
});

test('applicant-only accounts are rejected without accessing private admin endpoints', async () => {
  let reads = 0;
  const store = createAdminStore({ client: client({ me: async () => ({ ...admin, roles: ['APPLICANT'] }), applicants: async () => { reads++; } }) });
  await store.boot(); assert.equal(store.snapshot().auth, 'denied'); assert.equal(reads, 0);
  assert.ok(authView(store.snapshot()).includes('Administrator access required'));
});

test('forced refresh fetches fresh document status and preserves a confirmed mutation notice', async () => {
  let status = 'UNDER_REVIEW';
  const calls = [];
  const store = createAdminStore({ client: client({
    reviewDocument: async () => ({ ...document, status }),
    review: async (id, body) => { calls.push({ id, body }); status = body.outcome; },
  }) });
  await store.boot(); await store.load('document', { id: document.id });
  assert.equal(await store.mutate('review', document.id, { outcome: 'AUTHENTICATED', method: 'OFFICIAL_VERIFICATION', reason: '  Checked the issuing body  ', evidenceReference: ' Official register 123 ', internalNotes: '', applicantId: 'forged' }), true);
  await store.load('document', { id: document.id }, true);
  assert.equal(store.snapshot().data.document.status, 'AUTHENTICATED');
  assert.match(store.snapshot().notice, /Review saved/);
  assert.deepEqual(calls[0], { id: document.id, body: { outcome: 'AUTHENTICATED', method: 'OFFICIAL_VERIFICATION', reason: 'Checked the issuing body', evidenceReference: 'Official register 123' } });
});

test('review guards disallow invalid transitions and AI authentication; backend failures are not replayed', async () => {
  let writes = 0;
  const store = createAdminStore({ client: client({ review: async () => { writes++; throw failure('DOCUMENT_SUPERSEDED', 409); } }) });
  await store.boot(); await store.load('document', { id: document.id });
  assert.equal(await store.mutate('review', document.id, { outcome: 'UPLOADED' }), false);
  assert.equal(await store.mutate('review', document.id, { outcome: 'AUTHENTICATED', method: 'AI_ASSISTED', evidenceReference: 'ref' }), false);
  assert.equal(await store.mutate('review', document.id, { outcome: 'AUTHENTICATED', method: 'MANUAL', evidenceReference: '' }), false);
  assert.equal(writes, 0);
  assert.equal(await store.mutate('review', document.id, { outcome: 'REJECTED', method: 'MANUAL', reason: 'Incorrect qualification details' }), false);
  assert.equal(writes, 1); assert.equal(store.snapshot().error, 'DOCUMENT_SUPERSEDED'); assert.equal(store.snapshot().notice, '');
  assert.equal(store.snapshot().data.document.status, 'UNDER_REVIEW');
});

test('expired MFA removes private data and never replays an account mutation automatically', async () => {
  let writes = 0;
  const store = createAdminStore({ client: client({ accountStatus: async () => { writes++; throw failure('MFA_REQUIRED'); } }) });
  await store.boot(); await store.load('applicant', { id: applicant.id });
  assert.equal(await store.mutate('status', applicant.id, { status: 'SUSPENDED', reason: 'A verified account issue' }), false);
  assert.equal(store.snapshot().auth, 'mfa'); assert.equal(store.snapshot().data, null); assert.equal(writes, 1); assert.equal(store.snapshot().busy, false);
  await store.authAction('mfa', { code: '123456' }); assert.equal(writes, 1);
});

test('logout discards late private reads and downloads, and clears one-time MFA setup material', async () => {
  const read = deferred(), file = deferred();
  const store = createAdminStore({ client: client({ applicant: () => read.promise, download: () => file.promise }) });
  await store.boot();
  const load = store.load('applicant', { id: applicant.id }), download = store.download(document.id);
  await store.logout(); read.resolve(applicant); file.resolve({ blob: new Blob(['private']) });
  await load; assert.equal(await download, null); assert.equal(store.snapshot().data, null); assert.equal(store.snapshot().user, null); assert.equal(store.snapshot().auth, 'login');
});

test('newer searches win over late list responses and pagination filters reach the API', async () => {
  const slow = deferred(), searches = [];
  const store = createAdminStore({ client: client({ applicants: async filters => { searches.push(filters); return filters.search === 'old' ? slow.promise : response([applicant], { total: 1 }); } }) });
  await store.boot();
  const old = store.load('applicants', { search: 'old', page: 1, limit: 20 });
  await store.load('applicants', { search: 'new', status: 'ACTIVE', page: 2, limit: 20 });
  slow.resolve(response([], { total: 0 })); await old;
  assert.equal(store.snapshot().data.data[0].id, applicant.id);
  assert.deepEqual(searches.at(-1), { search: 'new', status: 'ACTIVE', page: 2, limit: 20 });
});

test('document and applicant views escape private text and disable decisions for unscanned or previous files', () => {
  const dangerous = '<img src=x onerror=alert(1)>';
  const base = { user: admin, error: '', notice: '', data: { document: { ...document, title: dangerous, history: [{ toStatus: 'UNDER_REVIEW', reason: dangerous, createdAt: document.createdAt }], reviews: [{ outcome: 'UNDER_REVIEW', method: 'MANUAL', reason: dangerous, internalNotes: dangerous }], evidence: [{ note: dangerous }] }, applicant: { ...applicant, legalName: dangerous }, previous: false } };
  const rendered = documentPage(base, () => true);
  assert.ok(!rendered.includes(dangerous)); assert.match(rendered, /&lt;img/);
  assert.ok(rendered.includes('name="evidenceReference"')); assert.ok(rendered.includes('Reason for the applicant'));
  assert.ok(!documentPage({ ...base, data: { ...base.data, document: { ...document, scanStatus: 'QUARANTINED' } } }, () => true).includes('data-admin-form="review"'));
  assert.ok(!documentPage({ ...base, data: { ...base.data, previous: true } }, () => true).includes('data-admin-form="review"'));
  assert.ok(!applicantPage({ data: { ...applicant, legalName: dangerous } }, () => true).includes(dangerous));
  assert.ok(!accountStatusDialog({ ...applicant, legalName: dangerous }).includes(dangerous));
  assert.ok(previewDialog(dangerous).includes('id="admin-dialog-error"'));
});

test('overview totals use backend metadata and document pagination does not invent a total', () => {
  const rendered = overview({ user: admin, data: { applicants: response([applicant], { total: 143 }), active: response([], { total: 120 }), suspended: response([], { total: 8 }), documents: response([document]) } });
  assert.ok(rendered.includes('143')); assert.ok(rendered.includes('120')); assert.ok(rendered.includes('8'));
  const page = documentsPage({ data: response([document]) }, { page: 2, limit: 20, status: 'UNDER_REVIEW' });
  assert.ok(page.includes('Page 2 · 1 document')); assert.ok(page.includes('status=UNDER_REVIEW'));
  const layout = shell({ user: admin }, 'dashboard', '');
  assert.ok(layout.includes('aria-controls="admin-sidebar"')); assert.ok(layout.includes('aria-expanded="false"'));
  assert.ok(!layout.includes('Assessments')); assert.ok(!layout.includes('Learning plan'));
});

test('account status and evidence submit only supported backend fields', async () => {
  const writes = [];
  const store = createAdminStore({ client: client({ accountStatus: async (id, body) => writes.push({ id, body }), evidence: async (id, body) => writes.push({ id, body }) }) });
  await store.boot(); await store.load('applicant', { id: applicant.id });
  await store.mutate('status', applicant.id, { status: 'SUSPENDED', reason: ' Account review required ', confirm: 'on', roles: ['ADMIN'] });
  await store.mutate('evidence', document.id, { note: ' Verified institution email ', reference: ' Reference 12 ', internal: true });
  assert.deepEqual(writes, [{ id: applicant.id, body: { status: 'SUSPENDED', reason: 'Account review required' } }, { id: document.id, body: { note: 'Verified institution email', reference: 'Reference 12' } }]);
});

test('admin credential entry uses the shared sign-in page while retaining the MFA form', () => {
  const login = authView({ auth: 'login' }, 'login');
  assert.ok(login.includes('http://localhost:3000/login'));
  assert.ok(!login.includes('data-admin-form="login"'));
  assert.ok(!login.includes('name="password"'));
  const mfa = authView({ auth: 'mfa', busy: false, setup: null });
  assert.ok(mfa.includes('data-admin-form="mfa"'));
  assert.ok(mfa.includes('Authenticator or recovery code'));
});

test('email MFA sends only through protected endpoints and retains the gate until code verification', async () => {
  let passed = false, sent = 0, verified = 0;
  const store = createAdminStore({ client: client({
    applicants: async () => { if (!passed) throw { code: 'MFA_REQUIRED', status: 403 }; return response([], { total: 0 }); },
    sendEmailMfa: async () => { sent++; return { expiresInSeconds: 300, resendAfterSeconds: 60 }; },
    verifyEmailMfa: async code => { verified++; if (code !== '123456') throw { code: 'MFA_INVALID', status: 401, message: 'Invalid email code' }; passed = true; },
  }) });
  await store.boot(); store.setMfaMethod('email');
  assert.equal(store.snapshot().auth, 'mfa');
  assert.ok(authView(store.snapshot()).includes('Send email code'));
  await store.authAction('email-send');
  assert.equal(sent, 1); assert.equal(store.snapshot().emailSent, true);
  assert.ok(authView(store.snapshot()).includes('Email verification code'));
  await store.authAction('email-send'); assert.equal(sent, 1);
  await store.authAction('mfa', { code: '000000' }); assert.equal(store.snapshot().auth, 'mfa');
  await store.authAction('mfa', { code: '123456' }); assert.equal(verified, 2); assert.equal(store.snapshot().auth, 'ready');
});

test('authenticator setup includes a local QR image and downloadable recovery text without its secret', async () => {
  const { recoveryCodeFile } = await import('./store.js');
  const store = createAdminStore({ client: client({ applicants: async () => { throw { code: 'MFA_REQUIRED', status: 403 }; } }) });
  await store.boot(); await store.authAction('setup');
  assert.ok(store.snapshot().setup.qrCode.startsWith('data:image/png;base64,'));
  const html = authView(store.snapshot());
  assert.ok(html.includes('Scan this QR code'));
  assert.ok(html.includes('Download recovery codes (.txt)'));
  const text = recoveryCodeFile(store.snapshot().setup.recoveryCodes);
  assert.ok(text.includes('test-recovery-code')); assert.ok(text.includes('Each code can be used once'));
  assert.ok(!text.includes('TESTKEY')); assert.ok(!text.includes('otpauth'));
  store.setMfaMethod('email'); assert.equal(store.snapshot().setup, null);
});

test('assessment admin publishes exact policies, updates availability and cancels bookings', async () => {
  const calls = [];
  const manager = { ...admin, permissions: ['assessments.manage'] };
  const api = client({ me: async () => manager, availability: async () => response([], {}), blueprints: async () => response([], {}), publishAvailability: async body => { calls.push(['publish', body]); }, updateAvailability: async (id, body) => { calls.push(['update', id, body]); }, cancelAdminBooking: async (id, reason) => { calls.push(['cancel', id, reason]); }, adminBookings: async () => response([], {}), adminBooking: async () => ({ bookingId: 'b' }) });
  const store = createAdminStore({ client: api }); await store.boot(); assert.equal(store.snapshot().auth, 'ready');
  await store.load('availability', { page: 1, limit: 20 });
  assert.deepEqual(store.snapshot().data.blueprints, []);
  const input = { blueprintId: 'blueprint-a', startsAt: '2026-12-01T09:00', endsAt: '2026-12-01T12:00', timezone: 'Africa/Nairobi', capacity: '3', minNoticeMinutes: '60', maxHorizonDays: '90', cancellationNoticeMinutes: '120', rescheduleLimit: '2' };
  assert.equal(await store.mutate('publish-availability', '', input), true);
  assert.deepEqual(calls[0][1], { blueprintId: 'blueprint-a', startsAt: '2026-12-01T06:00:00.000Z', endsAt: '2026-12-01T09:00:00.000Z', timezone: 'Africa/Nairobi', capacity: 3, minNoticeMinutes: 60, maxHorizonDays: 90, cancellationNoticeMinutes: 120, rescheduleLimit: 2 });
  await store.mutate('update-availability', 'window-a', { capacity: '4', active: 'false' });
  assert.deepEqual(calls[1], ['update', 'window-a', { capacity: 4, active: false }]);
  await store.mutate('cancel-booking', 'booking-a', { reason: '  Provider unavailable  ' });
  assert.deepEqual(calls[2], ['cancel', 'booking-a', 'Provider unavailable']);
  await store.load('bookings', { page: 1, limit: 20 }); assert.deepEqual(store.snapshot().data.data, []);
});
test('admin scheduling failures preserve input and require refresh before repeating unknown outcomes', async () => {
  let calls = 0;
  const store = createAdminStore({ client: client({ me: async () => ({ ...admin, permissions: ['assessments.manage'] }), availability: async () => response([], {}), blueprints: async () => response([], {}), publishAvailability: async () => { calls++; throw failure('NETWORK_ERROR', 0); } }) });
  await store.boot();
  const input = { blueprintId: 'b', startsAt: '2026-12-01T09:00', endsAt: '2026-12-01T12:00', timezone: 'UTC', capacity: '1' };
  await store.mutate('publish-availability', '', input); assert.equal(store.snapshot().mutationUncertain, true);
  await store.mutate('publish-availability', '', input); assert.equal(calls, 1);
  await store.load('availability', {}, true); assert.equal(store.snapshot().mutationUncertain, false);
});
test('availability and booking views use real records and show controls only to scheduling managers', async () => {
  const { availabilityPage, availabilityDialog, bookingsPage, bookingPage } = views;
  const window = { id: 'w', blueprintId: 'bp', startsAt: '2026-12-01T06:00:00Z', endsAt: '2026-12-01T08:00:00Z', timezone: 'Africa/Nairobi', active: true, capacity: 2 };
  const html = availabilityPage({ data: { windows: response([window]), blueprints: [{ id: 'bp', title: '<script>', active: true, framework: { approved: true, scope: 'CORE' }, durationMinutes: 60, version: 1 }] } }, { page: 1, limit: 20 });
  assert.ok(html.includes('Publish availability')); assert.ok(availabilityDialog(window, []).includes('data-admin-form="update-availability"')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  const b = { bookingId: 'b', applicantId: 'a', jobRole: { title: 'Engineering' }, blueprint: { title: 'Core', version: 1 }, startsAt: window.startsAt, endsAt: window.endsAt, timezone: 'Africa/Nairobi', status: 'SCHEDULED', events: [{ action: 'SCHEDULED', createdAt: window.startsAt, reason: '<bad>' }], instructions: 'Prepare', rescheduleCount: 0 };
  assert.ok(bookingsPage({ data: response([b]) }, { page: 1, limit: 20 }).includes('/booking?id=b'));
  assert.ok(bookingPage({ data: b }).includes('data-admin-form="cancel-booking"'));
  assert.ok(!bookingPage({ data: { ...b, status: 'CANCELLED' } }).includes('data-admin-form="cancel-booking"'));
  assert.ok(!shell({ user: admin }, 'dashboard', '').includes('/availability'));
  assert.ok(shell({ user: { ...admin, permissions: ['assessments.manage'] } }, 'availability', '').includes('/availability'));
});

test('admin scheduling API uses protected exact routes and JSON payloads', async () => {
  const calls = [];
  const api = createAdminApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'token' } : [], meta: { page: 1, limit: 20 } })); } });
  await api.availability({ page: 2, limit: 20 }); await api.blueprints({ limit: 100 });
  await api.publishAvailability({ blueprintId: 'b' }); await api.updateAvailability('w', { active: false, capacity: 2 });
  await api.adminBookings({ status: 'SCHEDULED', applicantId: 'a' }); await api.adminBooking('booking-1'); await api.cancelAdminBooking('booking-1', 'Provider unavailable');
  assert.ok(calls.some(call => call.url === '/api/v1/admin/availability?page=2&limit=20'));
  const update = calls.find(call => call.method === 'PATCH'); assert.equal(update.url, '/api/v1/admin/availability/w'); assert.deepEqual(JSON.parse(update.body), { active: false, capacity: 2 });
  const cancel = calls.find(call => call.url.endsWith('/cancel')); assert.deepEqual(JSON.parse(cancel.body), { reason: 'Provider unavailable' }); assert.equal(cancel.headers['X-CSRF-Token'], 'token');
});

test('calendar handles Nairobi midnight, leap years, year boundaries and exclusive end dates', async () => {
  const { calendarDay, monthDays, moveMonth, windowsOnDay } = await import('./availability-calendar.js');
  assert.equal(calendarDay('2026-11-30T22:00:00Z'), '2026-12-01');
  assert.equal(moveMonth('2026-12', 1), '2027-01');
  assert.equal(moveMonth('2027-01', -1), '2026-12');
  assert.equal(monthDays('2024-02').includes('2024-02-29'), true);
  assert.equal(new Date(monthDays('2026-11')[0] + 'T12:00:00Z').getUTCDay(), 1);
  assert.equal(monthDays('2026-11').length % 7, 0);
  const windows = [{ startsAt: '2026-11-30T21:00:00Z', endsAt: '2026-12-02T21:00:00Z' }];
  assert.equal(windowsOnDay(windows, '2026-11-30').length, 0);
  assert.equal(windowsOnDay(windows, '2026-12-01').length, 1);
  assert.equal(windowsOnDay(windows, '2026-12-02').length, 1);
  assert.equal(windowsOnDay(windows, '2026-12-03').length, 0);
});
test('calendar filters by career, blueprint and status and exposes crowded-day details safely', async () => {
  const { matchingWindows } = await import('./availability-calendar.js');
  const { availabilityCalendar, availabilityDialog } = views;
  const blueprint = { id: 'bp', jobRoleId: 'career', title: '<script>bad</script>', jobRole: { title: 'Engineering' } };
  const windows = Array.from({ length: 4 }, (_, i) => ({ id: `w${i}`, blueprintId: 'bp', startsAt: '2026-12-01T06:00:00Z', endsAt: '2026-12-01T08:00:00Z', capacity: 2, active: i !== 0, timezone: 'UTC' }));
  assert.equal(matchingWindows(windows, [blueprint], { career: 'career', blueprint: 'bp', active: 'true' }).length, 3);
  assert.equal(matchingWindows(windows, [blueprint], { career: 'missing' }).length, 0);
  const html = availabilityCalendar({ windows: response(windows), blueprints: [blueprint] }, { month: '2026-12', day: '2026-12-01' });
  assert.ok(html.includes('+2 more')); assert.ok(html.includes('4 availability windows'));
  assert.ok(html.includes('Africa/Nairobi')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  const dialog = availabilityDialog(windows[0], [blueprint]);
  assert.ok(dialog.includes('id="edit-capacity"')); assert.ok(dialog.includes('name="capacity"'));
});
test('calendar loads all availability pages instead of only the first twenty records', async () => {
  const calls = [];
  const rows = Array.from({ length: 105 }, (_, i) => ({ id: `w${i}` }));
  const store = createAdminStore({ client: client({ me: async () => ({ ...admin, permissions: ['assessments.manage'] }), availability: async ({ page, limit }) => { calls.push([page, limit]); return response(rows.slice((page - 1) * limit, page * limit)); }, blueprints: async () => response([]) }) });
  await store.boot(); calls.length = 0; await store.load('availability');
  assert.equal(store.snapshot().data.windows.data.length, 105);
  assert.deepEqual(calls, [[1, 100], [2, 100]]);
});

test('assessor-only admins open the review queue, publish reviewed scores and retain MFA gates', async () => {
  const { assessmentReviewsPage, assessmentReviewPage } = views;
  const manager = { ...admin, permissions: ['assessments.review'] };
  let published;
  const data = { id: 'session-a', status: 'AWAITING_REVIEW', applicantId: 'applicant-a', messages: [{ role: 'APPLICANT', text: '<script>bad</script>' }], evaluation: [{ requirementId: 'r', name: 'Diagnostics', score: 50, requiredScore: 70, weight: 1, evidence: 'Evidence supports diagnosis.' }] };
  const store = createAdminStore({ client: client({ me: async () => manager, assessmentReviews: async () => response([], { total: 0 }), assessmentReview: async () => data, approveAssessment: async (id, body, key) => { published = { id, body, key }; } }) });
  await store.boot(); assert.equal(store.snapshot().auth, 'ready');
  await store.load('assessment-review', { id: 'session-a' });
  const html = assessmentReviewPage(store.snapshot()); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('Publish final results'));
  await store.mutate('approve-assessment', 'session-a', { 'score-r': '80', 'evidence-r': 'Reviewed safe diagnostic evidence.' });
  assert.deepEqual(published.body.results, [{ requirementId: 'r', score: 80, evidence: 'Reviewed safe diagnostic evidence.' }]);
  assert.equal(published.id, 'session-a'); assert.ok(published.key.startsWith('review-'));
  assert.ok(shell({ user: manager }, 'assessment-reviews', '').includes('/assessment-reviews'));
  assert.ok(!assessmentReviewPage({ data: { ...data, status: 'COMPLETED' } }).includes('data-admin-form="approve-assessment"'));
  assert.ok(assessmentReviewsPage({ data: response([], { total: 0 }) }, { page: 1, limit: 20 }).includes('No assessment sessions'));
});

test('assessment managers configure delivery while supervision and equipment forbid immediate access', async () => {
  const { deliveryDialog, availabilityPage } = views;
  const writes = [], manager = { ...admin, permissions: ['assessments.manage'] };
  const bp = { id: 'bp', title: '<PLC>', onDemandEnabled: false, onDemandCapacity: 2, requiresSupervision: true };
  const store = createAdminStore({ client: client({ me: async () => manager, availability: async () => response([]), updateDelivery: async (id, body) => writes.push([id, body]) }) });
  await store.boot();
  assert.equal(await store.mutate('update-delivery', 'bp', { onDemandEnabled: 'true', onDemandCapacity: '2', requiresSupervision: 'true', requiresEquipment: 'false' }), false); assert.equal(writes.length, 0);
  assert.equal(await store.mutate('update-delivery', 'bp', { onDemandEnabled: 'true', onDemandCapacity: '2', requiresSupervision: 'false', requiresEquipment: 'false' }), true);
  assert.deepEqual(writes, [['bp', { onDemandEnabled: true, onDemandCapacity: 2, requiresSupervision: false, requiresEquipment: false }]]);
  assert.match(deliveryDialog(bp), /data-admin-form="update-delivery"/); assert.match(deliveryDialog(bp), /&lt;PLC&gt;/);
  assert.match(availabilityPage({ data: { blueprints: [bp], windows: response([]) } }, {}), /Supervision required/);
});
test('delivery settings API uses the protected blueprint route and JSON boolean settings', async () => {
  const calls = [], body = { onDemandEnabled: true, onDemandCapacity: 2, requiresSupervision: false, requiresEquipment: false };
  const api = createAdminApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return Response.json({ data: url.endsWith('/csrf') ? { csrfToken: 'csrf' } : {} }); } });
  await api.updateDelivery('a/b', body);
  const call = calls.find(c => c.method === 'PATCH'); assert.equal(call.url, '/api/v1/admin/blueprints/a%2Fb/delivery'); assert.deepEqual(JSON.parse(call.body), body); assert.equal(call.headers['X-CSRF-Token'], 'csrf');
});
