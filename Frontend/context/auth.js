import { escapeHtml as escape } from '../components/html.js';
import { getRoute } from '../hooks/navigation.js';
import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

const authRoutes = new Set(['login', 'register', 'signup', 'forgot-password', 'reset-password', 'verify-email']);
const publicRoutes = new Set([...authRoutes, 'privacy', 'help']);
let user = null;
let ready = false;
let bootError = '';
let email = '';
let message = '';
let busy = false;
let onChange = () => {};
let loadVersion = 0;
export const currentUser = () => user;
const go = route => { location.hash = `/${route}`; };

function input(label, name, type = 'text', attributes = '') {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" aria-describedby="error-${name}" ${name === 'email' ? `value="${escape(email)}" autocomplete="email" maxlength="254"` : ''} ${attributes} required><span id="error-${name}" class="field-error" data-error="${name}"></span></div>`;
}

export function authPage(route) {
  const signup = route === 'register' || route === 'signup';
  const login = route === 'login';
  const forgot = route === 'forgot-password';
  const reset = route === 'reset-password';
  const title = signup ? 'Create your account' : login ? 'Welcome back.' : forgot ? 'Forgot your password?' : reset ? 'Set a new password' : 'Verify your email';
  const subtitle = signup ? 'Your next engineering chapter starts here.' : login ? 'Sign in to continue your career journey.' : forgot ? 'We’ll email you a recovery code if your account is eligible.' : reset ? 'Enter the six-digit code from your recovery email.' : 'Enter the six-digit code sent to your inbox.';
  return `<main class="auth-layout"><section class="auth-intro"><a class="brand" href="#/login"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a><div class="auth-story"><span class="eyebrow">YOUR POTENTIAL. YOUR DIRECTION.</span><h1>Build the skills.<br>Shape your future.</h1><p>Discover where you stand, explore what’s possible, and take the next step with confidence.</p><div class="auth-orbit" aria-hidden="true"><span>N</span></div><div class="auth-values"><span>01 &nbsp; Discover your strengths</span><span>02 &nbsp; Assess your competencies</span><span>03 &nbsp; Grow with a clear plan</span></div></div><small>Engineering a more confident tomorrow.</small></section><section class="auth-panel"><div class="auth-form-wrap"><div class="eyebrow">APPLICANT PORTAL</div><h1>${title}</h1><p>${subtitle}</p>${message ? `<div class="notice mt" role="status">${escape(message)}</div>` : ''}<div id="auth-error" class="auth-error" role="alert" tabindex="-1" hidden></div><form id="connected-auth-form" data-route="${route}">${signup ? input('Full legal name', 'legalName', 'text', 'autocomplete="name" minlength="3" maxlength="150"') : ''}${input('Email address', 'email', 'email')}${signup ? input('Phone number', 'phone', 'tel', 'autocomplete="tel" maxlength="32" placeholder="e.g. +254 712 345 678"') : ''}${reset || route === 'verify-email' ? input('Six-digit code', 'code', 'text', 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"') : ''}${login || signup || reset ? input(reset ? 'New password' : 'Password', 'password', 'password', `autocomplete="${login ? 'current-password' : 'new-password'}" minlength="${login ? 1 : 8}" maxlength="128"`) : ''}${signup || reset ? `${input('Confirm password', 'passwordConfirmation', 'password', 'autocomplete="new-password" minlength="8" maxlength="128"')}<p class="password-hint">Use 8–128 characters. A longer passphrase is easier to remember.</p>` : ''}${signup ? '<label class="check"><input name="consent" type="checkbox" required><span>I have read the <a href="#/privacy">privacy notice</a> and consent to processing my application.</span></label>' : ''}${login ? '<div class="auth-forgot"><a href="#/forgot-password">Forgot password?</a></div>' : ''}<button type="submit" class="btn primary auth-submit">${signup ? 'Create account' : login ? 'Sign in' : forgot ? 'Send recovery code' : reset ? 'Update password' : 'Verify email'} <span aria-hidden="true">→</span></button></form>${login ? '<p class="auth-switch">New to NEXUS? <a href="#/signup">Create an account</a></p><p class="auth-switch">Need to verify your email? <a href="#/verify-email">Enter verification code</a></p>' : signup ? '<p class="auth-switch">Already have an account? <a href="#/login">Sign in</a></p>' : '<p class="auth-switch"><a href="#/login">← Back to sign in</a></p>'}${route === 'verify-email' ? '<button class="btn subtle auth-secondary" data-auth-action="resend">Resend verification code</button>' : ''}${reset ? '<p class="auth-switch"><a href="#/forgot-password">Request another recovery code</a></p>' : ''}<div class="auth-foot">Secure access. A clearer path forward.<br><a href="#/help">Help center</a> · <a href="#/privacy">Privacy information</a></div></div></section></main>`;
}

function errorMessage(error) {
  if (error.code === 'RATE_LIMITED') return 'Too many attempts. Please wait before trying again.';
  if (error.code === 'ORIGIN_REJECTED') return 'This frontend address is not allowed by the API. Open http://localhost:3000 or check the deployment configuration.';
  return error.message || 'Something went wrong. Please try again.';
}
function showError(error) {
  const alert = document.getElementById('auth-error');
  if (!alert) return;
  alert.textContent = errorMessage(error);
  alert.hidden = false;
  alert.focus();
  if (Array.isArray(error.details)) for (const detail of error.details) {
    const field = document.querySelector(`[data-error="${['legalName','email','phone','password','passwordConfirmation','code'].includes(detail.path) ? detail.path : 'unknown'}"]`);
    if (field) { field.textContent = detail.message; document.getElementById(detail.path)?.setAttribute('aria-invalid', 'true'); }
  }
}
function setBusy(form, value) {
  busy = value;
  form.setAttribute('aria-busy', String(value));
  for (const control of form.querySelectorAll('button, input')) control.disabled = value;
}
async function acceptSession() {
  const principal = await api.me();
  if (!principal.roles?.includes('APPLICANT')) {
    await api.logout();
    throw new Error('This sign-in page is for applicants. Use your role’s portal when it becomes available.');
  }
  user = principal;
  ready = true;
  message = '';
  go(principal.emailVerifiedAt ? 'dashboard' : 'verify-email');
  onChange();
}

export function authGate(route) {
  if (authRoutes.has(route)) return authPage(route);
  if (publicRoutes.has(route)) return null;
  if (!ready) return `<main class="auth"><div class="card card-body"><h1>${bootError ? 'Unable to check your session' : 'Checking your session…'}</h1><p>${escape(bootError || 'Please wait a moment.')}</p>${bootError ? '<button class="btn primary" data-auth-action="retry">Try again</button><a class="btn" href="#/login">Go to sign in</a>' : ''}</div></main>`;
  if (!user) { go('login'); return authPage('login'); }
  if (!user.emailVerifiedAt) { email = user.email; go('verify-email'); return authPage('verify-email'); }
  return null;
}

export async function initializeAuth(callback) {
  onChange = callback;
  const version = ++loadVersion;
  bootError = '';
  try {
    const principal = await api.me();
    if (version !== loadVersion) return;
    user = principal.roles?.includes('APPLICANT') ? principal : null;
    ready = true;
    if (user) email = user.email;
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) { ready = true; user = null; }
    else bootError = errorMessage(error);
  }
  const route = getRoute();
  // Do not replace an auth form while someone is typing during the initial check.
  if (!authRoutes.has(route)) onChange();
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'connected-auth-form') return;
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  email = values.email.trim().toLowerCase();
  values.email = email;
  const route = form.dataset.route;
  document.getElementById('auth-error').hidden = true;
  for (const el of form.querySelectorAll('[data-error]')) el.textContent = '';
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (values.passwordConfirmation !== undefined && values.password !== values.passwordConfirmation) {
    showError(new Error('Passwords must match.')); return;
  }
  setBusy(form, true);
  ++loadVersion; // Prevent a stale startup /me response from overwriting a completed login.
  try {
    if (route === 'login') {
      await api.login({ email, password: values.password });
      await acceptSession();
    } else if (route === 'register' || route === 'signup') {
      const result = await api.register({ legalName: values.legalName.trim(), email, phone: values.phone, password: values.password, passwordConfirmation: values.passwordConfirmation, consentVersion: config.consentVersion });
      message = result.message;
      go('verify-email');
    } else if (route === 'forgot-password') {
      const result = await api.forgot({ email });
      message = result.message;
      go('reset-password');
    } else if (route === 'reset-password') {
      const result = await api.reset({ email, code: values.code, password: values.password, passwordConfirmation: values.passwordConfirmation });
      user = null;
      api.clear();
      message = result.message;
      go('login');
    } else if (route === 'verify-email') {
      await api.verify({ email, code: values.code });
      if (user) { await acceptSession(); }
      else { message = 'Email verified. You can now sign in.'; go('login'); }
    }
  } catch (error) { if (document.contains(form)) showError(error); }
  finally { setBusy(form, false); }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-auth-action]');
  if (!button || busy) return;
  const action = button.dataset.authAction;
  if (action === 'retry') { ready = false; onChange(); await initializeAuth(onChange); return; }
  button.disabled = true;
  busy = true;
  try {
    if (action === 'logout') {
      await api.logout();
      user = null;
      ready = true;
      message = '';
      ++loadVersion;
      go('login');
      onChange();
    } else if (action === 'resend') {
      const field = document.getElementById('email');
      if (!field.reportValidity()) return;
      email = field.value.trim().toLowerCase();
      const result = await api.resend({ email });
      message = result.message;
      onChange();
    }
  } catch (error) {
    if (action === 'logout' && error.status === 401) { user = null; ready = true; go('login'); onChange(); }
    else if (action === 'logout') window.alert(errorMessage(error));
    else showError(error);
  } finally { button.disabled = false; busy = false; }
});

