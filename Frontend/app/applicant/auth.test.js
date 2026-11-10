import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../../lib/api.js';

const reply = (data, status = 200) => new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), { status });
const handlers = {};

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
  globalThis.location = { hash: '#/login' };
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
  assert.equal(location.hash, '/login');
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
    assert.equal(location.hash, '/verify-email');
    assert.equal(registered.email, 'applicant@example.test');
    assert.equal(registered.consentVersion, '2026-11-01');
    assert.equal(registered.consent, undefined);
    api.verify = async body => { assert.equal(body.code, '123456'); };
    await submit('verify-email', { email: identity.email, code: '123456' });
    assert.equal(location.hash, '/login');
    api.forgot = async () => ({ message: 'If the account is eligible, an email will be sent.' });
    await submit('forgot-password', { email: identity.email });
    assert.equal(location.hash, '/reset-password');
    api.reset = async body => { assert.equal(body.passwordConfirmation, 'new password'); return { message: 'Password updated; sign in again' }; };
    await submit('reset-password', { email: identity.email, code: '123456', password: 'new password', passwordConfirmation: 'new password' });
    assert.equal(location.hash, '/login');
    api.login = async () => { throw new ApiError('Invalid email or password', 401, 'INVALID_CREDENTIALS'); };
    await submit('login', { email: identity.email, password: 'wrong password' });
    assert.equal(currentUser(), null);
    assert.equal(alert.textContent, 'Invalid email or password');
    api.login = async () => ({ csrfToken: 'rotated' });
    api.me = async () => identity;
    await submit('login', { email: identity.email, password: 'new password' });
    assert.equal(location.hash, '/dashboard');
    assert.equal(currentUser().email, identity.email);
    let loggedOut = false;
    api.logout = async () => { loggedOut = true; };
    const button = { dataset: { authAction: 'logout' }, disabled: false };
    await handlers.click({ target: { closest: () => button } });
    assert.equal(loggedOut, true);
    assert.equal(currentUser(), null);
    assert.equal(location.hash, '/login');
  } finally { Object.assign(api, originals); globalThis.FormData = originalFormData; }
});

