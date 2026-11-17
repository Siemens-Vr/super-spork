import './admin.css';
import { sharedLoginUrl, workspaceUrl } from '../../lib/workspaces.js';
import { getRoute, getRouteParams, navigate, initializeNavigation } from '../../hooks/navigation.js';
import { createAdminApi } from './api.js';
import { createAdminStore, recoveryCodeFile } from './store.js';
import { authView, shell, pageView, accountStatusDialog, previewDialog, previewContent, availabilityCalendar, availabilityDialog, publishAvailabilityDialog } from './views.js';

import { calendarDay } from './availability-calendar.js';

const calendarFilters = {};
const app = document.getElementById('app');
const mobile = window.matchMedia('(max-width:760px)');
let menuOpen = false, menuOverflow = '', dialog = null, dialogTrigger = null, dialogVersion = 0, dialogOverflow = '';
let previewUrl = null;
const downloads = new Set();
const client = createAdminApi();
const store = createAdminStore({ client, onChange(reason) {
  if (reason === 'auth-state' || reason === 'mutation-state') { updateForms(); return; }
  if (reason === 'auth') { closeDialog(false); closeMenu(false); clearDownloads(); }
  render();
} });

function locationInfo() {
  const route = getRoute(), params = getRouteParams();
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  let filters = {};
  if (route === 'availability') filters = {};
  if (route === 'assessment-reviews') filters = { page, limit: 20, status: params.get('status') ?? 'AWAITING_REVIEW' };
  if (route === 'assessment-review') filters = { id: params.get('id') || '' };
  if (route === 'bookings') filters = { page, limit: 20, status: params.get('status') || '', applicantId: params.get('applicantId') || '' };
  if(route==='trainers')filters={page,limit:20,search:params.get('search')||'',status:params.get('status')||''};
  if(route==='trainer-invitations')filters={page,limit:20};
  if(route==='trainer')filters={id:params.get('id')||''};
  if (route === 'applicants') filters = { page, limit: 20, search: params.get('search') || '', status: params.get('status') || '' };
  if (route === 'documents' || route === 'identity') filters = { page, limit: 20, status: params.get('status') || '', identity: route === 'identity' ? 'true' : params.get('identity') || '', applicantId: params.get('applicantId') || '' };
  if (route === 'applicant' || route === 'document' || route === 'booking') filters = { id: params.get('id') || '' };
  const dataPage = route === 'dashboard' ? 'overview' : route === 'identity' ? 'documents' : route;
  return { route, filters, page: dataPage, key: `${dataPage}:${JSON.stringify(filters)}` };
}
function permitted(route) {
  return !(['trainers','trainer','trainer-invitations'].includes(route)&&!store.can('trainers.manage')) && !(['assessment-reviews', 'assessment-review'].includes(route) && !store.can('assessments.review')) && !(['availability', 'bookings', 'booking'].includes(route) && !store.can('assessments.manage')) && !(['applicants', 'applicant'].includes(route) && !store.can('users.manage')) && !(['documents', 'identity', 'document'].includes(route) && !store.can('documents.review'));
}
function render() {
  const state = store.snapshot(), info = locationInfo();
  if (state.auth === 'login') { location.replace(['forgot-password', 'reset-password'].includes(info.route) ? workspaceUrl('APPLICANT', `/${info.route}`) : sharedLoginUrl()); return; }
  if (state.auth === 'denied' && state.user?.roles?.includes('APPLICANT')) { location.replace(workspaceUrl('APPLICANT')); return; }
  if (state.auth !== 'ready') {
    app.innerHTML = authView(state, info.route);
    document.title = `${state.auth === 'mfa' ? 'Security check' : 'Sign in'} · NEXUS Admin`;
    updateForms(); return;
  }
  if (['login', 'forgot-password', 'reset-password'].includes(info.route)) { navigate('/dashboard'); return; }
  if (!permitted(info.route)) {
    app.innerHTML = shell(state, info.route, '<div class="page-heading"><div><h1 id="page-title" tabindex="-1">Access required</h1><p>Your account does not have permission to open this page.</p></div></div>');
  } else {
    if (state.page !== info.key) void store.load(info.page, info.filters);
    app.innerHTML = shell(store.snapshot(), info.route, pageView(store.snapshot(), info.route, info.route === 'availability' ? calendarFilters : info.filters, store.can));
  }
  document.title = `${{ dashboard: 'Overview', applicants: 'Applicants', applicant: 'Applicant profile', documents: 'Document reviews', identity: 'Identity verification', document: 'Document review', availability: 'Assessment availability', bookings: 'Assessment bookings', booking: 'Assessment booking', 'assessment-reviews': 'Assessment reviews', 'assessment-review': 'Assessment review', settings: 'My account' }[info.route] || 'Workspace'} · NEXUS Admin`;
  configureMenu(); updateReviewFields(); updateForms();
}
function updateCalendar(changes, focusId) {
  Object.assign(calendarFilters, changes);
  const container = document.getElementById('availability-calendar');
  const data = store.snapshot().data;
  if (!container || !data?.windows) return;
  container.innerHTML = availabilityCalendar(data, calendarFilters);
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
function configureMenu() {
  const sidebar = document.getElementById('admin-sidebar');
  if (!sidebar) return;
  const opened = mobile.matches && menuOpen;
  sidebar.classList.toggle('open', opened);
  sidebar.inert = mobile.matches && !opened;
  if (mobile.matches && !opened) sidebar.setAttribute('aria-hidden', 'true'); else sidebar.removeAttribute('aria-hidden');
  if (opened) { sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true'); sidebar.setAttribute('aria-label', 'Workspace navigation'); }
  else { sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); sidebar.removeAttribute('aria-label'); }
  const toggle = document.querySelector('[data-admin-action="menu"]');
  toggle?.setAttribute('aria-expanded', String(opened));
  toggle?.setAttribute('aria-label', opened ? 'Close navigation' : 'Open navigation');
  const backdrop = document.querySelector('.admin-backdrop');
  if (backdrop) backdrop.hidden = !opened;
  const main = document.getElementById('main-content');
  if (main) { main.inert = opened; main.tabIndex = -1; }
}
function openMenu() {
  if (!mobile.matches || menuOpen) return;
  menuOpen = true; menuOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  configureMenu(); document.querySelector('.admin-close-nav')?.focus();
}
function closeMenu(restore = true) {
  if (menuOpen) { menuOpen = false; document.body.style.overflow = menuOverflow; }
  configureMenu();
  if (restore && mobile.matches) document.querySelector('[data-admin-action="menu"]')?.focus();
}
function clearDownloads() { for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); }
function closeDialog(restore = true) {
  dialogVersion++;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  if (!dialog) return;
  dialog.close(); dialog.remove(); dialog = null;
  document.body.style.overflow = dialogOverflow;
  if (restore) {
    if (dialogTrigger?.isConnected) dialogTrigger.focus();
    else document.getElementById('page-title')?.focus();
  }
}
function openDialog(markup, trigger) {
  closeMenu(false); closeDialog(false);
  const wrapper = document.createElement('div'); wrapper.innerHTML = markup;
  dialog = wrapper.firstElementChild; dialogTrigger = trigger;
  document.body.append(dialog);
  dialogOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });
  dialog.showModal();
}
function updateForms() {
  const state = store.snapshot();
  if (!state.notice) for (const notice of document.querySelectorAll('.admin-success')) notice.remove();
  for (const fieldset of document.querySelectorAll('[data-admin-form] fieldset')) fieldset.disabled = state.busy;
  for (const button of document.querySelectorAll('[data-admin-action="setup"], [data-admin-action="logout"], [data-admin-action="email-send"], [data-admin-action="mfa-email"], [data-admin-action="mfa-authenticator"]')) button.disabled = state.busy;
  const authError = document.getElementById('admin-auth-error');
  if (authError) { authError.hidden = !state.authError; authError.textContent = state.authError; }
  const error = dialog?.querySelector('#admin-dialog-error') || document.getElementById('admin-error');
  if (error) {
    const changed = error.textContent !== state.error;
    error.hidden = !state.error; error.textContent = state.error;
    if (changed && state.error && !state.busy) error.focus();
  }
  for (const field of document.querySelectorAll('[data-field-error]')) {
    const message = state.fieldErrors[field.dataset.fieldError] || '';
    field.textContent = message;
    const input = field.closest('form')?.elements.namedItem(field.dataset.fieldError) || document.getElementById(field.dataset.fieldError);
    if (message) input?.setAttribute('aria-invalid', 'true'); else input?.removeAttribute('aria-invalid');
  }
  for (const form of document.querySelectorAll('[data-admin-form]')) {
    form.setAttribute('aria-busy', String(state.busy));
    const button = form.querySelector('[data-submit-label]');
    if (button) button.textContent = state.busy ? 'Please wait…' : button.dataset.submitLabel;
  }
  if (state.authError && !state.busy && authError) authError.focus();
}
function updateReviewFields() {
  const form = document.querySelector('[data-admin-form="review"]');
  if (!form) return;
  const authenticated = form.elements.outcome.value === 'AUTHENTICATED';
  form.elements.evidenceReference.required = authenticated;
  form.elements.evidenceReference.setAttribute('aria-describedby', 'evidence-help error-evidenceReference');
  const ai = form.elements.method.querySelector('option[value="AI_ASSISTED"]');
  ai.disabled = authenticated;
  if (authenticated && form.elements.method.value === 'AI_ASSISTED') form.elements.method.value = 'MANUAL';
}
async function refresh() {
  if (store.snapshot().busy) return;
  const info = locationInfo();
  closeDialog(); await store.load(info.page, info.filters, true);
}
async function download(button) {
  const doc = store.snapshot().data?.document;
  if (!doc || doc.scanStatus !== 'CLEAN') return;
  const version = dialogVersion, owner = store.snapshot().user?.id, context = locationInfo().key, inDialog = !!dialog;
  const error = dialog?.querySelector('#admin-dialog-error') || document.getElementById('admin-error');
  if (error) { error.hidden = true; error.textContent = ''; }
  button.disabled = true;
  try {
    const result = await store.download(doc.id);
    if (!result || owner !== store.snapshot().user?.id || context !== locationInfo().key || (inDialog && version !== dialogVersion)) return;
    const url = URL.createObjectURL(result.blob); downloads.add(url);
    const anchor = document.createElement('a'); anchor.href = url;
    anchor.download = `document-${doc.id}.${result.blob.type === 'application/pdf' ? 'pdf' : result.blob.type === 'image/png' ? 'png' : 'jpg'}`;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
  } catch (failure) {
    if (error?.isConnected) { error.hidden = false; error.textContent = failure.message || 'Unable to download this file. Try again.'; error.focus(); }
  } finally { if (button.isConnected) button.disabled = false; }
}
async function preview(trigger) {
  const doc = store.snapshot().data?.document;
  if (!doc || doc.scanStatus !== 'CLEAN') return;
  openDialog(previewDialog(doc.title), trigger);
  const version = dialogVersion;
  try {
    const result = await store.download(doc.id);
    if (!result || version !== dialogVersion || !dialog?.open) return;
    previewUrl = URL.createObjectURL(result.blob);
    document.getElementById('admin-preview-content').innerHTML = previewContent(previewUrl, result.blob.type, doc.title, navigator.pdfViewerEnabled !== false);
  } catch (error) {
    if (version !== dialogVersion || !dialog?.open) return;
    const alert = dialog.querySelector('#admin-dialog-error'); alert.textContent = error.message || 'Unable to load this file.'; alert.hidden = false; alert.focus();
    document.getElementById('admin-preview-content').innerHTML = '<button type="button" class="btn subtle" data-admin-action="preview">Try again</button>';
  }
}

async function downloadTrainer(control){
  const owner=store.snapshot().user?.id;control.disabled=true;
  try{const file=await client.trainerDownload(control.dataset.id);if(store.snapshot().user?.id!==owner||store.snapshot().auth!=='ready')return;const url=URL.createObjectURL(file.blob);downloads.add(url);const link=document.createElement('a');link.href=url;link.download=`trainer-qualification-${control.dataset.id}.${file.blob.type==='application/pdf'?'pdf':file.blob.type==='image/png'?'png':'jpg'}`;link.click();setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);}catch(error){if(store.snapshot().user?.id!==owner)return;const region=document.getElementById('admin-error');if(region){region.textContent=error.message;region.hidden=false;region.focus();}if(error.status===401||error.code==='MFA_REQUIRED')await store.boot();}finally{control.disabled=false;}}
document.addEventListener('click', event => {
  if (event.target.closest('.admin-skip')) {
    event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView(); return;
  }
  const control = event.target.closest('[data-admin-action]');
  if (!control || control.disabled) return;
  event.preventDefault();
  const action = control.dataset.adminAction;
  if (action === 'skip') { const main = document.getElementById('main-content'); main.focus(); main.scrollIntoView(); }
  if (action === 'menu') menuOpen ? closeMenu() : openMenu();
  if (action === 'close-menu') closeMenu();
  if (action === 'close-dialog') closeDialog();
  if (action === 'boot') void store.boot();
  if (action === 'logout') void store.logout();
  if (action === 'setup') void store.authAction('setup');
  if (action === 'mfa-email') store.setMfaMethod('email');
  if (action === 'mfa-authenticator') store.setMfaMethod('authenticator');
  if (action === 'email-send') void store.authAction('email-send');
  if (action === 'recovery-download' && store.snapshot().setup?.recoveryCodes) {
    const url = URL.createObjectURL(new Blob([recoveryCodeFile(store.snapshot().setup.recoveryCodes)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'nexus-admin-recovery-codes.txt';
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (action === 'refresh') void refresh();
  if (action === 'calendar-month') updateCalendar({ month: control.dataset.month, day: '' }, 'calendar-month');
  if (action === 'calendar-day') updateCalendar({ day: control.dataset.day }, 'calendar-day-title');
  if (action === 'calendar-today') { const day = calendarDay(new Date()); updateCalendar({ month: day.slice(0, 7), day }, 'calendar-month'); }
  if (action === 'publish-availability-dialog' && !store.snapshot().busy && store.can('assessments.manage')) {
    const blueprints = store.snapshot().data?.blueprints;
    if (blueprints) openDialog(publishAvailabilityDialog(blueprints), control);
  }
  if (action === 'availability-details' && !store.snapshot().busy) {
    const data = store.snapshot().data, window = data?.windows?.data.find(item => item.id === control.dataset.id);
    if (window) openDialog(availabilityDialog(window, data.blueprints), control);
  }
  if (action === 'account-status' && store.snapshot().data?.id && !store.snapshot().busy) openDialog(accountStatusDialog(store.snapshot().data), control);
  if (action === 'preview') void preview(control);
  if(action==='trainer-download')void downloadTrainer(control);
  if (action === 'download') void download(control);
});
document.addEventListener('change', event => { if (event.target.name === 'outcome') updateReviewFields(); });
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-admin-form]');
  if (!form) return;
  event.preventDefault();
  if (store.snapshot().busy) return;
  const values = Object.fromEntries(new FormData(form)), action = form.dataset.adminForm;
  if (action === 'calendar-filters') {
    updateCalendar({ career: values.career, blueprint: values.blueprint, active: values.calendarActive });
    document.querySelector('[data-admin-form="calendar-filters"] button')?.focus({ preventScroll: true });
    return;
  }
  if (action === 'trainer-filters' || action === 'applicant-filters' || action === 'document-filters' || action === 'booking-filters' || action === 'assessment-review-filters') {
    const route = locationInfo().route, params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (String(value).trim() || action === 'assessment-review-filters') params.set(key, String(value).trim());
    navigate(`/${route}${params.size ? `?${params}` : ''}`);
    return;
  }
  if (['login', 'mfa', 'reauthenticate', 'forgot', 'reset'].includes(action)) {
    if (action === 'reauthenticate') values.password = values['reauth-password'];
    const saved = await store.authAction(action, values);
    if (saved && action === 'forgot') navigate('/reset-password');
    if (saved && action === 'reset') navigate('/login');
    return;
  }
  if (['invite-trainer','revoke-trainer-invitation','review-trainer','status', 'review', 'evidence', 'approve-assessment', 'publish-availability', 'update-availability', 'cancel-booking'].includes(action)) {
    const info = locationInfo(), id = form.dataset.id;
    const saved = await store.mutate(action, id, values);
    if (saved) {
      if (action === 'status' || action === 'update-availability' || action === 'publish-availability') closeDialog(false);
      if (locationInfo().key === info.key) { await store.load(info.page, info.filters, true); document.getElementById('page-title')?.focus(); }
    }
  }
});
document.addEventListener('keydown', event => {
  if (!menuOpen || !mobile.matches) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); }
  if (event.key === 'Tab') {
    const controls = [...document.querySelectorAll('#admin-sidebar a, #admin-sidebar button:not(:disabled)')].filter(control => control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
mobile.addEventListener('change', () => { closeMenu(false); });
window.addEventListener('app:navigate', () => {
  closeMenu(false); closeDialog(false); clearDownloads(); store.clearNotice();
  const info = locationInfo();
  if (store.snapshot().auth === 'ready' && permitted(info.route)) void store.load(info.page, info.filters, true);
  render(); window.scrollTo(0, 0);
});
window.addEventListener('pagehide', () => { closeDialog(false); clearDownloads(); });
initializeNavigation(); render(); void store.boot();
