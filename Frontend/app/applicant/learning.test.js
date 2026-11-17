import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningStore } from '../../context/learning.js';
import { createAssessmentStore } from '../../context/assessment.js';
import { connectedLearning, connectedResults } from '../../context/assessment-views.js';
import { createApi } from '../../lib/api.js';
import { escapeHtml } from '../../components/html.js';

const upcoming = { bookingId: 'upcoming', attemptId: 'new-attempt', status: 'SCHEDULED' };
const completed = { bookingId: 'completed', attemptId: 'old-attempt', status: 'COMPLETED' };
const plan = { id: 'old-plan', items: [{ id: 'activity', objective: 'Practice safe isolation', status: 'PENDING', resources: ['https://example.com/training'] }] };
const attempt = { id: completed.attemptId, completedAt: '2026-11-01T12:00:00Z', learningPlan: plan };
const client = overrides => ({
  bookings: async () => ({ data: [upcoming, completed] }),
  assessmentAttempt: async id => { assert.equal(id, completed.attemptId); return structuredClone(attempt); },
  ...overrides,
});
const context = state => ({ learningState: state, escape: escapeHtml, heading: title => `<h1>${title}</h1>`, card: (title, body) => `<section><h2>${title}</h2>${body}</section>` });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('upcoming assessment and completed learning plan load independently, including saved progress', async () => {
  const calls = [];
  const api = client({
    bookingPreflight: async id => { calls.push(id); return { session: null }; },
    learningProgress: async (planId, itemId, status) => {
      assert.equal(planId, plan.id); assert.equal(itemId, 'activity'); assert.equal(status, 'COMPLETED');
      return { ...plan, items: [{ ...plan.items[0], status }] };
    },
  });
  const assessment = createAssessmentStore({ client: api }), learning = createLearningStore({ client: api });
  await assessment.load('owner');
  assert.equal(assessment.snapshot().bookingId, upcoming.bookingId);
  await learning.load('owner');
  assert.equal(learning.snapshot().bookingId, completed.bookingId);
  assert.equal(learning.snapshot().plan.id, plan.id);
  assert.ok(connectedLearning(context(learning.snapshot())).includes('Practice safe isolation'));
  await learning.progress('activity', 'COMPLETED');
  assert.ok(connectedLearning(context(learning.snapshot())).includes('1 of 1 activities completed'));
  assert.equal(assessment.snapshot().bookingId, upcoming.bookingId);
  assert.equal(assessment.snapshot().report, null);
  assert.deepEqual(calls, [upcoming.bookingId]);
});

test('default plan uses the latest completion with a published plan rather than booking order', async () => {
  const records = {
    'first-created': { ...attempt, id: 'first-created', completedAt: '2026-11-12T12:00:00Z', learningPlan: { ...plan, id: 'latest-plan' } },
    'later-created': { ...attempt, id: 'later-created', completedAt: '2026-11-02T12:00:00Z' },
    unpublished: { ...attempt, id: 'unpublished', completedAt: '2026-11-15T12:00:00Z', learningPlan: null },
  };
  const reads = [];
  const store = createLearningStore({ client: client({
    bookings: async () => ({ data: [upcoming, ...['unpublished', 'later-created', 'first-created', 'first-created'].map((id, i) => ({ bookingId: `booking-${i}`, attemptId: id, status: 'COMPLETED' }))] }),
    assessmentAttempt: async id => { reads.push(id); return records[id]; },
  }) });
  await store.load('owner');
  assert.equal(store.snapshot().status, 'ready');
  assert.equal(store.snapshot().plan.id, 'latest-plan');
  assert.equal(reads.length, 3);
});

test('specific booking links show that plan and never fall back to an unrelated completed assessment', async () => {
  const other = { ...completed, bookingId: 'other-booking', attemptId: 'other-attempt' };
  const store = createLearningStore({ client: client({
    bookings: async () => ({ data: [upcoming, completed, other] }),
    assessmentAttempt: async id => id === upcoming.attemptId ? { id, completedAt: null, learningPlan: null } : { ...attempt, id, learningPlan: { ...plan, id: `${id}-plan` } },
  }) });
  await store.load('owner', completed.bookingId);
  assert.equal(store.snapshot().plan.id, 'old-attempt-plan');
  await store.load('owner', other.bookingId);
  assert.equal(store.snapshot().plan.id, 'other-attempt-plan');
  await store.load('owner', upcoming.bookingId);
  assert.equal(store.snapshot().plan, null);
  assert.equal(store.snapshot().bookingId, upcoming.bookingId);
  await store.load('owner', 'unknown-booking');
  assert.equal(store.snapshot().status, 'error');
  assert.equal(store.snapshot().plan, null);
});

test('result links preserve their booking when opening a specific learning plan', () => {
  const html = connectedResults({ ...context(null), assessmentState: {
    status: 'ready', bookingId: 'booking/older', report: { provisional: false, attempt: { results: [], overallScore: 80 } },
  }, badge: text => text, button: (text, href) => `<a href="/${href}">${text}</a>` });
  assert.ok(html.includes('/learning?booking=booking%2Folder'));
});

test('completed assessments beyond the first bookings page still supply their learning plan', async () => {
  const pages = [];
  const store = createLearningStore({ client: client({ bookings: async page => {
    pages.push(page);
    return { data: page === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...upcoming, bookingId: `booking-${i}` })) : [completed] };
  } }) });
  await store.load('owner');
  assert.deepEqual(pages, [1, 2]);
  assert.equal(store.snapshot().plan.id, plan.id);
});

test('empty and unpublished plans show the learning empty state without requiring a session', async () => {
  const store = createLearningStore({ client: client({ bookings: async () => ({ data: [upcoming] }) }) });
  await store.load('owner');
  assert.equal(store.snapshot().status, 'ready');
  assert.equal(store.snapshot().plan, null);
  assert.ok(connectedLearning(context(store.snapshot())).includes('when an assessor publishes'));
  const published = createLearningStore({ client: client({ assessmentAttempt: async () => ({ ...attempt, learningPlan: { ...plan, items: [] } }) }) });
  await published.load('owner');
  assert.ok(connectedLearning(context(published.snapshot())).includes('No competency gaps'));
});

test('failed history reads offer retry and cannot be mistaken for an absent learning plan', async () => {
  let offline = true;
  const store = createLearningStore({ client: client({ assessmentAttempt: async () => {
    if (offline) throw new Error('Connection lost');
    return attempt;
  } }) });
  await store.load('owner');
  assert.equal(store.snapshot().status, 'error');
  const html = connectedLearning(context(store.snapshot()));
  assert.ok(html.includes('Connection lost')); assert.ok(html.includes('data-learning-action="reload"'));
  assert.ok(!html.includes('when an assessor publishes'));
  offline = false; await store.load('owner', '', true);
  assert.equal(store.snapshot().plan.id, plan.id);
});

test('late plan reads are discarded after logout, account changes or choosing another booking', async () => {
  const waiting = deferred();
  const store = createLearningStore({ client: client({ assessmentAttempt: () => waiting.promise }) });
  const load = store.load('owner'); await Promise.resolve();
  store.reset(); waiting.resolve(attempt); await load;
  assert.equal(store.snapshot().owner, ''); assert.equal(store.snapshot().plan, null);

  const oldRead = deferred();
  const api = client({ assessmentAttempt: () => oldRead.promise });
  const switching = createLearningStore({ client: api });
  const oldLoad = switching.load('owner-a'); await Promise.resolve();
  api.bookings = async () => ({ data: [] });
  await switching.load('owner-b'); oldRead.resolve(attempt); await oldLoad;
  assert.equal(switching.snapshot().owner, 'owner-b'); assert.equal(switching.snapshot().plan, null);

  api.bookings = async () => ({ data: [completed, upcoming] });
  const older = deferred(); api.assessmentAttempt = id => id === completed.attemptId ? older.promise : Promise.resolve({ completedAt: null });
  const olderLoad = switching.load('owner-b', completed.bookingId); await Promise.resolve();
  await switching.load('owner-b', upcoming.bookingId); older.resolve(attempt); await olderLoad;
  assert.equal(switching.snapshot().bookingId, upcoming.bookingId); assert.equal(switching.snapshot().plan, null);
});

test('late progress saves cannot replace another account or booking plan', async () => {
  const pending = deferred();
  const api = client({ learningProgress: () => pending.promise });
  const store = createLearningStore({ client: api });
  await store.load('owner-a');
  const save = store.progress('activity', 'COMPLETED');
  api.bookings = async () => ({ data: [] }); await store.load('owner-b');
  pending.resolve({ ...plan, items: [] }); await save;
  assert.equal(store.snapshot().owner, 'owner-b'); assert.equal(store.snapshot().plan, null); assert.equal(store.snapshot().busy, false);
});

test('progress errors preserve the selected plan and unauthorized reads invoke the auth handler', async () => {
  let unauthorized = 0;
  const api = client({ learningProgress: async () => { throw new Error('Progress was not saved'); } });
  const store = createLearningStore({ client: api, onUnauthorized: () => unauthorized++ });
  await store.load('owner'); await store.progress('activity', 'COMPLETED');
  assert.equal(store.snapshot().plan.items[0].status, 'PENDING');
  assert.equal(store.snapshot().busy, false); assert.match(store.snapshot().error, /not saved/);
  api.assessmentAttempt = async () => { throw Object.assign(new Error('Sign in again'), { status: 401 }); };
  await store.load('owner', '', true);
  assert.equal(unauthorized, 1); assert.equal(store.snapshot().plan, null);
});

test('learning UI uses its own plan, retains progress controls and safely renders resources', async () => {
  const store = createLearningStore({ client: client({ assessmentAttempt: async () => ({ ...attempt, learningPlan: {
    ...plan, items: [{ ...plan.items[0], objective: '<script>unsafe</script>', resources: ['javascript:alert(1)', 'https://example.com/learn'] }],
  } }) }) });
  await store.load('owner');
  const html = connectedLearning({ ...context(store.snapshot()), assessmentState: { report: null } });
  assert.ok(html.includes('data-learning-item="activity"')); assert.ok(html.includes('0 of 1 activities completed'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('https://example.com/learn'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('javascript:'));
});

test('attempt reads and plan progress use the existing owned backend endpoints with cookies and CSRF', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'csrf' } : url.includes('/items/') ? plan : attempt }));
  } });
  await api.assessmentAttempt('attempt/older'); await api.learningProgress(plan.id, 'activity', 'COMPLETED');
  assert.equal(calls[0].url, '/api/v1/assessments/attempts/attempt%2Folder');
  const save = calls.find(call => call.method === 'PATCH');
  assert.equal(save.url, '/api/v1/assessments/learning-plans/old-plan/items/activity');
  assert.equal(save.headers['X-CSRF-Token'], 'csrf'); assert.equal(save.credentials, 'include');
  assert.deepEqual(JSON.parse(save.body), { status: 'COMPLETED' });
});
