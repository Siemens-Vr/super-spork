import styles from "./careers.module.css";
import type { PageContext } from "../page-context";

function feedback({ careerState: data, escape }: PageContext): string {
  return `${data.error ? `<div class="notice" role="alert">${escape(data.error)}</div>` : ""}${data.notice ? `<div class="notice" role="status">${escape(data.notice)}</div>` : ""}`;
}

function loading(context: PageContext, detail = false): string {
  const { careerState: data, card, escape } = context;
  const error = detail ? data.detailError : data.error;
  return card("Career information", error
    ? `<p role="alert">${escape(error)}</p><button class="btn primary" data-career-action="${detail ? "retry-detail" : "refresh"}">Try again</button>`
    : '<p role="status">Loading career information…</p>');
}

export function explore(context: PageContext): string {
  const { careerState: data, escape, heading, button, badge, icon, card } = context;
  const content = heading("Find your next direction", "Explore the engineering careers where your skills can make an impact.");
  if (data.status !== 'ready') return `<section class="${styles.page}">${content}${loading(context)}</section>`;
  const active = data.activeTarget;
  return `<section class="${styles.page}">${content}${feedback(context)}${active ? `<div class="notice">Current target: <strong>${escape(active.jobRole.title)}</strong> · ${escape(active.status.toLowerCase().replaceAll('_', ' '))}. ${button("Review career target", "target", "subtle")}</div>` : ''}
    <div class="toolbar"><input class="search" id="career-search" aria-label="Search careers" placeholder="Search careers, industries, or interests…"><button class="btn subtle" data-career-action="refresh">Refresh</button></div>
    <div class="tiles" id="career-tiles">${data.items.map((role, i) => {
      const industries = role.industries.filter(link => link.industry.active).map(link => link.industry.name);
      return `<article class="card tile" data-career="${escape([role.title, role.description, ...industries].join(' ').toLowerCase())}"><div class="career-emblem">${icon(i % 2 ? "settings" : "career")}</div>${badge("Engineering")}<h2 class="mt">${escape(role.title)}</h2><p>${escape(role.description)}</p><div class="tags">${industries.slice(0, 2).map(name => badge(escape(name), "grey")).join('')}</div>${button("Explore this career", `career?id=${encodeURIComponent(role.id)}`, "subtle")}</article>`;
    }).join('')}</div>${data.items.length ? '<p id="no-careers" hidden>No careers match your search.</p>' : card('No careers available', '<p>No active careers have been published yet. Please check again later.</p>')}</section>`;
}

export function career(context: PageContext): string {
  const { careerState: data, escape, heading, button, card, badge } = context;
  if (data.status !== 'ready' || data.detailStatus !== 'ready' || !data.detail) return `<section class="${styles.page}">${heading("Career details", "Discover the skills for your next step.")}${loading(context, data.status === 'ready')}</section>`;
  const role = data.detail;
  const frameworkIds = new Set(role.blueprints?.map(blueprint => blueprint.frameworkId));
  const core = data.frameworks.filter(framework => framework.scope === 'CORE' && frameworkIds.has(framework.id));
  const competencies = [...new Map(core.flatMap(framework => framework.competencies.map(link => [link.competency.id, link.competency] as const))).values()];
  const href = `target?career=${encodeURIComponent(role.id)}`;
  const locked = data.activeTarget && data.activeTarget.status !== 'DRAFT';
  return `<section class="${styles.page}">${heading(escape(role.title), "A career at the intersection of engineering and innovation.", button(locked ? "Review current target" : "Choose this career", locked ? 'target' : href))}${feedback(context)}
    <div class="grid">${card("What you’ll do", `<p>${escape(role.description)}</p><h3 class="mt">Competencies you can assess</h3>${competencies.length ? competencies.map((skill, i) => `<div class="document-row" style="padding:16px 0"><span class="step-number">${i + 1}</span><div><h3>${escape(skill.name)}</h3><p>${escape(skill.description)}</p></div>${badge("Core")}</div>`).join('') : '<p>No approved core competencies are available for assessment yet.</p>'}`)}${card("Shape your assessment", `<p>Choose related industries and optional companies to add context to your assessment.</p><div class="detail-list"><div><span>Career targets</span><strong>One at a time</strong></div><div><span>Industries</span><strong>Choose 1–3</strong></div><div><span>Companies</span><strong>Optional, up to 3</strong></div></div><div class="notice">${locked ? 'Your current target is locked. Complete or appropriately abandon it before choosing another career.' : 'Company preferences provide context. They do not represent job offers or employer partnerships.'}</div>${button(locked ? "Review current target" : "Build my target", locked ? 'target' : href)}`)}</div></section>`;
}

function targetRecovery({ careerState: data, escape, card, button }: PageContext): string {
  const active = data.activeTarget;
  if (active?.status === 'IN_PROGRESS') return card('Need to change your career target?', `<p>Your assessment has started. Contact your assessment provider or an administrator to recover it before choosing another target. Your saved assessment evidence will be preserved.</p>${button('Help center', 'help', 'subtle')}`);
  if (active?.status !== 'PREPARED') return '';
  const disabled = data.busy || data.uncertain;
  const open = data.recoveryTargetId === active.id;
  return card('Change your career target', `<p>To choose a different career or change your locked choices, abandon the prepared target for <strong>${escape(active.jobRole.title)}</strong> first.</p>${open ? `
    <form id="target-recovery-form" aria-busy="${data.busy}"><p class="notice">Abandoning this target cancels its scheduled bookings and releases your current choices. Your target and booking history are preserved. You will need to prepare a new target and book again. Started assessments and bookings past their cancellation deadline require help from your assessment provider.</p>
    <fieldset class="${styles.fields}" ${disabled ? 'disabled' : ''}><div class="field"><label for="target-recovery-reason">Reason for changing your target</label><textarea id="target-recovery-reason" name="reason" required minlength="5" maxlength="1000">${escape(data.recoveryReason)}</textarea></div>
    <label class="check"><input type="checkbox" name="confirm" required><span>I understand that this abandons my target and cancels any scheduled bookings for it.</span></label>
    <div class="inline-actions"><button type="submit" class="btn primary">${data.busy ? 'Abandoning…' : 'Abandon target and choose again'}</button><button type="button" class="btn subtle" data-career-action="cancel-recovery">Keep current target</button></div></fieldset></form>` : `<button type="button" class="btn subtle" data-career-action="begin-recovery" ${disabled ? 'disabled' : ''}>Change career target</button>`}`);
}

export function target(context: PageContext): string {
  const { careerState: data, escape, heading, button, card } = context;
  const title = heading("Build your career target", "Make your assessment relevant to where you want to go.");
  if (data.status !== 'ready') return `<section class="${styles.page}">${title}${loading(context)}</section>`;
  const recovery = targetRecovery(context);
  const messages = feedback(context) + (data.uncertain ? '<button class="btn subtle" data-career-action="refresh">Refresh career information</button>' : '');
  if (!data.selectedId) return `<section class="${styles.page}">${title}${messages}${card("Choose your career", `<p>Explore the available careers to build your assessment target.</p>${button("Explore careers", "careers")}`)}${recovery}</section>`;
  if (data.detailStatus !== 'ready' || !data.detail || !data.draft) return `<section class="${styles.page}">${title}${messages}${loading(context, true)}${recovery}</section>`;
  const role = data.detail, draft = data.draft, active = data.activeTarget;
  const locked = !!active && active.status !== 'DRAFT';
  const disabled = locked || data.busy || data.uncertain;
  const industries = locked ? active!.industries : role.industries.filter(link => link.industry.active);
  const companies = data.companies.filter(company => company.industries.some(link => draft.industryIds.includes(link.industryId)));
  const blueprints = (role.blueprints || []).filter(blueprint => blueprint.active && data.frameworks.some(framework => framework.id === blueprint.frameworkId && framework.scope === 'CORE'));
  const options = (items: { id: string; label: string }[]) => items.map(item => `<option value="${escape(item.id)}">${escape(item.label)}</option>`).join('');
  const chosen = (field: string, items: { id: string; label: string }[]) => `<div class="tags">${items.map(item => `<span class="badge grey">${escape(item.label)}${!disabled ? `<button type="button" class="${styles.remove}" data-career-action="remove" data-field="${field}" data-value="${escape(item.id)}" aria-label="Remove ${escape(item.label)}">×</button>` : ''}</span>`).join('')}</div>`;
  const selectedCompanies = draft.companyIds.map(id => ({ id, label: data.companies.find(company => company.id === id)?.name || active?.companies.find(link => link.companyId === id)?.company.name || 'Unavailable company' }));
  const selectedQualifications = draft.qualificationIds.map(id => {
    const doc = data.qualifications.find(doc => doc.id === id) || active?.qualifications.find(link => link.documentId === id)?.document;
    return { id, label: doc?.courseName || doc?.certificationName || doc?.title || 'Unavailable qualification' };
  });
  return `<section class="${styles.page}">${title}${messages}${card("Your assessment context", `
    <form id="target-form" aria-busy="${data.busy}"><div class="notice">${locked ? active?.status === 'IN_PROGRESS' ? 'Your assessment has started. Its choices are locked.' : 'Your target is prepared. Its choices are locked.' : 'Review your choices carefully. Preparing your target freezes the career, qualifications, and assessment rubric.'}</div>
    <fieldset class="${styles.fields}" ${disabled ? 'disabled' : ''}><div class="field"><label for="target-career">Selected career</label><input id="target-career" value="${escape(role.title)}" readonly></div>
    <h3>Related industries · select 1–3</h3>${industries.map(link => `<label class="check"><input type="checkbox" name="industryIds" value="${escape(link.industry.id)}" ${draft.industryIds.includes(link.industry.id) ? 'checked' : ''} ${!draft.industryIds.includes(link.industry.id) && draft.industryIds.length >= 3 ? 'disabled' : ''}>${escape(link.industry.name)}</label>`).join('') || '<p>No active industries are linked to this career.</p>'}
    <div class="form-grid mt"><div class="field"><label for="company">Company preference (optional, up to 3)</label><select id="company" data-career-field="companyIds" ${draft.companyIds.length >= 3 ? 'disabled' : ''}><option value="">${draft.companyIds.length ? 'Add another company' : 'No preference'}</option>${options(companies.filter(company => !draft.companyIds.includes(company.id)).map(company => ({ id: company.id, label: company.name })))}</select>${chosen('companyIds', selectedCompanies)}<p>Companies must operate in a selected industry.</p></div>
    <div class="field"><label for="qualification">Qualification (optional, up to 10)</label><select id="qualification" data-career-field="qualificationIds" ${draft.qualificationIds.length >= 10 ? 'disabled' : ''}><option value="">${draft.qualificationIds.length ? 'Add another qualification' : 'Profile discipline only'}</option>${options(data.qualifications.filter(doc => !draft.qualificationIds.includes(doc.id)).map(doc => ({ id: doc.id, label: doc.courseName || doc.certificationName || doc.title })))}</select>${chosen('qualificationIds', selectedQualifications)}<p>Only current, clean, non-rejected qualifications can be selected. Without a selected qualification, complete your discipline in My profile.</p></div></div>
    <div class="field"><label for="blueprint">Assessment</label><select id="blueprint" data-career-field="blueprintId" required>${blueprints.length ? blueprints.map(blueprint => `<option value="${escape(blueprint.id)}" ${draft.blueprintId === blueprint.id ? 'selected' : ''}>${escape(blueprint.title)} · ${blueprint.durationMinutes} minutes</option>`).join('') : '<option value="">No approved assessment is available yet</option>'}</select></div>
    <label class="check"><input type="checkbox" name="confirm" required ${locked ? 'checked' : ''}>I understand that preparing this target locks my choices.</label></fieldset>
    ${locked ? button("Continue to booking", "booking") : `<button class="btn primary" ${disabled || !blueprints.length || !industries.length ? 'disabled' : ''}>${data.busy ? 'Preparing…' : 'Prepare my target'}</button>`}</form>` )}${recovery}</section>`;
}
