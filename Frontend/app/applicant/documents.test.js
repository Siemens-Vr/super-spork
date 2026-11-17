import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createApi, ApiError } from '../../lib/api.js';
import { createDocumentStore, uploadBody, flattenDocuments, previousDocumentIds } from '../../context/documents.js';
import { createInstitutionLookup } from '../../context/institution-search.js';
import { createDocumentPreview } from '../../context/document-dialog.js';
import { escapeHtml } from '../../components/html.js';
const requirements = { maxFileBytes: 10485760, maxTotalBytes: 31457280, maxTranscripts: 5, categories: [
  { category: 'NATIONAL_ID', label: 'National ID', institutionRequired: false, requiredFields: [], transcriptsRequired: false },
  { category: 'PASSPORT', label: 'Passport', institutionRequired: false, requiredFields: [], transcriptsRequired: false },
  { category: 'BACHELOR', label: "Bachelor's degree", institutionRequired: true, requiredFields: ['courseName'], transcriptsRequired: true },
  { category: 'OTHER', label: 'Other document', institutionRequired: false, requiredFields: ['title'], transcriptsRequired: false },
] };
const pdf = name => new File(['%PDF-1.4\n%%EOF'], name, { type: 'application/pdf' });
const identity = { id: 'identity-1', category: 'NATIONAL_ID', title: 'identity.pdf', status: 'UPLOADED', scanStatus: 'QUARANTINED', size: 20, mimeType: 'application/pdf', createdAt: '2026-11-13T10:00:00Z', transcripts: [] };
const degree = { ...identity, id: 'degree-1', category: 'BACHELOR', title: 'degree.pdf', courseName: 'Mechatronics', institutionName: 'Engineering University', transcripts: [{ ...identity, id: 'transcript-1', category: 'TRANSCRIPT', qualificationId: 'degree-1', title: 'transcript.pdf' }] };
const history = { history: [{ toStatus: 'UPLOADED', fromStatus: null, reason: 'Document submitted', createdAt: identity.createdAt }], reviews: [], evidence: [] };
const client = overrides => {
  const api = { identityDocuments: async () => [identity], documents: async () => [degree, ...degree.transcripts], documentRequirements: async () => requirements, document: async () => degree, documentHistory: async () => history, uploadDocument: async () => degree, documentEvidence: async () => ({}), downloadDocument: async () => ({ blob: new Blob(['test'], { type: 'application/pdf' }) }), ...overrides };
  api.documentCollection = async () => {
    const items = flattenDocuments([...(await api.identityDocuments()), ...(await api.documents())]);
    const previous = previousDocumentIds(items), current = items.filter(item => !previous.has(item.id));
    return { items, summary: { current: current.length, authenticated: current.filter(item => item.status === 'AUTHENTICATED').length } };
  };
  return api;
};
const reply = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
const form = (category = 'BACHELOR') => {
  const body = new FormData();
  for (const [key, value] of Object.entries({ category, institutionName: 'Engineering University', courseName: 'Mechatronics', confirm: 'on' })) body.set(key, value);
  body.set('file', pdf('certificate.pdf'));
  if (category === 'BACHELOR') body.append('transcripts', pdf('transcript.pdf'));
  return body;
};

test('multipart uploads use the correct identity/academic/replacement routes without a JSON content type', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return reply(url.endsWith('/csrf') ? { csrfToken: 'csrf-token' } : degree);
  } });
  const body = form();
  await api.uploadDocument(body, false);
  await api.uploadDocument(form('NATIONAL_ID'), true);
  await api.uploadDocument(body, false, 'old-degree');
  await api.uploadDocument(form('PASSPORT'), true, 'old-identity');
  const posts = calls.filter(call => call.method === 'POST');
  assert.deepEqual(posts.map(call => call.url), ['/api/v1/documents', '/api/v1/identity/documents', '/api/v1/documents/old-degree/replace', '/api/v1/identity/documents/old-identity/replace']);
  assert.equal(posts[0].body, body);
  assert.ok(posts.every(call => call.credentials === 'include' && call.headers['X-CSRF-Token'] === 'csrf-token' && !call.headers['Content-Type']));
});

test('binary downloads preserve quarantine errors and never treat document bytes as JSON', async () => {
  const api = createApi({ fetcher: async (_url, options) => {
    assert.equal(options.credentials, 'include');
    return new Response('%PDF-test', { headers: { 'Content-Type': 'application/pdf' } });
  } });
  assert.equal((await api.downloadDocument('owned-document')).blob.type, 'application/pdf');
  const quarantine = createApi({ fetcher: async () => reply({ code: 'DOCUMENT_QUARANTINED', message: 'Wait for malware scanning' }, 409) });
  await assert.rejects(quarantine.downloadDocument('owned-document'), error => error.code === 'DOCUMENT_QUARANTINED');
  const unexpected = createApi({ fetcher: async () => new Response('<script>test</script>', { headers: { 'Content-Type': 'text/html' } }) });
  await assert.rejects(unexpected.downloadDocument('owned-document'), /unexpected file type/);
});

test('upload payload includes exact metadata and transcript parts, excluding confirmation and unrelated fields', () => {
  const input = form();
  input.set('roles', 'ADMIN'); input.set('applicantId', 'someone-else');
  const body = uploadBody(input, requirements);
  assert.equal(body.get('institutionName'), 'Engineering University');
  assert.equal(body.get('courseName'), 'Mechatronics');
  assert.equal(body.getAll('transcripts').length, 1);
  assert.equal(body.get('file').name, 'certificate.pdf');
  assert.equal(body.get('confirm'), null); assert.equal(body.get('applicantId'), null); assert.equal(body.get('roles'), null);
  const identityForm = form('NATIONAL_ID');
  identityForm.append('transcripts', pdf('old-selection.pdf'));
  assert.equal(uploadBody(identityForm, requirements).getAll('transcripts').length, 0);
  assert.equal(uploadBody(identityForm, requirements).get('institutionName'), null);
});

test('file/transcript validation uses backend-provided limits before sending', () => {
  const missing = form(); missing.delete('file');
  assert.throws(() => uploadBody(missing, requirements), /Choose the document/);
  const noTranscript = form(); noTranscript.delete('transcripts');
  assert.throws(() => uploadBody(noTranscript, requirements), /at least one transcript/);
  const tooMany = form(); for (let i = 0; i < 5; i++) tooMany.append('transcripts', pdf(`${i}.pdf`));
  assert.throws(() => uploadBody(tooMany, requirements), /at most 5/);
  assert.throws(() => uploadBody(form(), { ...requirements, maxFileBytes: 2 }), /no larger/);
  assert.throws(() => uploadBody(form(), { ...requirements, maxTotalBytes: 2 }), /combined files/);
  const invalid = form(); invalid.set('file', new File(['test'], 'bad.txt', { type: 'text/plain' }));
  assert.throws(() => uploadBody(invalid, requirements), /PDF, JPEG or PNG/);
});

test('listing combines identity/academic files, deduplicates transcripts and recognizes previous versions', async () => {
  const store = createDocumentStore({ client: client() });
  await store.load('applicant-a');
  assert.equal(store.snapshot().status, 'ready');
  assert.deepEqual(store.snapshot().items.map(doc => doc.id), ['identity-1', 'degree-1', 'transcript-1']);
  assert.equal(flattenDocuments([degree, ...degree.transcripts]).length, 2);
  const replacement = { ...degree, id: 'degree-2', replacesId: degree.id, transcripts: [] };
  const previous = previousDocumentIds([...store.snapshot().items, replacement]);
  assert.ok(previous.has('degree-1')); assert.ok(previous.has('transcript-1'));
  assert.ok(!previous.has('degree-2'));
});

test('successful uploads preserve prior versions, invalidate onboarding and do not replay failures', async () => {
  let uploads = 0, invalidated = 0;
  const api = client({ uploadDocument: async (_body, identityRoute, replacesId) => {
    uploads++; assert.equal(identityRoute, false); assert.equal(replacesId, 'degree-1');
    return { ...degree, id: 'degree-2', replacesId, transcripts: [] };
  } });
  const events = [];
  const store = createDocumentStore({ client: api, onMutation: () => { invalidated++; }, onChange: reason => events.push(reason) });
  await store.load('applicant-a');
  assert.equal(await store.upload(form(), 'degree-1'), true);
  assert.equal(uploads, 1); assert.equal(invalidated, 1);
  assert.ok(store.snapshot().items.some(doc => doc.id === 'degree-1'));
  assert.ok(store.snapshot().items.some(doc => doc.id === 'degree-2'));
  assert.ok(store.snapshot().notice.includes('Previous') || store.snapshot().notice.includes('previous'));
  api.uploadDocument = async () => { uploads++; throw new ApiError('Server unavailable', 0, 'NETWORK_ERROR'); };
  assert.equal(await store.upload(form()), false);
  assert.equal(uploads, 2);
  assert.equal(store.snapshot().busy, false);
  assert.ok(store.snapshot().error.includes('before retrying'));
  assert.equal(events.at(-1), 'upload-state');
});

test('late document reads, uploads and downloads cannot leak across logout or account changes', async () => {
  let resolveList;
  const api = client({ identityDocuments: () => new Promise(resolve => { resolveList = resolve; }) });
  const store = createDocumentStore({ client: api });
  const loading = store.load('old-account'); store.reset(); resolveList([identity]); await loading;
  assert.equal(store.snapshot().items.length, 0);
  api.identityDocuments = async () => [identity]; await store.load('old-account');
  let resolveUpload;
  api.uploadDocument = () => new Promise(resolve => { resolveUpload = resolve; });
  const uploading = store.upload(form());
  api.identityDocuments = async () => []; api.documents = async () => [];
  await store.load('new-account');
  resolveUpload(degree); assert.equal(await uploading, false);
  assert.equal(store.snapshot().ownerId, 'new-account'); assert.equal(store.snapshot().items.length, 0);
  let resolveDownload;
  api.downloadDocument = () => new Promise(resolve => { resolveDownload = resolve; });
  const downloading = store.download('old-id'); store.reset(); resolveDownload({ blob: pdf('private.pdf') });
  assert.equal(await downloading, null);
});

test('review history and additional evidence use the selected document and refresh the server outcome', async () => {
  let submitted;
  const api = client({ documentEvidence: async (id, body) => { submitted = { id, body }; } });
  const store = createDocumentStore({ client: api });
  await store.load('applicant-a'); await store.select(degree.id);
  assert.equal(store.snapshot().history.history[0].reason, 'Document submitted');
  assert.equal(await store.evidence(degree.id, { note: ' Additional information ', reference: ' ref-1 ' }), true);
  assert.deepEqual(submitted, { id: 'degree-1', body: { note: 'Additional information', reference: 'ref-1' } });
  assert.ok(store.snapshot().notice.includes('submitted'));
});

const compiled = await build({ entryPoints: [new URL('./documents/documents.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', outfile: '/tmp/nexus-documents-test.js' });
const views = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const state = overrides => ({ status: 'ready', items: [identity, degree, ...degree.transcripts], requirements, error: '', notice: '', busy: false, detailId: degree.id, detail: degree, detailStatus: 'ready', detailError: '', history, ...overrides });
const context = (snapshot, query = 'id=degree-1') => ({ documentState: snapshot, routeParams: new URLSearchParams(query), escape: escapeHtml, icon: name => `<svg aria-hidden="true" data-icon="${name}"></svg>`, heading: (title, sub, action = '') => `<h1>${title}</h1><p>${sub}</p>${action}`, card: (title, body) => `<section><h2>${title}</h2>${body}</section>`, badge: text => `<span>${text}</span>`, button: (text, href) => `<a href="/${href}">${text}</a>` });

test('compact document rows keep icons, status badges, action menus and safe filenames', () => {
  const html = views.documentPage(context(state({ items: [{ ...identity, title: '<img src=x onerror=alert(1)>' }, degree, ...degree.transcripts] })));
  assert.ok(html.includes('Scan pending')); assert.ok(html.includes('Verification timeline'));
  assert.ok(html.includes('transcript.pdf'));
  assert.ok(html.includes('role="menu"'));
  assert.ok(html.includes('data-document-menu="identity-1"'));
  assert.ok(html.includes('data-document-action="preview"'));
  assert.ok(html.includes('data-document-action="replace"'));
  assert.ok(html.includes('aria-haspopup="menu"'));
  assert.ok(!html.includes('href="/document?id='));
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('Identity authenticated'));
  assert.ok(views.documentPage(context(state({ items: [] }))).includes('No documents yet'));
  assert.ok(views.documentPage(context(state({ status: 'loading' }))).includes('Loading your documents'));
  assert.match(views.documentPage(context(state({ status: 'loading', requirements: null }))), /data-document-action="upload" disabled/);
});

test('upload UI renders category-specific metadata, actual limits, replacement context and required transcripts', () => {
  const degreeHtml = views.upload(context(state(), 'category=BACHELOR'));
  assert.ok(degreeHtml.includes('name="courseName"')); assert.ok(degreeHtml.includes('name="institutionQuery"'));
  assert.ok(degreeHtml.includes('name="transcripts"')); assert.ok(degreeHtml.includes('10 MB'));
  assert.ok(!degreeHtml.includes('Preview submission'));
  const identityHtml = views.upload(context(state({ items: [] }), 'category=NATIONAL_ID'));
  assert.ok(!identityHtml.includes('name="institutionName"'));
  assert.ok(identityHtml.includes('name="transcripts" multiple accept="application/pdf,image/jpeg,image/png" disabled'));
  const replacement = views.upload(context(state(), 'replace=degree-1'));
  assert.ok(replacement.includes('Upload replacement')); assert.ok(replacement.includes('value="BACHELOR"'));
  assert.ok(replacement.includes('Engineering University'));
});

test('detail screen uses real history, escapes reviewer text and offers evidence only when requested', () => {
  const plain = views.documentDetail(context(state()));
  assert.ok(plain.includes('Document submitted')); assert.ok(plain.includes('No human verification'));
  assert.ok(!plain.includes('document-evidence-form'));
  const reviewed = views.documentDetail(context(state({ detail: { ...degree, status: 'ADDITIONAL_EVIDENCE_REQUIRED', scanStatus: 'CLEAN' }, history: { ...history, reviews: [{ outcome: 'ADDITIONAL_EVIDENCE_REQUIRED', method: 'MANUAL', reason: '<script>bad</script>', createdAt: identity.createdAt }] } })));
  assert.ok(reviewed.includes('document-evidence-form')); assert.ok(reviewed.includes('&lt;script&gt;'));
  assert.ok(!reviewed.includes('<script>'));
  assert.ok(reviewed.includes('>Download</button>'));
});


test('document detail heading escapes an untrusted uploaded filename', () => {
  const html = views.documentDetail(context(state({ detail: { ...degree, title: '<img src=x onerror=alert(1)>' } })));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});


test('modal details and history retain backend metadata and escape reviewer content', () => {
  const details = views.documentDialog(context(state()), 'details');
  assert.ok(details.includes('Engineering University'));
  assert.ok(details.includes('Malware scan'));
  const timeline = views.documentDialog(context(state({ history: { ...history, history: [{ toStatus: 'UNDER_REVIEW', reason: '<script>unsafe</script>', createdAt: identity.createdAt }] } })), 'history');
  assert.ok(timeline.includes('Status history'));
  assert.ok(timeline.includes('&lt;script&gt;'));
  assert.ok(!timeline.includes('<script>'));
  const replacement = views.documentDialog(context(state(), 'replace=degree-1'), 'replace');
  assert.ok(replacement.includes('Upload replacement'));
  assert.ok(replacement.includes('data-document-dialog-close'));
  assert.ok(!replacement.includes('>Cancel</a>'));
});

test('preview modals show images/PDFs only for clean files and explain pending scans', () => {
  const pending = views.documentDialog(context(state()), 'preview');
  assert.ok(pending.includes('waiting for its malware scan'));
  assert.ok(!pending.includes('<iframe'));
  const clean = context(state({ detail: { ...degree, scanStatus: 'CLEAN' } }));
  const pdf = views.documentDialog(clean, 'preview', 'blob:test-pdf', 'application/pdf');
  assert.ok(pdf.includes('<iframe')); assert.ok(pdf.includes('blob:test-pdf'));
  const fallback = views.documentDialog(clean, 'preview', 'blob:test-pdf', 'application/pdf-unavailable');
  assert.ok(fallback.includes('Download the original')); assert.ok(!fallback.includes('<iframe'));
  const image = views.documentDialog(clean, 'preview', 'blob:test-image', 'image/png');
  assert.ok(image.includes('<img')); assert.ok(image.includes('alt="Preview of degree.pdf"'));
  const shell = views.documentDialogShell('Details <script>', escapeHtml);
  assert.ok(shell.includes('<dialog')); assert.ok(shell.includes('aria-labelledby="document-dialog-title"'));
  assert.ok(shell.includes('aria-label="Close dialog"')); assert.ok(!shell.includes('<script>'));
});

test('preview loading blocks unscanned files, ignores closed requests and revokes private object URLs', async () => {
  let downloads = 0, finish;
  const revoked = [];
  const preview = createDocumentPreview({ download: () => { downloads++; return new Promise(resolve => { finish = resolve; }); }, createUrl: () => 'blob:private-document', revokeUrl: url => revoked.push(url) });
  assert.equal(await preview.load(identity), null); assert.equal(downloads, 0);
  const pending = preview.load({ ...identity, scanStatus: 'CLEAN' });
  preview.clear(); finish({ blob: pdf('old.pdf') });
  assert.equal(await pending, null);
  const opened = preview.load({ ...identity, scanStatus: 'CLEAN' });
  finish({ blob: pdf('current.pdf') });
  assert.deepEqual(await opened, { url: 'blob:private-document', type: 'application/pdf' });
  preview.clear(); assert.deepEqual(revoked, ['blob:private-document']);
});


test('institution search uses the authenticated endpoint and safely encodes the search text', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, options });
    return reply([{ id: 'institution-1', name: 'Engineering University' }]);
  } });
  assert.equal((await api.institutions('Engineering & Design'))[0].id, 'institution-1');
  assert.equal(calls[0].url, '/api/v1/institutions?search=Engineering+%26+Design&limit=20');
  assert.equal(calls[0].options.credentials, 'include');
});

test('institution lookup debounces typing and discards late results and closed searches', async () => {
  const tasks = new Map(); let taskId = 0;
  const pending = [], results = [];
  const lookup = createInstitutionLookup({
    search: query => new Promise(resolve => pending.push({ query, resolve })),
    onResult: result => results.push(result),
    schedule: callback => { tasks.set(++taskId, callback); return taskId; },
    cancel: id => tasks.delete(id),
  });
  lookup.query('E'); assert.equal(tasks.size, 0);
  lookup.query('En'); lookup.query('Eng'); assert.equal(tasks.size, 1);
  const first = [...tasks.values()][0](); tasks.clear();
  lookup.query('Engineering');
  const second = [...tasks.values()][0](); tasks.clear();
  pending[1].resolve([{ id: 'correct' }]); await second;
  pending[0].resolve([{ id: 'stale' }]); await first;
  assert.equal(results.at(-1).items[0].id, 'correct');
  lookup.query('University'); const third = [...tasks.values()][0]();
  lookup.clear(); pending[2].resolve([{ id: 'closed' }]); await third;
  assert.ok(!results.some(result => result.items.some(item => item.id === 'closed')));
});

test('uploads send the selected institution ID or manual name and require an explicit choice', () => {
  const selected = form(); selected.set('institutionId', 'institution-1'); selected.set('institutionQuery', 'Engineering University');
  const body = uploadBody(selected, requirements);
  assert.equal(body.get('institutionId'), 'institution-1');
  assert.equal(body.has('institutionName'), false);
  assert.equal(body.has('institutionQuery'), false);
  const unselected = form(); unselected.delete('institutionName'); unselected.set('institutionQuery', 'Engineering');
  assert.throws(() => uploadBody(unselected, requirements), /Select an institution/);
  assert.equal(uploadBody(form(), requirements).get('institutionName'), 'Engineering University');
  const nationalId = form('NATIONAL_ID'); nationalId.set('institutionId', 'stale-id');
  assert.equal(uploadBody(nationalId, requirements).has('institutionId'), false);
});

test('institution form supports search, manual names and retained replacement selections', () => {
  const html = views.upload(context(state(), 'category=BACHELOR'));
  assert.ok(html.includes('role="combobox"'));
  assert.ok(html.includes('role="listbox"'));
  assert.ok(html.includes('Institution not listed?'));
  const replacement = { ...degree, institutionId: 'institution-1' };
  const selected = views.upload(context(state({ detail: replacement }), 'replace=degree-1'));
  assert.ok(selected.includes('name="institutionId" value="institution-1"'));
  assert.ok(selected.includes('value="Engineering University"'));
  assert.ok(selected.includes('data-manual="false"'));
  const manual = views.upload(context(state(), 'replace=degree-1'));
  assert.ok(manual.includes('name="institutionName"'));
  assert.ok(manual.includes('data-manual="true"'));
});

test('new uploads start with an empty category and only reveal metadata after selection', () => {
  const html = views.upload(context(state(), ''));
  assert.ok(html.includes('<option value="" selected>Select the category of document you wish to upload</option>'));
  assert.ok(html.includes('Choose your document'));
  assert.ok(!html.includes('name="courseName"'));
  assert.ok(!html.includes('data-institution-field'));
  assert.ok(!html.includes('name="verificationUrl"'));
  assert.ok(html.includes('id="document-submit" class="btn primary" disabled'));
  const degreeHtml = views.upload(context(state(), 'category=BACHELOR'));
  assert.ok(degreeHtml.indexOf('name="courseName"') < degreeHtml.indexOf('data-institution-field'));
  assert.ok(degreeHtml.indexOf('data-institution-field') < degreeHtml.indexOf('name="issuedAt"'));
  assert.ok(!degreeHtml.includes('name="expiresAt"'));
});

test('metadata shows relevant category fields and always offers an optional verification URL', () => {
  const rules = [
    ...requirements.categories,
    { category: 'SHORT_COURSE', institutionRequired: false, requiredFields: ['courseName'] },
    { category: 'INDUSTRY_CERTIFICATION', institutionRequired: false, requiredFields: ['certificationName', 'issuer', 'issuedAt'] },
    { category: 'PROFESSIONAL_REGISTRATION', institutionRequired: false, requiredFields: ['issuer', 'issuedAt', 'expiresAt'] },
  ];
  for (const rule of rules) {
    const html = views.uploadMetadata(rule, {}, escapeHtml);
    assert.ok(html.includes('Official verification URL (optional)'), rule.category);
    assert.match(html, /name="verificationUrl"[^>]*>/);
    assert.ok(!html.match(/name="verificationUrl"[^>]*\brequired\b/));
    if (['NATIONAL_ID', 'PASSPORT', 'OTHER'].includes(rule.category)) {
      assert.ok(!html.includes('name="issuedAt"'));
      assert.ok(!html.includes('name="credentialNumber"'));
      assert.ok(!html.includes('data-institution-field'));
    }
    if (rule.category === 'INDUSTRY_CERTIFICATION') {
      assert.ok(html.includes('name="certificationName"'));
      assert.ok(!html.includes('data-institution-field'));
    }
    if (rule.category === 'PROFESSIONAL_REGISTRATION') assert.match(html, /name="expiresAt"[^>]*required/);
  }
  const nationalId = form('NATIONAL_ID'); nationalId.set('verificationUrl', 'https://verification.example.test/id');
  assert.equal(uploadBody(nationalId, requirements).get('verificationUrl'), 'https://verification.example.test/id');
});

test('document API follows every cursor page for identity, academic and eligible qualifications', async () => {
  const academic = Array.from({ length: 205 }, (_, i) => ({ ...degree, id: `degree-${i}`, transcripts: [], isCurrent: true }));
  const identities = Array.from({ length: 103 }, (_, i) => ({ ...identity, id: `identity-${i}`, isCurrent: true }));
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, options }); const parsed = new URL(url, 'https://test.invalid');
    const qualified = parsed.searchParams.get('eligibleForAssessment') === 'true';
    const items = parsed.pathname.includes('/identity/') ? identities : qualified ? [academic[204]] : academic;
    const offset = Number(parsed.searchParams.get('cursor') || 0), data = items.slice(offset, offset + 100), hasMore = offset + data.length < items.length;
    return new Response(JSON.stringify({ data, meta: { hasMore, nextCursor: hasMore ? String(offset + data.length) : null, total: items.length, summary: { current: items.length, authenticated: 0 } } }));
  } });
  const collection = await api.documentCollection();
  assert.equal(collection.items.length, 308); assert.deepEqual(collection.summary, { current: 308, authenticated: 0 });
  assert.equal(new Set(collection.items.map(doc => doc.id)).size, 308); assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.options.credentials === 'include'));
  assert.equal((await api.documents()).length, 205); assert.equal((await api.identityDocuments()).length, 103);
  assert.deepEqual((await api.eligibleQualifications()).map(doc => doc.id), ['degree-204']);
  assert.ok(calls.at(-1).url.includes('eligibleForAssessment=true'));
});

test('a later page failure never publishes partial documents and refresh restarts the collection', async () => {
  let fail = true; const requests = [];
  const api = createApi({ fetcher: async url => {
    requests.push(url); const parsed = new URL(url, 'https://test.invalid');
    if (parsed.pathname.endsWith('/requirements')) return reply(requirements);
    if (parsed.searchParams.has('cursor') && fail) throw new Error('Offline');
    const second = parsed.searchParams.has('cursor'), identityPage = parsed.pathname.includes('/identity/');
    return new Response(JSON.stringify({ data: identityPage ? [identity] : second ? [{ ...degree, id: 'older-degree' }] : [degree], meta: { hasMore: !identityPage && !second, nextCursor: !identityPage && !second ? 'next' : null, summary: { current: identityPage ? 1 : 3, authenticated: 0 } } }));
  } });
  const store = createDocumentStore({ client: api }); await store.load('applicant');
  assert.equal(store.snapshot().status, 'error'); assert.deepEqual(store.snapshot().items, []); assert.equal(store.snapshot().summary, null);
  fail = false; await store.load('applicant', true); assert.equal(store.snapshot().status, 'ready');
  assert.ok(store.snapshot().items.some(doc => doc.id === 'older-degree'));
  assert.equal(requests.filter(url => { const parsed = new URL(url, 'https://test.invalid'); return parsed.pathname === '/api/v1/documents' && !parsed.searchParams.has('cursor'); }).length, 2);
});

test('paging ignores old-session responses and rejects cursors that do not advance', async () => {
  let resolve, calls = 0;
  const api = createApi({ fetcher: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const loading = api.documents(); api.clear();
  resolve(new Response(JSON.stringify({ data: [degree], meta: { hasMore: true, nextCursor: 'next', summary: { current: 1, authenticated: 0 } } })));
  await assert.rejects(loading, /session changed/); assert.equal(calls, 1);
  const looping = createApi({ fetcher: async () => new Response(JSON.stringify({ data: [degree], meta: { hasMore: true, nextCursor: 'same-cursor', summary: { current: 1, authenticated: 0 } } })) });
  await assert.rejects(looping.documents(), /could not advance/);
});

test('server flags identify previous transcripts without loading their parent qualification', () => {
  const historical = { ...degree.transcripts[0], isCurrent: false };
  assert.ok(previousDocumentIds([historical]).has(historical.id));
  const html = views.documentPage(context(state({ items: [historical], summary: { current: 0, authenticated: 0 } })));
  assert.ok(html.includes('Previous versions')); assert.ok(html.includes('0 documents'));
});
