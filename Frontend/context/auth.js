import { escapeHtml as escape } from '../components/html.js';
import { getRoute, getRouteParams, navigate } from '../hooks/navigation.js';
import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { availableWorkspaces, workspaceUrl } from '../lib/workspaces.js';

const authRoutes = new Set(['login', 'register', 'signup', 'forgot-password', 'reset-password', 'verify-email', 'register/google', 'auth/google/callback']);
const publicRoutes = new Set([...authRoutes, 'privacy', 'help']);
let user = null;
let ready = false;
let bootError = '';
let email = '';
let message = '';
let busy = false;
let onChange = () => {};
let loadVersion = 0;
let pendingGoogle = null;
let googleState = 'loading';
let googleError = '';
let googleLoadVersion = 0;
let googleExpiryTimer;
export const currentUser = () => user;
// Called only with a successful backend profile response; roles stay server-owned.
export function updateProfileIdentity(profile) {
  if (user?.id === profile.id) user = { ...user, legalName: profile.legalName, phone: profile.phone };
}
const go = route => navigate(`/${route}`);

const googleErrors = Object.freeze({
  ACCOUNT_LINK_REQUIRED: 'This email already has an account. Sign in using your password.',
  GOOGLE_FLOW_INVALID: 'Your Google sign-in session has expired or was cancelled. Please start again.',
  ACCOUNT_RESTRICTED: 'This account is restricted. Contact support for help signing in.',
  GOOGLE_CLAIMS_INVALID: 'Google could not provide a verified email address. Try another Google account.',
  SESSION_INVALID: 'Your session has changed. Please start Google sign-in again.',
  GOOGLE_AUTH_FAILED: 'Google sign-in could not be completed. Please try again.',
  GOOGLE_UNAVAILABLE: 'Google sign-in is temporarily unavailable. Please try again later.',
});
const consent = '<label class="check"><input name="consent" type="checkbox" required><span>I have read the <a href="/privacy">privacy notice</a> and consent to processing my application.</span></label>';
const googleButton = '<button type="button" class="btn auth-google" data-auth-action="google"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.8 3-4.4 3-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.9 5.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>Continue with Google</button>';

function googleIdentity() {
  if (googleState !== 'ready' || !pendingGoogle) return '';
  return `<div class="auth-google-identity"><span>Signing up as</span><strong>${escape(pendingGoogle.email)}</strong><span>${escape(pendingGoogle.name)}</span><button type="button" class="auth-account-switch" data-auth-action="google">Use another Google account</button></div>`;
}
function googleStatus() {
  const text = googleState === 'expired'
    ? 'Your signup session expired. Continue with Google to start again.'
    : googleState === 'error' ? googleError : 'Checking your Google signup session…';
  return `<div class="auth-flow" role="status">${escape(text)}</div>${googleState === 'error' ? '<button type="button" class="btn auth-secondary" data-auth-action="google-retry">Try again</button>' : ''}${googleState !== 'loading' ? googleButton : ''}`;
}

// Called on a full page load and whenever the completion route is revisited.
export async function refreshGoogleRegistration() {
  const version = ++googleLoadVersion;
  clearTimeout(googleExpiryTimer);
  pendingGoogle = null;
  googleState = 'loading';
  googleError = '';
  onChange();
  try {
    const identity = await api.googleRegistration();
    if (version !== googleLoadVersion || getRoute() !== 'register/google') return;
    const remaining = Date.parse(identity.expiresAt) - Date.now();
    if (!(remaining > 0)) {
      googleState = 'expired';
    } else {
      pendingGoogle = identity;
      googleState = 'ready';
      googleExpiryTimer = setTimeout(() => {
        pendingGoogle = null;
        googleState = 'expired';
        if (getRoute() === 'register/google') onChange();
      }, remaining);
      googleExpiryTimer.unref?.();
    }
  } catch (error) {
    if (version !== googleLoadVersion || getRoute() !== 'register/google') return;
    if (error.code === 'GOOGLE_FLOW_INVALID') {
      googleState = 'expired';
    } else {
      googleState = 'error';
      googleError = errorMessage(error);
    }
  }
  if (getRoute() === 'register/google') onChange();
}

function input(label, name, type = 'text', attributes = '') {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" aria-describedby="error-${name}" ${name === 'email' ? `value="${escape(email)}" autocomplete="email" maxlength="254"` : ''} ${attributes} required><span id="error-${name}" class="field-error" data-error="${name}"></span></div>`;
}

export function authPage(route) {
  const google = route === 'register/google';
  const callback = route === 'auth/google/callback';
  const flowError = route === 'login' && getRouteParams().get('error');
  const outcomeMessage = flowError ? (Object.hasOwn(googleErrors, flowError) ? googleErrors[flowError] : null) || 'Google sign-in could not be completed. Please try again.' : '';
  const signup = route === 'register' || route === 'signup';
  const login = route === 'login';
  const forgot = route === 'forgot-password';
  const reset = route === 'reset-password';
  const title = google ? (googleState === 'expired' ? 'Let’s start again.' : 'One last step.') : callback ? 'Completing Google sign-in' : signup ? 'Create your account' : login ? 'Welcome back.' : forgot ? 'Forgot your password?' : reset ? 'Set a new password' : 'Verify your email';
  const subtitle = google ? (googleState === 'expired' ? 'Choose your Google account again to continue signing up.' : 'Add your phone number and accept the privacy notice to create your account.') : callback ? 'Checking your secure session before continuing.' : signup ? 'Your next engineering chapter starts here.' : login ? 'Sign in to open your workspace.' : forgot ? 'We’ll email you a recovery code if your account is eligible.' : reset ? 'Enter the six-digit code from your recovery email.' : 'Enter the six-digit code sent to your inbox.';
  return `<main class="auth-layout"><section class="auth-intro"><a class="brand" href="/login"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a><div class="auth-story"><span class="eyebrow">YOUR POTENTIAL. YOUR DIRECTION.</span><h1>Build the skills.<br>Shape your future.</h1><p>Discover where you stand, explore what’s possible, and take the next step with confidence.</p><div class="auth-orbit" aria-hidden="true"><span>N</span></div><div class="auth-values"><span>01 &nbsp; Discover your strengths</span><span>02 &nbsp; Assess your competencies</span><span>03 &nbsp; Grow with a clear plan</span></div></div><small>Engineering a more confident tomorrow.</small></section><section class="auth-panel"><div class="auth-form-wrap"><div class="eyebrow">${signup || google ? 'APPLICANT REGISTRATION' : 'VML NEXUS'}</div><h1>${title}</h1><p>${subtitle}</p>${outcomeMessage || message ? `<div class="notice mt" role="status">${escape(outcomeMessage || message)}</div>` : ''}<div id="auth-error" class="auth-error" role="alert" tabindex="-1" hidden></div>${google ? googleIdentity() : ''}${login || signup ? `${googleButton}<div class="auth-divider"><span>or continue with email</span></div>` : ''}${callback ? `<div class="auth-flow" role="status">${escape(bootError || 'Please wait a moment…')}</div>${bootError ? '<button class="btn primary auth-submit" data-auth-action="retry">Try again</button>' : ''}` : google && googleState !== 'ready' ? googleStatus() : `<form id="connected-auth-form" data-route="${route}">${signup ? input('Full legal name', 'legalName', 'text', 'autocomplete="name" minlength="3" maxlength="150"') : ''}${google ? '' : input('Email address', 'email', 'email')}${signup || google ? input('Phone number', 'phone', 'tel', 'autocomplete="tel" maxlength="32" placeholder="e.g. +254 712 345 678"') : ''}${reset || route === 'verify-email' ? input('Six-digit code', 'code', 'text', 'inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"') : ''}${login || signup || reset ? input(reset ? 'New password' : 'Password', 'password', 'password', `autocomplete="${login ? 'current-password' : 'new-password'}" minlength="${login ? 1 : 8}" maxlength="128"`) : ''}${signup || reset ? `${input('Confirm password', 'passwordConfirmation', 'password', 'autocomplete="new-password" minlength="8" maxlength="128"')}<p class="password-hint">Use 8–128 characters. A longer passphrase is easier to remember.</p>` : ''}${signup || google ? consent : ''}${login ? '<div class="auth-forgot"><a href="/forgot-password">Forgot password?</a></div>' : ''}<button type="submit" class="btn primary auth-submit">${signup || google ? 'Create account' : login ? 'Sign in' : forgot ? 'Send recovery code' : reset ? 'Update password' : 'Verify email'} <span aria-hidden="true">→</span></button></form>`}${login ? '<p class="auth-switch">New to NEXUS? <a href="/signup">Create an account</a></p><p class="auth-switch">Need to verify your email? <a href="/verify-email">Enter verification code</a></p>' : signup ? '<p class="auth-switch">Already have an account? <a href="/login">Sign in</a></p>' : '<p class="auth-switch"><a href="/login">← Back to sign in</a></p>'}${route === 'verify-email' ? '<button class="btn subtle auth-secondary" data-auth-action="resend">Resend verification code</button>' : ''}${reset ? '<p class="auth-switch"><a href="/forgot-password">Request another recovery code</a></p>' : ''}<div class="auth-foot">Secure access. A clearer path forward.<br><a href="/help">Help center</a> · <a href="/privacy">Privacy information</a></div></div></section></main>`;
}

function errorMessage(error) {
  if (Object.hasOwn(googleErrors, error.code)) return googleErrors[error.code];
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
  user = principal;
  ready = true;
  message = '';
  openWorkspace();
  onChange();
}

function openWorkspace() {
  if (!user.emailVerifiedAt) { go('verify-email'); return; }
  const roles = availableWorkspaces(user);
  if (roles.length > 1) go('workspaces');
  else if (roles[0] === 'TRAINER') location.replace(workspaceUrl('TRAINER'));
  else if (roles[0] === 'ADMIN') location.replace(workspaceUrl('ADMIN'));
  else if (roles[0] === 'APPLICANT') go('dashboard');
  else go('workspaces');
}

function workspacePage() {
  const roles = availableWorkspaces(user);
  return `<main class="auth"><section class="card card-body"><h1>${roles.length ? 'Choose your workspace' : 'Workspace access required'}</h1><p>${roles.length ? 'Choose where you want to continue. Administrator access requires MFA.' : 'Your account has no supported workspace. Contact your institution operator.'}</p><div class="inline-actions">${roles.map(role => `<a class="btn primary" href="${escape(workspaceUrl(role))}">${role === 'ADMIN' ? 'Administrator workspace' : role === 'TRAINER' ? 'Trainer workspace' : 'Applicant workspace'}</a>`).join('')}<button type="button" class="btn subtle" data-auth-action="logout">Sign out</button></div></section></main>`;
}

export function authGate(route) {
  if (ready && user && !bootError && ['login', 'auth/google/callback'].includes(route)) {
    openWorkspace();
    return '<main class="auth"><p role="status">Opening your workspace…</p></main>';
  }
  if (route === 'auth/google/callback' && ready && !bootError) {
    if (user) { go(user.emailVerifiedAt ? 'dashboard' : 'verify-email'); }
    else { go('login?error=GOOGLE_FLOW_INVALID'); return authPage('login'); }
    return '<main class="auth"><p role="status">Opening your account…</p></main>';
  }
  if (authRoutes.has(route)) return authPage(route);
  if (publicRoutes.has(route)) return null;
  if (!ready) return `<main class="auth"><div class="card card-body"><h1>${bootError ? 'Unable to check your session' : 'Checking your session…'}</h1><p>${escape(bootError || 'Please wait a moment.')}</p>${bootError ? '<button class="btn primary" data-auth-action="retry">Try again</button><a class="btn" href="/login">Go to sign in</a>' : ''}</div></main>`;
  if (!user) { go('login'); return authPage('login'); }
  if (!user.emailVerifiedAt) { email = user.email; go('verify-email'); return authPage('verify-email'); }
  if (route === 'workspaces') return workspacePage();
  if (!user.roles?.includes('APPLICANT')) { openWorkspace(); return '<main class="auth"><p role="status">Opening your workspace…</p></main>'; }
  return null;
}

export async function initializeAuth(callback) {
  onChange = callback;
  const version = ++loadVersion;
  bootError = '';
  if (getRoute() === 'register/google') { await refreshGoogleRegistration(); ready = true; return; }
  if (getRoute() === 'auth/google/callback') api.clear();
  try {
    const principal = await api.me();
    if (version !== loadVersion) return;
    user = principal;
    ready = true;
    if (user) email = user.email;
  } catch (error) {
    if (version !== loadVersion) return;
    if (error.status === 401) { ready = true; user = null; }
    else bootError = errorMessage(error);
  }
  const route = getRoute();
  // Do not replace an auth form while someone is typing during the initial check.
  if (!authRoutes.has(route) || route === 'auth/google/callback' || (route === 'login' && user)) onChange();
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'connected-auth-form') return;
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  if (values.email !== undefined) {
    email = values.email.trim().toLowerCase();
    values.email = email;
  }
  const route = form.dataset.route;
  document.getElementById('auth-error').hidden = true;
  for (const el of form.querySelectorAll('[data-error]')) el.textContent = '';
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  if (['register', 'signup', 'register/google'].includes(route) && values.consent !== 'on') {
    showError(new Error('Please read and accept the privacy notice to create your account.')); return;
  }
  if (values.passwordConfirmation !== undefined && values.password !== values.passwordConfirmation) {
    showError(new Error('Passwords must match.')); return;
  }
  setBusy(form, true);
  ++loadVersion; // Prevent a stale startup /me response from overwriting a completed login.
  try {
    if (route === 'login') {
      await api.login({ email, password: values.password });
      await acceptSession();
    } else if (route === 'register/google') {
      await api.completeGoogle({ phone: values.phone.trim(), consentVersion: config.consentVersion });
      clearTimeout(googleExpiryTimer);
      pendingGoogle = null;
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
  } catch (error) {
    if (route === 'register/google' && error.code === 'GOOGLE_FLOW_INVALID') {
      clearTimeout(googleExpiryTimer);
      pendingGoogle = null;
      googleState = 'expired';
      onChange();
    } else if (document.contains(form)) showError(error);
  }
  finally { setBusy(form, false); }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-auth-action]');
  if (!button || busy) return;
  const action = button.dataset.authAction;
  if (action === 'google-retry') { await refreshGoogleRegistration(); return; }
  if (action === 'retry') { ready = false; onChange(); await initializeAuth(onChange); return; }
  button.disabled = true;
  busy = true;
  try {
    if (action === 'google') {
      ++googleLoadVersion;
      ++loadVersion;
      clearTimeout(googleExpiryTimer);
      pendingGoogle = null;
      googleState = 'loading';
      api.clear();
      message = '';
      location.assign(api.googleStartUrl());
    } else if (action === 'logout') {
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
