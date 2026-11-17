import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createCareerStore, eligibleQualifications } from '../../context/careers.js';
import { createApi, ApiError } from '../../lib/api.js';
import { escapeHtml } from '../../components/html.js';

const industry = { id: 'industry-1', name: 'Manufacturing', active: true };
const energy = { id: 'industry-2', name: 'Energy', active: true };
const role = { id: 'career-1', title: 'PLC Programmer', description: 'Build and troubleshoot control systems.', industries: [industry, energy].map(industry => ({ industryId: industry.id, industry })), blueprints: [{ id: 'blueprint-1', frameworkId: 'core-1', title: 'PLC practical assessment', active: true, durationMinutes: 45 }] };
const frameworks = [{ id: 'core-1', scope: 'CORE', competencies: [{ competency: { id: 'skill-1', name: 'Safety', description: 'Work safely.' } }] }];
const company = { id: 'company-1', name: 'Example Manufacturing', industries: [{ industryId: industry.id }] };
const degree = { id: 'qualification-1', category: 'BACHELOR', title: 'Engineering degree', courseName: 'Engineering', scanStatus: 'CLEAN', status: 'UPLOADED', transcripts: [] };
const target = { id: 'target-1', jobRoleId: role.id, jobRole: role, status: 'DRAFT', industries: role.industries.slice(0, 1), companies: [], qualifications: [], attempt: null };
const page = data => ({ data, meta: { total: data.length } });
const client = overrides => ({ careers: async () => page([role]), industries: async () => page([industry, energy]), companies: async () => page([company]), career: async () => structuredClone(role), careerCompetencies: async () => structuredClone(frameworks), assessmentTargets: async () => page([]), eligibleQualifications: async () => [degree], createAssessmentTarget: async () => structuredClone(target), updateAssessmentTarget: async () => structuredClone(target), prepareAssessmentTarget: async () => ({ id: 'attempt-1', blueprintId: 'blueprint-1' }), ...overrides });
const readyStore = async overrides => { const store = createCareerStore({ client: client(overrides) }); await store.load('applicant-a'); await store.select(role.id); return store; };
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('career API uses backend routes, pagination, cookies, exact UUID payloads and CSRF', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'career-csrf' } : [], meta: { total: 2 } })); } });
  assert.equal((await api.careers(2)).meta.total, 2);
  await api.industries(); await api.companies(); await api.career('career/id'); await api.careerCompetencies('career/id'); await api.assessmentTargets();
  const body = { jobRoleId: role.id, industryIds: [industry.id], companyIds: [company.id], qualificationIds: [degree.id] };
  await api.createAssessmentTarget(body); await api.updateAssessmentTarget('target/id', body); await api.prepareAssessmentTarget('target/id', 'blueprint-1');
  assert.deepEqual(calls.map(call => call.url), ['/api/v1/careers?page=2&limit=100', '/api/v1/industries?page=1&limit=100', '/api/v1/companies?page=1&limit=100', '/api/v1/careers/career%2Fid', '/api/v1/careers/career%2Fid/competencies', '/api/v1/assessments/targets?page=1&limit=100', '/api/v1/auth/csrf', '/api/v1/assessments/targets', '/api/v1/assessments/targets/target%2Fid', '/api/v1/assessments/targets/target%2Fid/prepare']);
  assert.ok(calls.every(call => call.credentials === 'include'));
  assert.deepEqual(calls.slice(-3).map(call => call.method), ['POST', 'PUT', 'POST']);
  assert.ok(calls.slice(-3).every(call => call.headers['X-CSRF-Token'] === 'career-csrf'));
  assert.deepEqual(JSON.parse(calls.at(-3).body), body); assert.deepEqual(JSON.parse(calls.at(-1).body), { blueprintId: 'blueprint-1' });
});

test('loads every catalogue page and uses current clean qualifications and active targets', async () => {
  const pages = [];
  const store = await readyStore({ careers: async number => { pages.push(number); return { data: [{ ...role, id: `career-${number}` }], meta: { total: 2 } }; }, assessmentTargets: async () => page([{ ...target, status: 'COMPLETED' }, { ...target, id: 'active-target' }]) });
  assert.deepEqual(pages, [1, 2]); assert.equal(store.snapshot().items.length, 2); assert.equal(store.snapshot().activeTarget.id, 'active-target');
  await store.load('applicant-a'); assert.equal(pages.length, 2);
  const docs = [degree, { ...degree, id: 'new-degree', replacesId: degree.id }, { ...degree, id: 'bad', scanStatus: 'INFECTED' }, { ...degree, id: 'pending', scanStatus: 'QUARANTINED' }, { ...degree, id: 'rejected', status: 'REJECTED' }, { ...degree, id: 'identity', category: 'PASSPORT' }, { ...degree, id: 'transcript', category: 'TRANSCRIPT' }];
  assert.deepEqual(eligibleQualifications(docs).map(doc => doc.id), ['new-degree']);
});

test('saves actual selections, waits for preparation and restores the locked target after refresh', async () => {
  const pending = defer(); let saved, created = 0, prepared = 0;
  const api = client({ assessmentTargets: async () => page(saved ? [saved] : []), createAssessmentTarget: async body => {
    created++; assert.deepEqual(body, { jobRoleId: role.id, industryIds: [industry.id, energy.id], companyIds: [company.id], qualificationIds: [degree.id] });
    saved = { ...structuredClone(target), industries: role.industries, companies: [{ companyId: company.id, company }], qualifications: [{ documentId: degree.id, document: degree }] }; return saved;
  }, prepareAssessmentTarget: async (id, blueprintId) => { prepared++; assert.equal(id, target.id); assert.equal(blueprintId, 'blueprint-1'); await pending.promise; saved = { ...saved, status: 'PREPARED', attempt: { id: 'attempt-1', blueprintId } }; return saved.attempt; } });
  const store = createCareerStore({ client: api }); await store.load('applicant-a'); await store.select(role.id);
  store.edit('industryIds', [industry.id, energy.id]); store.edit('companyIds', [company.id]); store.edit('qualificationIds', [degree.id]);
  const preparing = store.prepare(); assert.equal(store.snapshot().busy, true); assert.equal(await store.prepare(), false); assert.notEqual(store.snapshot().activeTarget?.status, 'PREPARED');
  pending.resolve(); assert.equal(await preparing, true); assert.equal(created, 1); assert.equal(prepared, 1);
  const refreshed = createCareerStore({ client: api }); await refreshed.load('applicant-a'); await refreshed.select(role.id);
  assert.deepEqual(refreshed.snapshot().draft.industryIds, [industry.id, energy.id]); assert.deepEqual(refreshed.snapshot().draft.companyIds, [company.id]); assert.deepEqual(refreshed.snapshot().draft.qualificationIds, [degree.id]);
  refreshed.edit('industryIds', []); assert.equal(await refreshed.prepare(), false); assert.equal(prepared, 1);
});

test('prunes mismatched companies and blocks missing or excessive choices before saving', async () => {
  let mutations = 0; const store = await readyStore({ createAssessmentTarget: async () => { mutations++; } });
  store.edit('companyIds', [company.id]); store.edit('industryIds', [energy.id]); assert.deepEqual(store.snapshot().draft.companyIds, []);
  store.edit('industryIds', []); assert.equal(await store.prepare(), false);
  store.edit('industryIds', ['1', '2', '3', '4']); assert.equal(await store.prepare(), false); assert.equal(mutations, 0);
});

test('validation errors keep edits and preparation retries update the saved draft instead of duplicating it', async () => {
  let created = 0, preparations = 0, saved;
  const store = await readyStore({ assessmentTargets: async () => page(saved ? [saved] : []), createAssessmentTarget: async () => { created++; saved = structuredClone(target); return saved; }, prepareAssessmentTarget: async () => { if (++preparations === 1) throw new ApiError('Qualification scan is no longer clean', 422, 'QUALIFICATION_INVALID'); return { id: 'attempt-1', blueprintId: 'blueprint-1' }; } });
  store.edit('qualificationIds', [degree.id]); assert.equal(await store.prepare(), false); assert.equal(store.snapshot().activeTarget.status, 'DRAFT'); assert.deepEqual(store.snapshot().draft.qualificationIds, [degree.id]); assert.match(store.snapshot().error, /no longer clean/);
  assert.equal(await store.prepare(), true); assert.equal(created, 1); assert.equal(preparations, 2);
});

test('a timed-out creation reconciles with the saved target before retry', async () => {
  let created = 0, saved;
  const store = await readyStore({ assessmentTargets: async () => page(saved ? [saved] : []), createAssessmentTarget: async () => { created++; saved = structuredClone(target); throw new ApiError('Unable to reach the server', 0, 'NETWORK_ERROR'); } });
  assert.equal(await store.prepare(), false); assert.equal(store.snapshot().uncertain, true);
  assert.equal(await store.prepare(), false); assert.equal(created, 1);
  await store.load('applicant-a', true); await store.select(role.id); assert.equal(store.snapshot().activeTarget.id, target.id);
  assert.equal(await store.prepare(), true); assert.equal(created, 1);
});

test('a target prepared in another tab is never overwritten or prepared again', async () => {
  let reads = 0, mutations = 0;
  const store = await readyStore({ assessmentTargets: async () => page(++reads === 1 ? [] : [{ ...target, status: 'PREPARED', attempt: { id: 'other-attempt', blueprintId: 'blueprint-1' } }]), createAssessmentTarget: async () => { mutations++; }, prepareAssessmentTarget: async () => { mutations++; } });
  assert.equal(await store.prepare(), false); assert.equal(mutations, 0); assert.equal(store.snapshot().activeTarget.status, 'PREPARED');
});

test('late catalogue, detail and save responses cannot leak data across accounts', async () => {
  const pending = defer(); const store = createCareerStore({ client: client({ careers: () => pending.promise }) });
  const oldLoad = store.load('applicant-a'); store.reset(); pending.resolve(page([role])); await oldLoad;
  assert.equal(store.snapshot().status, 'idle'); assert.equal(store.snapshot().items.length, 0);
  const detail = defer(); const detailStore = createCareerStore({ client: client({ career: () => detail.promise }) });
  await detailStore.load('applicant-a'); const oldDetail = detailStore.select(role.id); detailStore.reset(); detail.resolve(role); await oldDetail;
  assert.equal(detailStore.snapshot().detail, null);
  const reconciliation = defer(); let reads = 0, mutations = 0;
  const saving = await readyStore({ assessmentTargets: () => ++reads === 1 ? page([]) : reconciliation.promise, createAssessmentTarget: async () => { mutations++; } });
  const oldSave = saving.prepare(); saving.reset(); reconciliation.resolve(page([target])); await oldSave;
  assert.equal(saving.snapshot().activeTarget, null); assert.equal(mutations, 0); assert.equal(saving.snapshot().busy, false);
});

test('failed loading allows retry, expires sessions and rejects late detail responses', async () => {
  let unauthorized = 0;
  const api = client({ careers: async () => { throw new ApiError('Please sign in again', 401); } });
  const store = createCareerStore({ client: api, onUnauthorized: () => { unauthorized++; } });
  await store.load('applicant-a'); assert.equal(store.snapshot().status, 'error'); assert.equal(unauthorized, 1);
  api.careers = async () => page([role]); await store.load('applicant-a', true); assert.equal(store.snapshot().status, 'ready');
  const first = defer(); api.career = id => id === 'first' ? first.promise : Promise.resolve({ ...role, id });
  const old = store.select('first'); await store.select('second'); first.resolve({ ...role, id: 'first' }); await old;
  assert.equal(store.snapshot().detail.id, 'second');
});

test('a target creation finishing after logout cannot prepare it or restore private state', async () => {
  const pending = defer(); let preparationCalls = 0;
  const store = await readyStore({ createAssessmentTarget: () => pending.promise, prepareAssessmentTarget: async () => { preparationCalls++; } });
  const saving = store.prepare();
  // Let the reconciliation read finish and the create request start.
  await new Promise(resolve => setImmediate(resolve));
  store.reset(); pending.resolve(target); await saving;
  assert.equal(preparationCalls, 0); assert.equal(store.snapshot().activeTarget, null);
  assert.equal(store.snapshot().notice, '');
});

const compiled = await build({ entryPoints: [new URL('./careers/careers.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', outfile: '/tmp/nexus-careers-test.js' });
const screens = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const render = (screen, careerState) => screens[screen]({ careerState, escape: escapeHtml, heading: (title, sub, action = '') => `<h1>${title}</h1><p>${sub}</p>${action}`, card: (title, body) => `<section class="card"><h2>${title}</h2>${body}</section>`, badge: text => `<span class="badge">${text}</span>`, button: (text, href, cls = 'primary') => `<a class="btn ${cls}" href="/${href}">${text}</a>`, icon: () => '<svg></svg>' });

test('screens retain cards, grid and controls, display live fields and escape backend text', async () => {
  const store = await readyStore(); const data = structuredClone(store.snapshot()); data.items[0].title = '<img src=x onerror=alert(1)>';
  const browse = render('explore', data); assert.match(browse, /class="tiles"/); assert.match(browse, /class="card tile"/); assert.match(browse, /id="career-search"/); assert.match(browse, /career\?id=career-1/); assert.ok(!browse.includes('<img')); assert.match(browse, /&lt;img/);
  const detail = render('career', store.snapshot()); assert.match(detail, /Build and troubleshoot control systems/); assert.match(detail, /Work safely/); assert.match(detail, /class="grid"/); assert.ok(!detail.includes('System integration')); assert.match(detail, /target\?career=career-1/);
  const form = render('target', store.snapshot()); assert.match(form, /id="target-form"/); assert.match(form, /class="form-grid mt"/); assert.match(form, /value="industry-1"/); assert.match(form, /Example Manufacturing/); assert.match(form, /PLC practical assessment/); assert.ok(!form.includes('Kiira Motors')); assert.ok(!form.includes('Demo target'));
});

test('screens show empty, loading, failed and locked states accurately', async () => {
  const store = await readyStore(); const data = store.snapshot();
  assert.match(render('explore', { ...data, status: 'loading' }), /Loading career information/); assert.match(render('explore', { ...data, status: 'error', error: '<offline>' }), /&lt;offline&gt;/); assert.match(render('explore', { ...data, items: [] }), /No active careers/); assert.match(render('target', { ...data, selectedId: '' }), /Explore careers/); assert.match(render('career', { ...data, detailStatus: 'error', detailError: 'Not found' }), /retry-detail/);
  const locked = render('target', { ...data, activeTarget: { ...target, status: 'PREPARED' } }); assert.match(locked, /fieldset[^>]+disabled/); assert.match(locked, /Continue to booking/); assert.ok(!locked.includes('Prepare my target'));
  assert.match(render('target', { ...data, frameworks: [] }), /No approved assessment/);
});

test('career options use the eligible collection and respect backend version flags', async () => {
  let calls = 0;
  const store = await readyStore({ documents: async () => { throw new Error('Unfiltered history should not be loaded'); }, eligibleQualifications: async () => { calls++; return [{ ...degree, id: 'old-but-current', isCurrent: true }, { ...degree, id: 'superseded', isCurrent: false }]; } });
  assert.equal(calls, 1); assert.deepEqual(store.snapshot().qualifications.map(doc => doc.id), ['old-but-current']);
});

const prepared = { ...target, status: 'PREPARED', attempt: { id: 'attempt-1', blueprintId: 'blueprint-1' } };
const recoveryStore = async (overrides = {}, options = {}) => {
  const store = createCareerStore({ client: client({ assessmentTargets: async () => page([prepared]), ...overrides }), ...options });
  await store.load('applicant-a'); await store.select(role.id);
  return store;
};

test('abandonment API posts only the reason to the owned target route with cookies and CSRF', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return new Response(JSON.stringify({ data: url.endsWith('/csrf') ? { csrfToken: 'recovery-csrf' } : { id: 'target/id', status: 'ABANDONED' } }));
  } });
  await api.abandonAssessmentTarget('target/id', 'Choose a different career');
  const request = calls.at(-1);
  assert.equal(request.url, '/api/v1/assessments/targets/target%2Fid/abandon');
  assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'include');
  assert.equal(request.headers['X-CSRF-Token'], 'recovery-csrf');
  assert.deepEqual(JSON.parse(request.body), { reason: 'Choose a different career' });
});

test('recovery requires a reason, explicit acknowledgement and a prepared target; cancelling never mutates', async () => {
  let mutations = 0;
  const store = await recoveryStore({ abandonAssessmentTarget: async () => { mutations++; return { id: target.id, status: 'ABANDONED' }; } });
  assert.equal(await store.abandon(true), false);
  store.recovery(true); store.recoveryReason('    '); assert.equal(await store.abandon(true), false);
  store.recoveryReason('Change my career'); assert.equal(await store.abandon(false), false);
  store.recoveryReason('x'.repeat(1001)); assert.equal(await store.abandon(true), false);
  store.recovery(false); assert.equal(store.snapshot().recoveryTargetId, ''); assert.equal(mutations, 0);
  const started = await recoveryStore({ assessmentTargets: async () => page([{ ...prepared, status: 'IN_PROGRESS' }]) });
  started.recovery(true); assert.equal(started.snapshot().recoveryTargetId, ''); assert.equal(await started.abandon(true), false);
});

test('successful recovery waits for confirmation, clears the locked target and permits a fresh target', async () => {
  const pending = defer(); let saved = structuredClone(prepared), calls = 0, invalidated = 0;
  const store = await recoveryStore({
    assessmentTargets: async () => page([saved]),
    abandonAssessmentTarget: async (id, reason) => { calls++; assert.equal(id, target.id); assert.equal(reason, 'Choose another career'); await pending.promise; saved = { ...saved, status: 'ABANDONED' }; return { id, status: 'ABANDONED' }; },
    createAssessmentTarget: async () => { saved = { ...target, id: 'replacement-target' }; return saved; },
  }, { onAbandoned: () => invalidated++ });
  store.recovery(true); store.recoveryReason('  Choose another career  ');
  const recovering = store.abandon(true);
  assert.equal(store.snapshot().busy, true); assert.equal(store.snapshot().activeTarget.status, 'PREPARED');
  assert.equal(await store.abandon(true), false); assert.equal(await store.prepare(), false);
  pending.resolve(); assert.equal(await recovering, true);
  assert.equal(calls, 1); assert.equal(invalidated, 1); assert.equal(store.snapshot().activeTarget, null);
  assert.match(store.snapshot().notice, /scheduled bookings.*cancelled/); assert.equal(store.snapshot().draft, null);
  await store.select(role.id); assert.equal(await store.prepare(), true);
  assert.equal(store.snapshot().activeTarget.id, 'replacement-target');
});

test('backend recovery restrictions retain the target and require fresh server state', async () => {
  for (const [code, message] of [['ADMIN_RECOVERY_REQUIRED', 'Ask an administrator to recover a started assessment'], ['CANCELLATION_WINDOW_CLOSED', 'The cancellation deadline has passed'], ['RESULTS_IMMUTABLE', 'Completed assessments cannot be abandoned']]) {
    let invalidated = 0;
    const store = await recoveryStore({ abandonAssessmentTarget: async () => { throw new ApiError(message, 409, code); } }, { onAbandoned: () => invalidated++ });
    store.recovery(true); store.recoveryReason('Change career target');
    assert.equal(await store.abandon(true), false);
    assert.equal(store.snapshot().activeTarget.id, target.id); assert.equal(store.snapshot().uncertain, true);
    assert.ok(store.snapshot().error.includes(message)); assert.equal(invalidated, 0);
  }
});

test('an unknown abandonment outcome is never replayed and refresh reconciles cancellation', async () => {
  let saved = structuredClone(prepared), calls = 0, invalidated = 0;
  const store = await recoveryStore({
    assessmentTargets: async () => page([saved]),
    abandonAssessmentTarget: async () => { calls++; saved = { ...saved, status: 'ABANDONED' }; throw new ApiError('Connection lost', 0, 'NETWORK_ERROR'); },
  }, { onAbandoned: () => invalidated++ });
  store.recovery(true); store.recoveryReason('Different career selected');
  assert.equal(await store.abandon(true), false); assert.equal(store.snapshot().activeTarget.status, 'PREPARED');
  assert.equal(await store.abandon(true), false); assert.equal(calls, 1); assert.equal(invalidated, 0);
  await store.load('applicant-a', true);
  assert.equal(store.snapshot().activeTarget, null); assert.equal(store.snapshot().uncertain, false);
  assert.equal(invalidated, 1); assert.equal(store.snapshot().recoveryTargetId, '');
});

test('server validation and expired authentication retain recovery input and cannot claim success', async () => {
  let invalidated = 0, unauthorized = 0;
  const api = client({ assessmentTargets: async () => page([prepared]), abandonAssessmentTarget: async () => { throw new ApiError('Use a more descriptive reason', 422, 'VALIDATION_ERROR'); } });
  const store = createCareerStore({ client: api, onAbandoned: () => invalidated++, onUnauthorized: () => unauthorized++ });
  await store.load('applicant-a'); store.recovery(true); store.recoveryReason('Change career target');
  assert.equal(await store.abandon(true), false); assert.equal(store.snapshot().recoveryReason, 'Change career target');
  assert.equal(store.snapshot().uncertain, false); assert.match(store.snapshot().error, /descriptive/);
  api.abandonAssessmentTarget = async () => { throw new ApiError('Please sign in again', 401); };
  assert.equal(await store.abandon(true), false); assert.equal(unauthorized, 1); assert.equal(invalidated, 0);
});

test('abandonment finishing after logout or switching accounts cannot clear the new account target', async () => {
  for (const switchAccount of [false, true]) {
    const pending = defer(); let invalidated = 0;
    const store = await recoveryStore({ abandonAssessmentTarget: () => pending.promise }, { onAbandoned: () => invalidated++ });
    store.recovery(true); store.recoveryReason('Change career target'); const recovering = store.abandon(true);
    if (switchAccount) await store.load('applicant-b'); else store.reset();
    pending.resolve({ id: target.id, status: 'ABANDONED' }); assert.equal(await recovering, false);
    assert.equal(invalidated, 0); assert.equal(store.snapshot().notice, '');
    assert.equal(store.snapshot().ownerId, switchAccount ? 'applicant-b' : null);
    assert.equal(store.snapshot().activeTarget?.status ?? null, switchAccount ? 'PREPARED' : null);
  }
});

test('post-abandon refresh restores a target created elsewhere and handles read failures truthfully', async () => {
  let reads = 0;
  const replacement = { ...prepared, id: 'created-elsewhere' };
  const store = await recoveryStore({ assessmentTargets: async () => page([++reads === 1 ? prepared : replacement]), abandonAssessmentTarget: async () => ({ id: target.id, status: 'ABANDONED' }) });
  store.recovery(true); store.recoveryReason('Change career target');
  assert.equal(await store.abandon(true), true); assert.equal(store.snapshot().activeTarget.id, replacement.id);
  let refreshReads = 0;
  const failed = await recoveryStore({ assessmentTargets: async () => { if (++refreshReads > 1) throw new ApiError('Server unavailable', 503); return page([prepared]); }, abandonAssessmentTarget: async () => ({ id: target.id, status: 'ABANDONED' }) });
  failed.recovery(true); failed.recoveryReason('Change career target'); assert.equal(await failed.abandon(true), true);
  assert.equal(failed.snapshot().activeTarget, null); assert.equal(failed.snapshot().uncertain, true);
  assert.match(failed.snapshot().error, /was abandoned.*could not be refreshed/); assert.equal(await failed.prepare(), false);
});

test('target recovery controls preserve the locked form and remain reachable when career details fail', async () => {
  const store = await recoveryStore();
  let html = render('target', store.snapshot());
  assert.match(html, /Change career target/); assert.match(html, /fieldset[^>]+disabled/);
  assert.ok(!html.includes('target-recovery-form'));
  store.recovery(true); store.recoveryReason('</textarea><script>unsafe</script>');
  html = render('target', store.snapshot());
  assert.match(html, /id="target-recovery-form"/); assert.match(html, /minlength="5" maxlength="1000"/);
  assert.match(html, /cancels its scheduled bookings/); assert.match(html, /Keep current target/);
  assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<script>'));
  const unavailable = render('target', { ...store.snapshot(), detailStatus: 'error', detail: null, detailError: 'Career no longer available', uncertain: true });
  assert.match(unavailable, /target-recovery-form/); assert.match(unavailable, /Refresh career information/);
  const inProgress = render('target', { ...store.snapshot(), activeTarget: { ...prepared, status: 'IN_PROGRESS' } });
  assert.match(inProgress, /Contact your assessment provider or an administrator/);
  assert.ok(!inProgress.includes('target-recovery-form')); assert.ok(!inProgress.includes('data-career-action="begin-recovery"'));
  assert.ok(!render('target', { ...store.snapshot(), activeTarget: target }).includes('Change career target'));
});
