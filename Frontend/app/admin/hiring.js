import { escapeHtml as e } from '../../components/html.js';

const date = value => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi',
}).format(new Date(value));
const local = value => value ? new Date(Date.parse(value) + 10800000).toISOString().slice(0, 16) : '';
const stages = { READY: 'Ready to schedule', SCHEDULED: 'Scheduled', RECORDED: 'Outcomes recorded' };

export function createHiringWorkspace({ client, onChange, onAuthError }) {
  let owner, permissions = [], generation = 0, section, page, stage, data, error, notice, busy = false;
  const allowed = () => ({
    interviews: permissions.includes('assessments.review'),
    requests: permissions.includes('users.manage'),
  });

  function reset() {
    generation++;
    owner = null; permissions = []; section = ''; page = 1; stage = 'READY';
    data = null; error = ''; notice = ''; busy = false;
  }
  reset();

  async function fetchPage(version) {
    const query = new URLSearchParams({ page });
    if (section === 'interviews') query.set('stage', stage);
    const result = await client.request('/admin/hiring/' + section + '?' + query);
    if (version === generation) data = result;
  }

  async function run(path, method, body) {
    if (!owner || busy) return;
    const version = generation;
    error = ''; notice = ''; busy = true;
    onChange();
    try {
      const principal = await client.me();
      if (version !== generation) return;
      if (principal.id !== owner) { reset(); onAuthError(); return; }
      if (path) {
        await client.request('/admin/hiring' + path, { method, body });
        if (version !== generation) return;
        notice = 'Changes saved.';
      }
      await fetchPage(version);
      if (version === generation && page > 1 && !data.rows.length) {
        page--;
        await fetchPage(version);
      }
    } catch (failure) {
      if (version !== generation) return;
      error = failure.message;
      if (failure.status === 401 || failure.code === 'MFA_REQUIRED') onAuthError();
    } finally {
      if (version === generation) { busy = false; onChange(); }
    }
  }

  function ensure(id, granted) {
    if (owner === id) return;
    reset();
    owner = id; permissions = granted;
    section = allowed().interviews ? 'interviews' : 'requests';
    queueMicrotask(() => void run());
  }

  function interviewRow(attempt) {
    const { mockInterview, target, id } = attempt;
    return `<article class="card card-body training-section">
      <h3>${e(target.applicant.legalName)}</h3><p>${e(target.jobRole.title)}</p>
      ${mockInterview ? `<p>Scheduled for ${date(mockInterview.scheduledAt)} EAT</p>` : ''}
      ${mockInterview?.outcome ? `<p>${mockInterview.outcome === 'PASSED' ? 'Passed' : 'Failed'}</p>` : `
        <form data-hiring-form="schedule" data-id="${e(id)}">
          <fieldset ${busy ? 'disabled' : ''}>
            <label>Interview time (EAT) <input type="datetime-local" name="scheduledAt" required value="${e(local(mockInterview?.scheduledAt))}"></label>
            <label>Joining instructions <textarea name="instructions" required minlength="3" maxlength="1000">${e(mockInterview?.instructions || '')}</textarea></label>
            <button class="btn primary">${mockInterview ? 'Reschedule interview' : 'Schedule interview'}</button>
          </fieldset>
        </form>
        ${mockInterview && Date.parse(mockInterview.scheduledAt) <= Date.now() ? `
          <form data-hiring-form="outcome" data-id="${e(id)}">
            <fieldset ${busy ? 'disabled' : ''}><label>Outcome
              <select name="outcome" required><option value="">Select outcome</option><option value="PASSED">Passed</option><option value="FAILED">Failed</option></select>
            </label><button class="btn subtle">Record outcome</button></fieldset>
          </form>` : ''}
      `}
    </article>`;
  }

  function procurementRow(request) {
    const { employer, interview, id } = request;
    const { applicant, jobRole } = interview.attempt.target;
    return `<article class="card card-body training-section">
      <h3>${e(applicant.legalName)} · ${e(jobRole.title)}</h3>
      <p>Requested by ${e(employer.legalName)} (${e(employer.email)}) on ${date(request.requestedAt)} EAT</p>
      <form data-hiring-form="confirm" data-id="${e(id)}">
        <fieldset ${busy ? 'disabled' : ''}>
          <label>Payment or procurement reference <input name="reference" required minlength="2" maxlength="150"></label>
          <button class="btn primary">Confirm and release profile</button>
        </fieldset>
      </form>
    </article>`;
  }

  function view() {
    const sections = allowed();
    return `<div class="page-heading"><h1 id="page-title">Hiring operations</h1></div>
      <div class="inline-actions">
        ${sections.interviews ? `<button class="btn ${section === 'interviews' ? 'primary' : 'subtle'}" data-hiring="interviews" aria-pressed="${section === 'interviews'}" ${busy ? 'disabled' : ''}>Mock interviews</button>` : ''}
        ${sections.requests ? `<button class="btn ${section === 'requests' ? 'primary' : 'subtle'}" data-hiring="requests" aria-pressed="${section === 'requests'}" ${busy ? 'disabled' : ''}>Employer requests</button>` : ''}
        <button class="btn subtle" data-hiring="refresh" ${busy ? 'disabled' : ''}>Refresh</button>
      </div>
      ${error ? `<p class="notice" role="alert">${e(error)}</p>` : ''}
      ${notice || busy ? `<p class="notice" role="status">${e(notice || 'Loading…')}</p>` : ''}
      ${section === 'interviews' ? `<div class="inline-actions training-section">
        ${Object.entries(stages).map(([key, label]) => `<button class="btn ${stage === key ? 'primary' : 'subtle'}" data-hiring="stage" data-stage="${key}" aria-pressed="${stage === key}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}
      </div>` : `<section class="card card-body training-section">
        <h2>Grant employer access</h2><form data-hiring-form="grant"><fieldset ${busy ? 'disabled' : ''}>
          <label>Verified account email <input type="email" maxlength="254" name="email" required></label>
          <button class="btn subtle">Grant access</button>
        </fieldset></form>
      </section>`}
      ${data ? `${data.rows.map(section === 'interviews' ? interviewRow : procurementRow).join('') || '<p>No items in this queue.</p>'}
        <div class="inline-actions">
          <button class="btn subtle" data-hiring="previous" ${page <= 1 || busy ? 'disabled' : ''}>Previous</button>
          <span>Page ${page}</span><button class="btn subtle" data-hiring="next" ${!data.hasMore || busy ? 'disabled' : ''}>Next</button>
        </div>` : ''}`;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-hiring]');
    if (!button || button.disabled || busy) return;
    const action = button.dataset.hiring;
    if (action === 'interviews' || action === 'requests') { section = action; stage = 'READY'; page = 1; }
    if (action === 'stage') { stage = button.dataset.stage; page = 1; }
    if (action === 'next' || action === 'previous') page += action === 'next' ? 1 : -1;
    data = null;
    void run();
  });
  document.addEventListener('submit', event => {
    const form = event.target.closest('[data-hiring-form]');
    if (!form || busy) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const id = encodeURIComponent(form.dataset.id || '');
    switch (form.dataset.hiringForm) {
      case 'grant': void run('/employers', 'POST', values); break;
      case 'schedule':
        values.scheduledAt = new Date(values.scheduledAt + '+03:00').toISOString();
        void run(`/interviews/${id}`, 'PUT', values);
        break;
      case 'outcome':
        if (confirm('Record this mock interview outcome? A passing outcome qualifies the candidate for the employer shortlist.')) {
          void run(`/interviews/${id}/outcome`, 'POST', values);
        }
        break;
      case 'confirm':
        if (confirm('Confirm procurement and release the full candidate profile to this employer?')) {
          void run(`/requests/${id}/confirm`, 'POST', values);
        }
        break;
    }
  });

  return { ensure, reset, view };
}
