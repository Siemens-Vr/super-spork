import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createProfileStore } from '../../context/profile.js';
import { createApi, ApiError } from '../../lib/api.js';
import { escapeHtml } from '../../components/html.js';

const identity = { id: 'applicant-a', legalName: 'Real Applicant', email: 'real@example.test', phone: '+254712345678', emailVerifiedAt: '2026-11-13', profile: { country: 'KE', discipline: null } };
const checklist = { emailVerified: true, profileComplete: false, identitySubmitted: false, documents: [] };
const client = overrides => ({ applicantProfile: async () => identity, applicantOnboarding: async () => checklist, updateApplicantProfile: async body => ({ ...identity, legalName: body.legalName, phone: body.phone, profile: { country: body.country, discipline: body.discipline } }), ...overrides });
const reply = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });

test('profile GETs and PATCH use exact backend endpoints, cookie session and CSRF', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return reply(url.endsWith('/csrf') ? { csrfToken: 'secure-session' } : url.endsWith('/onboarding') ? checklist : identity);
  } });
  await api.applicantProfile();
  await api.applicantOnboarding();
  const body = { legalName: 'Saved Applicant', phone: '0712345678', country: 'UG', discipline: 'Automation Engineering' };
  await api.updateApplicantProfile(body);
  assert.deepEqual(calls.map(call => call.url), ['/api/v1/applicants/me', '/api/v1/applicants/me/onboarding', '/api/v1/auth/csrf', '/api/v1/applicants/me']);
  assert.equal(calls[3].method, 'PATCH');
  assert.equal(calls[3].headers['X-CSRF-Token'], 'secure-session');
  assert.deepEqual(JSON.parse(calls[3].body), body);
  assert.ok(calls.every(call => call.credentials === 'include'));
});

test('loads actual profile/checklist once and saves only editable fields using server-normalized values', async () => {
  let loaded = 0, sent, notified;
  const api = client({
    applicantProfile: async () => { loaded++; return structuredClone(identity); },
    updateApplicantProfile: async body => { sent = body; return { ...identity, legalName: body.legalName, phone: '+254799123456', profile: { country: body.country, discipline: body.discipline } }; },
    applicantOnboarding: async () => ({ ...checklist, profileComplete: !!sent }),
  });
  const store = createProfileStore({ client: api, onSaved: profile => { notified = profile; } });
  const loading = store.load(identity.id);
  assert.equal(store.snapshot().status, 'loading');
  await loading;
  await store.load(identity.id);
  assert.equal(loaded, 1);
  assert.equal(store.snapshot().data.email, identity.email);
  assert.equal(store.snapshot().onboarding.profileComplete, false);
  const saving = store.save({ legalName: ' New Name ', phone: ' 0799123456 ', country: 'UG', discipline: ' Automation ', email: 'attacker@example.test', id: 'other-person', emailVerifiedAt: true, roles: ['ADMIN'] });
  assert.equal(store.snapshot().saving, true);
  assert.equal(await saving, true);
  assert.deepEqual(sent, { legalName: 'New Name', phone: '0799123456', country: 'UG', discipline: 'Automation' });
  assert.equal(store.snapshot().data.phone, '+254799123456');
  assert.equal(notified.legalName, 'New Name');
  assert.equal(store.snapshot().onboarding.profileComplete, true);
  assert.equal(store.snapshot().draft, null);
  assert.ok(store.snapshot().notice.includes('saved'));
  assert.equal(store.snapshot().saving, false);
  // A fresh store (a full browser refresh) fetches persisted backend values.
  api.applicantProfile = async () => notified;
  const refreshed = createProfileStore({ client: api });
  await refreshed.load(identity.id);
  assert.equal(refreshed.snapshot().data.legalName, 'New Name');
});

test('validation failure preserves edits, shows field errors and never claims success', async () => {
  const store = createProfileStore({ client: client({ updateApplicantProfile: async () => { throw new ApiError('Check the submitted fields', 422, 'VALIDATION_ERROR', [{ path: 'phone', message: 'Enter a valid phone number' }]); } }) });
  await store.load(identity.id);
  const values = { legalName: 'Edited Applicant', phone: 'bad', country: 'KE', discipline: 'Robotics' };
  assert.equal(await store.save(values), false);
  assert.deepEqual(store.snapshot().draft, values);
  assert.equal(store.snapshot().fieldErrors.phone, 'Enter a valid phone number');
  assert.equal(store.snapshot().notice, '');
  assert.equal(store.snapshot().data.legalName, 'Real Applicant');
  assert.equal(store.snapshot().saving, false);
});

test('failed loading can retry and an expired session requests a fresh auth check', async () => {
  let unauthorized = 0;
  const api = client({ applicantProfile: async () => { throw new ApiError('Please sign in', 401); } });
  const store = createProfileStore({ client: api, onUnauthorized: () => { unauthorized++; } });
  await store.load(identity.id);
  assert.equal(store.snapshot().status, 'error');
  assert.equal(store.snapshot().data, null);
  assert.equal(unauthorized, 1);
  api.applicantProfile = async () => identity;
  await store.load(identity.id, true);
  assert.equal(store.snapshot().status, 'ready');
});

test('late reads and saves are discarded after logout or switching users', async () => {
  let resolveRead, resolveSave, notified = 0;
  const api = client({ applicantProfile: () => new Promise(resolve => { resolveRead = resolve; }) });
  const store = createProfileStore({ client: api, onSaved: () => { notified++; } });
  const loading = store.load(identity.id);
  store.reset();
  resolveRead(identity);
  await loading;
  assert.equal(store.snapshot().data, null);
  api.applicantProfile = async () => identity;
  await store.load(identity.id);
  api.updateApplicantProfile = () => new Promise(resolve => { resolveSave = resolve; });
  const saving = store.save({ legalName: 'Old Account', phone: '0712345678', country: 'KE', discipline: 'Engineering' });
  api.applicantProfile = async () => ({ ...identity, id: 'applicant-b', legalName: 'Second Applicant' });
  await store.load('applicant-b');
  resolveSave({ ...identity, legalName: 'Old Account' });
  await saving;
  assert.equal(store.snapshot().data.id, 'applicant-b');
  assert.equal(store.snapshot().data.legalName, 'Second Applicant');
  assert.equal(notified, 0);
});

test('checklist failure after PATCH keeps the confirmed save and does not display stale completion', async () => {
  const api = client();
  const store = createProfileStore({ client: api });
  await store.load(identity.id);
  api.applicantOnboarding = async () => { throw new ApiError('Offline'); };
  assert.equal(await store.save({ legalName: 'Saved Applicant', phone: '0712345678', country: 'KE', discipline: 'Engineering' }), true);
  assert.equal(store.snapshot().data.legalName, 'Saved Applicant');
  assert.equal(store.snapshot().onboarding, null);
  assert.ok(store.snapshot().onboardingError.includes('profile was saved'));
});

const compiled = await build({ entryPoints: [new URL('./profile/profile.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', outfile: '/tmp/nexus-profile-test.js' });
const { profile } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const render = snapshot => profile({ profileState: snapshot, escape: escapeHtml, heading: (title, sub) => `<h1>${title}</h1><p>${sub}</p>`, card: (title, body) => `<section><h2>${title}</h2>${body}</section>`, badge: text => `<span>${text}</span>`, button: (text, href) => `<a href="/${href}">${text}</a>` });

test('profile screen renders backend values, read-only email, ISO countries and truthful checklist states', () => {
  const html = render({ status: 'ready', data: { ...identity, legalName: '<img src=x onerror=alert(1)>', profile: { country: 'UG', discipline: null } }, onboarding: checklist, fieldErrors: {}, saving: false });
  assert.ok(html.includes('real@example.test'));
  assert.ok(html.includes('readonly'));
  assert.ok(html.includes('name="legalName"'));
  assert.ok(html.includes('name="country"'));
  assert.ok(html.includes('value="UG" selected'));
  assert.ok(html.includes('Incomplete'));
  assert.ok(html.includes('Not submitted'));
  assert.ok(!html.includes('alex@example.test'));
  assert.ok(!html.includes('Alex Morgan'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  const updated = render({ status: 'ready', data: identity, onboarding: { ...checklist, profileComplete: true, identitySubmitted: true, documents: [{ category: 'BACHELOR', status: 'AUTHENTICATED', scanStatus: 'CLEAN' }] }, fieldErrors: {}, saving: false });
  assert.ok(updated.includes('Complete'));
  assert.ok(updated.includes('Authenticated'));
});

test('profile screen has loading, retry, validation and saving states', () => {
  assert.ok(render({ status: 'loading' }).includes('Loading your profile'));
  assert.ok(!render({ status: 'loading' }).includes('profile-form'));
  const failed = render({ status: 'error', error: 'Network unavailable' });
  assert.ok(failed.includes('Network unavailable'));
  assert.ok(failed.includes('data-profile-action="retry"'));
  const validation = render({ status: 'ready', data: identity, draft: { legalName: 'Unsaved Applicant', phone: 'bad', country: 'KE', discipline: 'Robotics' }, error: 'Check fields', fieldErrors: { phone: 'Invalid phone' }, onboarding: checklist, saving: true });
  assert.ok(validation.includes('Unsaved Applicant'));
  assert.ok(validation.includes('aria-invalid="true"'));
  assert.ok(validation.includes('Invalid phone'));
  assert.ok(validation.includes('aria-busy="true"'));
  assert.ok(validation.includes('disabled'));
  assert.ok(validation.includes('Saving…'));
});
