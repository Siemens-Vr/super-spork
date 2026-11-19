import { dashboardLayout } from '../../components/dashboard-layout/dashboard-layout.tsx';
import { escapeHtml as e } from '../../components/html.js';
import { initializeNavigation, getRoute } from '../../hooks/navigation.js';
import { api } from '../../lib/api.js';
import { sharedLoginUrl } from '../../lib/workspaces.js';
import './employer.css';

const app = document.getElementById('app');
const links = [['candidates', 'Find candidates', 'users'], ['requests', 'Profile requests', 'file']];
let principal, route, search = '', roleId = '', roles = [], rolePage = 1, requestPage = 1;
let candidates, requests, details, error = '', notice = '', busy = false, generation = 0;
const pageButtons = (page, more) => `<div class="inline-actions">
  <button class="btn subtle" data-employer="previous" ${page <= 1 ? 'disabled' : ''}>Previous</button>
  <span>Page ${page}</span><button class="btn subtle" data-employer="next" ${!more ? 'disabled' : ''}>Next</button>
</div>`;

function candidateView() {
  return `<section class="card card-body employer-filters">
    <form data-employer-form="search"><label>Search engineering and technical roles
      <input class="search" name="search" value="${e(search)}" maxlength="100" placeholder="e.g. Mechatronics"></label>
      <button class="btn subtle">Search</button></form>
    <form data-employer-form="role"><label>Job role <select name="roleId" required><option value="">${roles.length ? 'Select a role' : 'No matching roles'}</option>
      ${roles.map(role => `<option value="${e(role.id)}" ${roleId === role.id ? 'selected' : ''}>${e(role.title)}</option>`).join('')}
    </select></label><button class="btn primary" ${roles.length ? '' : 'disabled'}>Find candidates</button></form>
  </section>
  ${candidates ? `<div class="employer-results">${candidates.rows.map(row => `<article class="card card-body">
    <h2>${e(row.initials)}</h2><p>${e(row.assessmentStatus)}</p>
    <h3>Verified skills</h3><ul>${row.verifiedSkills.map(skill => `<li>${e(skill)}</li>`).join('')}</ul>
    <button class="btn subtle" data-employer="request" data-id="${e(row.reference)}">Request full profile</button>
  </article>`).join('') || '<p>No qualified candidates match this role yet.</p>'}</div>${pageButtons(candidates.page, candidates.hasMore)}` : ''}`;
}

function requestView() {
  return `<p>The platform releases profiles after an administrator confirms payment or procurement.</p>
    ${requests ? `<div class="employer-results">${requests.rows.map(row => `<article class="card card-body">
      <h2>${e(row.initials)}</h2><p>${e(row.role)}</p>
      ${row.approved ? `<button class="btn primary" data-employer="details" data-id="${e(row.id)}">View full profile</button>` : '<p>Awaiting procurement confirmation</p>'}
    </article>`).join('') || '<p>No profile requests yet.</p>'}</div>${pageButtons(requests.page, requests.hasMore)}` : ''}
    ${details ? fullProfile(details) : ''}`;
}

function fullProfile(candidate) {
  const labels = {
    country: 'Country', region: 'Region', educationLevel: 'Education level', institution: 'Institution',
    discipline: 'Discipline', professionalStatus: 'Professional status', graduationYear: 'Graduation year', summary: 'Summary',
  };
  const fields = [['Email', candidate.email], ['Phone', candidate.phone],
    ...Object.entries(candidate.profile || {}).map(([key, value]) => [labels[key], value])];
  return `<section id="released-profile" class="card card-body" tabindex="-1">
    <h2>${e(candidate.legalName)}</h2><p>${e(candidate.assessmentStatus)}</p>
    <dl>${fields.filter(([label, value]) => label && value).map(([label, value]) => `<dt>${e(label)}</dt><dd>${e(value)}</dd>`).join('')}</dl>
    <p><strong>Verified skills</strong> ${e(candidate.verifiedSkills.join(', '))}</p>
    <button class="btn subtle" data-employer="hide">Close profile</button>
  </section>`;
}

function render() {
  if (!principal) {
    app.innerHTML = `<main class="auth"><section class="card card-body"><h1>Employer workspace</h1>
      <p role="status">${e(error || 'Checking your session…')}</p>
      <a class="btn primary" href="${e(sharedLoginUrl())}">Go to sign in</a>
    </section></main>`;
    return;
  }
  const title = route === 'requests' ? 'Profile requests' : route === 'settings' ? 'Account settings' : 'Find candidates';
  const content = route === 'requests' ? requestView() : route === 'settings'
    ? `<section class="card card-body"><h2>${e(principal.legalName)}</h2><p>${e(principal.email)}</p></section>`
    : candidateView();
  app.innerHTML = dashboardLayout({ role: 'employer', links, route, title, name: principal.legalName,
    body: `<div class="page-heading"><h1>${title}</h1></div>
      ${error ? `<p class="notice" role="alert">${e(error)}</p>` : ''}
      ${notice || busy ? `<p class="notice" role="status">${e(notice || 'Working…')}</p>` : ''}
      <fieldset class="employer-content" ${busy ? 'disabled' : ''}>${content}</fieldset>`,
  });
}

async function perform(task, { navigate = false } = {}) {
  if (busy && !navigate) return;
  const version = ++generation;
  busy = true;
  error = ''; notice = '';
  render();
  try {
    const user = await api.me();
    if (version !== generation) return;
    if (!user.roles.includes('EMPLOYER') || !user.emailVerifiedAt) {
      principal = null;
      error = 'An administrator must grant employer access to your verified account.';
      return;
    }
    if (principal && principal.id !== user.id) {
      location.reload();
      return;
    }
    principal = user;
    await task(version);
  } catch (failure) {
    if (version !== generation) return;
    if (failure.status === 401) {
      principal = null;
      location.replace(sharedLoginUrl());
      return;
    }
    error = failure.message;
  } finally {
    if (version === generation) {
      busy = false;
      render();
      if (details) document.getElementById('released-profile')?.focus();
    }
  }
}

async function loadRoles(version) {
  const rows = await api.request('/employer/roles?' + new URLSearchParams({ search }));
  if (version === generation) roles = rows;
}

async function loadCandidates(version) {
  const rows = await api.request('/employer/candidates?' + new URLSearchParams({ roleId, page: rolePage }));
  if (version === generation) candidates = rows;
}

async function loadRequests(version) {
  const rows = await api.request('/employer/requests?' + new URLSearchParams({ page: requestPage }));
  if (version === generation) requests = rows;
}

function boot() {
  route = getRoute();
  if (route === 'dashboard') route = 'candidates';
  details = null;
  void perform(async version => {
    if (route === 'requests') await loadRequests(version);
    if (route === 'candidates') {
      await loadRoles(version);
      if (version === generation && roleId) await loadCandidates(version);
    }
  }, { navigate: true });
}

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-employer-form]');
  if (!form) return;
  event.preventDefault();
  const values = new FormData(form);
  if (form.dataset.employerForm === 'search') {
    search = values.get('search');
    roleId = ''; candidates = null; rolePage = 1;
    void perform(loadRoles);
  } else {
    roleId = values.get('roleId');
    candidates = null; rolePage = 1;
    void perform(loadCandidates);
  }
});

function setMenu(open) {
  document.querySelector('.sidebar')?.classList.toggle('open', open);
  const toggle = document.querySelector('[data-action="menu"]');
  toggle?.setAttribute('aria-expanded', String(open));
  const backdrop = document.querySelector('[data-action="close-menu"]');
  if (backdrop) backdrop.hidden = !open;
  if (open) document.querySelector('.sidebar nav a')?.focus();
  else toggle?.focus();
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.querySelector('.sidebar.open')) setMenu(false);
});

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.action === 'menu') setMenu(!document.querySelector('.sidebar.open'));
  if (button.dataset.action === 'close-menu') setMenu(false);
  if (button.dataset.authAction === 'logout') {
    details = null;
    void perform(async () => { await api.logout(); location.replace(sharedLoginUrl()); }, { navigate: true });
  }
  if (busy) return;
  const action = button.dataset.employer;
  const id = encodeURIComponent(button.dataset.id || '');
  if (action === 'request') void perform(async version => {
    await api.request('/employer/requests', { method: 'POST', body: { reference: button.dataset.id } });
    if (version === generation) notice = 'Profile request submitted. Track it under Profile requests.';
  });
  if (action === 'details') void perform(async version => {
    const profile = await api.request(`/employer/requests/${id}/details`);
    if (version === generation) details = profile;
  });
  if (action === 'hide') { details = null; render(); }
  if (action === 'previous' || action === 'next') {
    const change = action === 'next' ? 1 : -1;
    details = null;
    if (route === 'requests') { requestPage += change; void perform(loadRequests); }
    else { rolePage += change; void perform(loadCandidates); }
  }
});
window.addEventListener('app:navigate', boot);
window.addEventListener('pagehide', () => { generation++; principal = null; candidates = null; requests = null; details = null; app.innerHTML = ''; });
window.addEventListener('pageshow', event => { if (event.persisted) boot(); });
initializeNavigation();
boot();
