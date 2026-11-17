import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../lib/api.js';

const reply = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
const handlers = {};
function setPath(path) {
  const url = new URL(path, 'http://localhost:3000');
  globalThis.location = { origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, href: url.href };
}
globalThis.history = { pushState: (_state, _title, path) => setPath(path), replaceState: (_state, _title, path) => setPath(path) };


test('signup sends the exact backend payload with session cookies and CSRF', async () => {
  const calls = [];
  const api = createApi({ base: '/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return url.endsWith('/csrf') ? reply({ csrfToken: 'token-1' }) : reply({ message: 'If the account is eligible, an email will be sent.' }, 202);
  } });
  const body = { legalName: 'Example Applicant', email: 'example@example.test', phone: '+254712345678', password: 'example passphrase', passwordConfirmation: 'example passphrase', consentVersion: '2026-11-01' };
  await api.register(body);
  assert.equal(calls[0].url, '/api/v1/auth/csrf');
  assert.equal(calls[1].url, '/api/v1/auth/register');
  assert.equal(calls[1].credentials, 'include');
  assert.equal(calls[1].headers['X-CSRF-Token'], 'token-1');
  assert.deepEqual(JSON.parse(calls[1].body), body);
});

test('login rotates CSRF; /me reads the cookie session; logout clears CSRF', async () => {
  const calls = [];
  const api = createApi({ fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/csrf')) return reply({ csrfToken: 'original' });
    if (url.endsWith('/login')) return reply({ csrfToken: 'rotated' });
    if (url.endsWith('/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('/me')) return reply({ roles: ['APPLICANT'], legalName: 'Applicant' });
    return reply({ message: 'sent' });
  } });
  await api.login({ email: 'a@example.test', password: 'secret' });
  assert.equal((await api.me()).legalName, 'Applicant');
  await api.logout();
  assert.equal(calls.find(c => c.url.endsWith('/logout')).headers['X-CSRF-Token'], 'rotated');
  await api.forgot({ email: 'a@example.test' });
  assert.equal(calls.filter(c => c.url.endsWith('/csrf')).length, 2);
});

test('recovery, reset, verification and resend use their backend contracts', async () => {
  const calls = [];
  const api = createApi({ fetcher: async (url, options) => {
    calls.push({ url, ...options });
    return url.endsWith('/csrf') ? reply({ csrfToken: 'token' }) : reply({ message: 'accepted' });
  } });
  await api.forgot({ email: 'a@example.test' });
  await api.reset({ email: 'a@example.test', code: '123456', password: 'new password', passwordConfirmation: 'new password' });
  await api.verify({ email: 'a@example.test', code: '123456' });
  await api.resend({ email: 'a@example.test' });
  assert.deepEqual(calls.slice(1).map(c => c.url.split('/').at(-1)), ['forgot-password', 'reset-password', 'verify-email', 'resend-verification']);
  assert.equal(JSON.parse(calls[2].body).code, '123456');
  assert.ok(calls.slice(1).every(c => c.method === 'POST' && c.credentials === 'include'));
});

test('validation and rate limiting errors are preserved without retrying credentials', async () => {
  let count = 0;
  const api = createApi({ fetcher: async url => {
    if (url.endsWith('/csrf')) return reply({ csrfToken: 'token' });
    count++;
    return reply({ code: 'VALIDATION_ERROR', message: 'Check the submitted fields', details: [{ path: 'phone', message: 'Enter a valid phone number' }] }, 422);
  } });
  await assert.rejects(api.register({}), error => error.status === 422 && error.details[0].path === 'phone');
  assert.equal(count, 1);
  const limited = createApi({ fetcher: async () => reply({ code: 'RATE_LIMITED', message: 'Too many requests' }, 429) });
  await assert.rejects(limited.me(), error => error.code === 'RATE_LIMITED');
});

test('CSRF rejection refreshes the token exactly once before replay', async () => {
  let tokens = 0, posts = 0;
  const api = createApi({ fetcher: async (url, options) => {
    if (url.endsWith('/csrf')) return reply({ csrfToken: `token-${++tokens}` });
    if (++posts === 1) return reply({ code: 'CSRF_INVALID' }, 403);
    assert.equal(options.headers['X-CSRF-Token'], 'token-2');
    return reply({ message: 'accepted' });
  } });
  await api.forgot({ email: 'a@example.test' });
  assert.equal(tokens, 2);
  assert.equal(posts, 2);
});

test('offline and invalid server responses produce actionable errors', async () => {
  const offline = createApi({ fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(offline.me(), error => error instanceof ApiError && error.code === 'NETWORK_ERROR');
  const invalid = createApi({ fetcher: async () => new Response('<html>Proxy unavailable</html>', { status: 502 }) });
  await assert.rejects(invalid.me(), error => error.status === 502 && error.message.includes('unexpected response'));
});

test('auth pages include backend fields, accessible errors and password constraints', async () => {
  globalThis.document = { addEventListener(type, handler) { handlers[type] = handler; } };
  setPath('/login');
  const { authPage, authGate, initializeAuth } = await import('../../context/auth.js');
  for (const route of ['login', 'signup', 'forgot-password', 'verify-email', 'reset-password']) {
    const html = authPage(route);
    assert.ok(html.includes('connected-auth-form'));
    assert.ok(html.includes('role="alert"'));
    assert.ok(!html.includes('Design preview'));
  }
  assert.ok(authPage('signup').includes('name="consent"'));
  assert.ok(authPage('signup').includes('minlength="8"'));
  assert.ok(authPage('reset-password').includes('name="code"'));
  assert.ok(authPage('verify-email').includes('data-auth-action="resend"'));
  const originalFetch = globalThis.fetch;
  // The shared client captured fetch at module initialization; test the guard using a real client stub.
  const { api } = await import('../../lib/api.js');
  const originalMe = api.me;
  api.me = async () => { throw new ApiError('Sign in', 401); };
  await initializeAuth(() => {});
  assert.ok(authGate('dashboard').includes('Sign in'));
  assert.equal(location.pathname + location.search, '/login');
  api.me = originalMe;
  globalThis.fetch = originalFetch;
});

test('form submissions complete signup, verification, recovery, reset, login and logout', async () => {
  const { api } = await import('../../lib/api.js');
  const { currentUser } = await import('../../context/auth.js');
  const originals = { ...api };
  const originalFormData = globalThis.FormData;
  const alert = { hidden: true, textContent: '', focus() {} };
  globalThis.document.getElementById = () => alert;
  globalThis.document.querySelector = () => null;
  globalThis.document.contains = () => true;
  globalThis.FormData = class { constructor(form) { this.values = form.values; } *[Symbol.iterator]() { yield* Object.entries(this.values); } };
  const submit = async (route, values) => {
    const form = { id: 'connected-auth-form', dataset: { route }, values, setAttribute() {}, querySelectorAll() { return []; } };
    await handlers.submit({ target: form, preventDefault() {} });
  };
  try {
    const identity = { email: 'applicant@example.test', legalName: 'Applicant Example', roles: ['APPLICANT'], emailVerifiedAt: '2026-11-10' };
    let registered;
    api.register = async body => { registered = body; return { message: 'If the account is eligible, an email will be sent.' }; };
    await submit('signup', { legalName: 'Applicant Example', email: 'Applicant@Example.test', phone: '0712345678', password: 'long password', passwordConfirmation: 'long password', consent: 'on' });
    assert.equal(location.pathname + location.search, '/verify-email');
    assert.equal(registered.email, 'applicant@example.test');
    assert.equal(registered.consentVersion, '2026-11-01');
    assert.equal(registered.consent, undefined);
    api.verify = async body => { assert.equal(body.code, '123456'); };
    await submit('verify-email', { email: identity.email, code: '123456' });
    assert.equal(location.pathname + location.search, '/login');
    api.forgot = async () => ({ message: 'If the account is eligible, an email will be sent.' });
    await submit('forgot-password', { email: identity.email });
    assert.equal(location.pathname + location.search, '/reset-password');
    api.reset = async body => { assert.equal(body.passwordConfirmation, 'new password'); return { message: 'Password updated; sign in again' }; };
    await submit('reset-password', { email: identity.email, code: '123456', password: 'new password', passwordConfirmation: 'new password' });
    assert.equal(location.pathname + location.search, '/login');
    api.login = async () => { throw new ApiError('Invalid email or password', 401, 'INVALID_CREDENTIALS'); };
    await submit('login', { email: identity.email, password: 'wrong password' });
    assert.equal(currentUser(), null);
    assert.equal(alert.textContent, 'Invalid email or password');
    api.login = async () => ({ csrfToken: 'rotated' });
    api.me = async () => identity;
    await submit('login', { email: identity.email, password: 'new password' });
    assert.equal(location.pathname + location.search, '/dashboard');
    assert.equal(currentUser().email, identity.email);
    let loggedOut = false;
    api.logout = async () => { loggedOut = true; };
    const button = { dataset: { authAction: 'logout' }, disabled: false };
    await handlers.click({ target: { closest: () => button } });
    assert.equal(loggedOut, true);
    assert.equal(currentUser(), null);
    assert.equal(location.pathname + location.search, '/login');
  } finally { Object.assign(api, originals); globalThis.FormData = originalFormData; }
});


test('Google starts as browser navigation and completion uses cookies and rotated CSRF', async () => {
  const calls = [];
  const client = createApi({ base: 'http://localhost:4000/api/v1', fetcher: async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/csrf')) return reply({ csrfToken: 'pending-session' });
    if (url.endsWith('/complete')) return reply({ authenticated: true, csrfToken: 'signed-in-session' }, 201);
    return new Response(null, { status: 204 });
  } });
  assert.equal(client.googleStartUrl(), 'http://localhost:4000/api/v1/auth/google');
  const body = { phone: '+254712345678', consentVersion: '2026-11-01' };
  await client.completeGoogle(body);
  assert.deepEqual(JSON.parse(calls[1].body), body);
  assert.equal(calls[1].credentials, 'include');
  assert.equal(calls[1].headers['X-CSRF-Token'], 'pending-session');
  await client.logout();
  assert.equal(calls[2].headers['X-CSRF-Token'], 'signed-in-session');
});

test('Google routes parse outcomes independently and use the existing auth layout', async () => {
  const { getRoute, getRouteParams } = await import('../../hooks/navigation.js');
  const { authPage, authGate, initializeAuth } = await import('../../context/auth.js');
  const { api } = await import('../../lib/api.js');
  const originalMe = api.me;
  const originalRegistration = api.googleRegistration;
  api.googleRegistration = async () => ({ email: 'selected@example.test', name: 'Selected Applicant', expiresAt: new Date(Date.now() + 600000).toISOString() });
  setPath('/register/google?status=registrationRequired');
  assert.equal(getRoute(), 'register/google');
  assert.equal(getRouteParams().get('status'), 'registrationRequired');
  api.me = async () => { throw new ApiError('Sign in', 401); };
  try {
    await initializeAuth(() => {});
    const html = authGate(getRoute());
    assert.ok(html.includes('auth-layout'));
    assert.ok(html.includes('name="phone"'));
    assert.ok(html.includes('name="consent"'));
    assert.ok(!html.includes('name="password"'));
    assert.ok(!html.includes('name="email"'));
    assert.ok(!html.includes('name="code"'));
    assert.ok(authPage('login').includes('data-auth-action="google"'));
    assert.ok(authPage('signup').includes('data-auth-action="google"'));
    assert.ok(!authPage('auth/google/callback').includes('connected-auth-form'));
    setPath('/login?error=ACCOUNT_LINK_REQUIRED');
    assert.ok(authPage('login').includes('Sign in using your password'));
    setPath('/login?error=%3Cscript%3Ealert(1)%3C/script%3E');
    assert.ok(!authPage('login').includes('<script>'));
    setPath('/login?error=ACCOUNT_RESTRICTED');
    assert.ok(authPage('login').includes('Contact support'));
  } finally { api.me = originalMe; api.googleRegistration = originalRegistration; }
});

test('callback verifies /me, rejects forged success, and can retry a failed session check', async () => {
  const { authGate, initializeAuth } = await import('../../context/auth.js');
  const { api } = await import('../../lib/api.js');
  const originalMe = api.me;
  try {
    setPath('/auth/google/callback?status=authenticated');
    api.me = async () => { throw new ApiError('Sign in', 401); };
    await initializeAuth(() => {});
    authGate('auth/google/callback');
    assert.equal(location.pathname + location.search, '/login?error=GOOGLE_FLOW_INVALID');
    setPath('/auth/google/callback?status=authenticated');
    api.me = async () => { throw new ApiError('Unable to reach the server.'); };
    await initializeAuth(() => {});
    const failure = authGate('auth/google/callback');
    assert.ok(failure.includes('Unable to reach the server.'));
    assert.ok(failure.includes('data-auth-action="retry"'));
    api.me = async () => ({ email: 'google@example.test', roles: ['APPLICANT'], emailVerifiedAt: '2026-11-13' });
    await initializeAuth(() => {});
    authGate('auth/google/callback');
    assert.equal(location.pathname + location.search, '/dashboard');
    setPath('/auth/google/callback?status=authenticated');
    api.me = async () => ({ email: 'admin@example.test', roles: ['ADMIN'], emailVerifiedAt: '2026-11-13' });
    let destination;
    location.replace = url => { destination = url; };
    await initializeAuth(() => {});
    authGate('auth/google/callback');
    assert.equal(destination, 'http://localhost:3002/dashboard');
  } finally { api.me = originalMe; }
});

test('Google completion requires consent, sends only phone/version, and handles expiry', async () => {
  const { api } = await import('../../lib/api.js');
  const { currentUser } = await import('../../context/auth.js');
  const originals = { ...api };
  const originalFormData = globalThis.FormData;
  const alert = { hidden: true, textContent: '', focus() {} };
  document.getElementById = () => alert;
  document.querySelector = () => null;
  document.contains = () => true;
  globalThis.FormData = class { constructor(form) { this.values = form.values; } *[Symbol.iterator]() { yield* Object.entries(this.values); } };
  const submit = async values => handlers.submit({ preventDefault() {}, target: {
    id: 'connected-auth-form', dataset: { route: 'register/google' }, values,
    setAttribute() {}, querySelectorAll: () => [],
  } });
  try {
    let completed = 0;
    api.completeGoogle = async body => {
      completed++;
      assert.deepEqual(body, { phone: '+254712345678', consentVersion: '2026-11-01' });
      return { authenticated: true };
    };
    await submit({ phone: '+254712345678' });
    assert.equal(completed, 0);
    assert.ok(alert.textContent.includes('accept the privacy notice'));
    api.me = async () => ({ email: 'new-google@example.test', roles: ['APPLICANT'], emailVerifiedAt: '2026-11-13' });
    await submit({ phone: ' +254712345678 ', consent: 'on' });
    assert.equal(completed, 1);
    assert.equal(location.pathname + location.search, '/dashboard');
    assert.equal(currentUser().email, 'new-google@example.test');
    setPath('/register/google');
    api.completeGoogle = async () => { throw new ApiError('Restart Google registration', 400, 'GOOGLE_FLOW_INVALID'); };
    await submit({ phone: '+254712345678', consent: 'on' });
    assert.equal(location.pathname + location.search, '/register/google');
    const { authPage } = await import('../../context/auth.js');
    assert.ok(authPage('register/google').includes('Your signup session expired'));
    assert.ok(!authPage('register/google').includes('connected-auth-form'));
    let destination;
    const previousAssign = location.assign;
    location.assign = url => { destination = url; };
    const button = { dataset: { authAction: 'google' }, disabled: false };
    await handlers.click({ target: { closest: () => button } });
    assert.equal(destination, 'http://localhost:4000/api/v1/auth/google');
    location.assign = previousAssign;
  } finally { Object.assign(api, originals); globalThis.FormData = originalFormData; }
});

test('Google signup restores the server identity after refresh and checks expiry before showing a form', async () => {
  const { api } = await import('../../lib/api.js');
  const { authPage, initializeAuth, refreshGoogleRegistration } = await import('../../context/auth.js');
  const original = api.googleRegistration;
  setPath('/register/google?email=forged@example.test');
  const identity = { email: 'selected@example.test', name: '<img src=x onerror=alert(1)>', expiresAt: new Date(Date.now() + 600000).toISOString() };
  try {
    let calls = 0;
    api.googleRegistration = async () => { calls++; return identity; };
    await initializeAuth(() => {});
    let html = authPage('register/google');
    assert.ok(html.includes('Signing up as'));
    assert.ok(html.includes('selected@example.test'));
    assert.ok(html.includes('Use another Google account'));
    assert.ok(!html.includes('forged@example.test'));
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
    await refreshGoogleRegistration();
    assert.equal(calls, 2);
    assert.ok(authPage('register/google').includes('selected@example.test'));
    api.googleRegistration = async () => { throw new ApiError('Expired', 400, 'GOOGLE_FLOW_INVALID'); };
    await refreshGoogleRegistration();
    html = authPage('register/google');
    assert.ok(html.includes('Your signup session expired'));
    assert.ok(html.includes('Continue with Google'));
    assert.ok(!html.includes('connected-auth-form'));
    assert.ok(!html.includes('selected@example.test'));
    api.googleRegistration = async () => ({ ...identity, expiresAt: new Date(Date.now() - 1).toISOString() });
    await refreshGoogleRegistration();
    assert.ok(authPage('register/google').includes('Your signup session expired'));
    api.googleRegistration = async () => { throw new ApiError('Unable to reach the server.'); };
    await refreshGoogleRegistration();
    html = authPage('register/google');
    assert.ok(html.includes('Unable to reach the server.'));
    assert.ok(html.includes('data-auth-action="google-retry"'));
    assert.ok(!html.includes('connected-auth-form'));
    api.googleRegistration = async () => identity;
    await handlers.click({ target: { closest: () => ({ dataset: { authAction: 'google-retry' } }) } });
    assert.ok(authPage('register/google').includes('selected@example.test'));
  } finally { api.googleRegistration = original; }
});

test('late Google identity responses cannot overwrite an account-switch request', async () => {
  const { api } = await import('../../lib/api.js');
  const { authPage, refreshGoogleRegistration } = await import('../../context/auth.js');
  const original = api.googleRegistration;
  const originalAssign = location.assign;
  setPath('/register/google');
  try {
    let finish;
    api.googleRegistration = () => new Promise(resolve => { finish = resolve; });
    const loading = refreshGoogleRegistration();
    assert.ok(authPage('register/google').includes('Checking your Google signup session'));
    assert.ok(!authPage('register/google').includes('connected-auth-form'));
    let navigated;
    location.assign = url => { navigated = url; };
    await handlers.click({ target: { closest: () => ({ dataset: { authAction: 'google' } }) } });
    finish({ email: 'old@example.test', name: 'Old Account', expiresAt: new Date(Date.now() + 600000).toISOString() });
    await loading;
    assert.equal(navigated, api.googleStartUrl());
    assert.ok(!authPage('register/google').includes('old@example.test'));
  } finally { api.googleRegistration = original; location.assign = originalAssign; }
});

test('an open signup form expires without requiring a page refresh', async () => {
  const { api } = await import('../../lib/api.js');
  const { authPage, refreshGoogleRegistration } = await import('../../context/auth.js');
  const originalRegistration = api.googleRegistration;
  const originalTimeout = globalThis.setTimeout;
  setPath('/register/google');
  let expire;
  try {
    globalThis.setTimeout = callback => { expire = callback; return { unref() {} }; };
    api.googleRegistration = async () => ({ email: 'selected@example.test', name: 'Selected Applicant', expiresAt: new Date(Date.now() + 60000).toISOString() });
    await refreshGoogleRegistration();
    assert.ok(authPage('register/google').includes('connected-auth-form'));
    expire();
    const html = authPage('register/google');
    assert.ok(html.includes('Your signup session expired'));
    assert.ok(!html.includes('connected-auth-form'));
    assert.ok(!html.includes('selected@example.test'));
  } finally { api.googleRegistration = originalRegistration; globalThis.setTimeout = originalTimeout; }
});

test('shared password login routes backend roles without signing administrators out', async () => {
  const { api } = await import('../../lib/api.js');
  const { authGate, initializeAuth } = await import('../../context/auth.js');
  const originals = { ...api }, originalFormData = globalThis.FormData;
  let principal, destination, logouts = 0;
  api.me = async () => principal;
  api.login = async () => ({});
  api.logout = async () => { logouts++; };
  globalThis.FormData = class { constructor(form) { return Object.entries(form.values); } };
  const element = { hidden: true, textContent: '', focus() {} };
  document.getElementById = () => element;
  document.querySelector = () => null;
  const submit = async roles => {
    setPath('/login'); destination = '';
    location.replace = url => { destination = url; };
    principal = { id: 'role-test', email: 'role@example.test', roles, emailVerifiedAt: '2026-11-13' };
    await handlers.submit({ preventDefault() {}, target: { id: 'connected-auth-form', dataset: { route: 'login' }, values: { email: principal.email, password: 'test passphrase' }, setAttribute() {}, querySelectorAll: () => [] } });
  };
  try {
    await submit(['ADMIN']);
    assert.equal(destination, 'http://localhost:3002/dashboard'); assert.equal(logouts, 0);
    await submit(['APPLICANT']); assert.equal(location.pathname, '/dashboard'); assert.equal(destination, '');
    await submit(['ADMIN', 'APPLICANT']); assert.equal(location.pathname, '/workspaces');
    const picker = authGate('workspaces');
    assert.ok(picker.includes('http://localhost:3002/dashboard'));
    assert.ok(picker.includes('http://localhost:3000/dashboard'));
    assert.ok(picker.includes('requires MFA'));
    await submit(['TRAINER']); assert.equal(destination,'http://localhost:3003/dashboard');
    await submit(['TRAINER','APPLICANT']); assert.equal(location.pathname,'/workspaces'); assert.ok(authGate('workspaces').includes('Trainer workspace'));
    await submit(['EMPLOYER']); assert.equal(location.pathname, '/workspaces');
    assert.ok(authGate('workspaces').includes('Workspace access required'));
    assert.ok(!authGate('workspaces').includes('Administrator workspace'));
    setPath('/login'); principal.emailVerifiedAt = null; principal.roles = ['ADMIN'];
    await initializeAuth(() => {}); authGate('login'); assert.equal(location.pathname, '/verify-email');
  } finally { Object.assign(api, originals); globalThis.FormData = originalFormData; }
});
