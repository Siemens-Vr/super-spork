import styles from './documents.module.css';
import type { PageContext, ApplicantDocument, DocumentRule, DocumentRequirements } from '../page-context';

const label = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const day = (value?: string | null) => value?.slice(0, 10) || '';
const identity = (category: string) => ['NATIONAL_ID', 'PASSPORT'].includes(category);
const previousIds = (items: ApplicantDocument[]) => {
  const previous = new Set(items.flatMap(doc => [doc.replacesId, ...(doc.isCurrent === false ? [doc.id] : [])]).filter(Boolean));
  items.forEach(doc => { if (doc.qualificationId && previous.has(doc.qualificationId)) previous.add(doc.id); });
  return previous;
};
function documentCategory(doc: ApplicantDocument, { documentState: state }: PageContext): string {
  if (doc.qualificationId) {
    const qualification = state.items.find(item => item.id === doc.qualificationId);
    const transcriptLabels: Record<string, string> = {
      BACHELOR: "Bachelor's degree transcripts",
      MASTER: "Master's degree transcripts",
      PHD: 'PhD transcripts',
      DIPLOMA: 'Diploma transcripts',
    };
    return qualification ? transcriptLabels[qualification.category] || 'Academic transcript' : 'Academic transcript';
  }
  return state.requirements?.categories.find(rule => rule.category === doc.category)?.label || label(doc.category);
}
let institutionFieldId = 0;
function alerts({ documentState: state, escape }: PageContext) {
  return `<div id="document-error" class="${styles.error}" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</div>${state.notice ? `<p class="notice" role="status">${escape(state.notice)}</p>` : ''}`;
}
function loading(context: PageContext) {
  const state = context.documentState;
  if (['idle', 'loading'].includes(state.status)) return context.card('Your documents', '<p role="status">Loading your documents…</p>');
  if (state.status === 'error') return context.card('Unable to load your documents', `<p role="alert">${context.escape(state.error)}</p><button type="button" class="btn subtle" data-document-action="refresh">Try again</button>`);
  return null;
}
function statuses(doc: ApplicantDocument, { badge, escape }: PageContext) {
  const scan = { CLEAN: 'Passed', QUARANTINED: 'Pending', INFECTED: 'Blocked', FAILED: 'Scan failed' }[doc.scanStatus] || label(doc.scanStatus);
  return `<div class="${styles.statuses}"><span>Malware scan ${badge(escape(scan), doc.scanStatus === 'CLEAN' ? 'green' : 'amber')}</span><span>Verification ${badge(escape(label(doc.status)), doc.status === 'AUTHENTICATED' ? 'green' : 'amber')}</span></div>`;
}
function actions(doc: ApplicantDocument, context: PageContext, previous = false) {
  return `<div class="${styles.actions}"><a class="btn subtle" href="/document?id=${encodeURIComponent(doc.id)}">History & details</a><button type="button" class="btn subtle" data-document-action="download" data-document-id="${context.escape(doc.id)}" ${doc.scanStatus === 'CLEAN' ? '' : 'disabled'}>${doc.scanStatus === 'CLEAN' ? 'Download' : 'Download unavailable'}</button>${previous ? '' : `<a class="btn subtle" href="/upload?replace=${encodeURIComponent(doc.id)}">Replace file</a>`}</div>`;
}
function compactRow(doc: ApplicantDocument, context: PageContext, previous = false): string {
  const { escape, badge, icon, documentState: state } = context;
  const category = documentCategory(doc, context);
  const menuId = `document-menu-${doc.id}`;
  const item = (action: string, text: string, disabled = false) => `<button type="button" role="menuitem" data-document-action="${action}" data-document-id="${escape(doc.id)}" ${disabled ? 'disabled' : ''}>${text}</button>`;
  const scan = doc.scanStatus === 'CLEAN' ? '' : ` · ${doc.scanStatus === 'QUARANTINED' ? 'Scan pending' : doc.scanStatus === 'INFECTED' ? 'File blocked' : 'Scan failed'}`;
  return `<div class="document-row ${styles.compactRow}" data-document-row="${escape(doc.id)}"><button type="button" class="file-icon ${styles.previewButton}" data-document-action="preview" data-document-id="${escape(doc.id)}" aria-label="Preview ${escape(doc.title)}" title="Preview document">${icon('file')}</button><div class="${styles.rowInfo}"><h3>${escape(category)}</h3><p>${escape(doc.title)} · Uploaded ${escape(date(doc.createdAt))}${escape(scan)}</p></div><div class="${styles.rowEnd}">${badge(escape(label(doc.status)), doc.status === 'AUTHENTICATED' ? 'green' : 'amber')}<button type="button" class="${styles.moreButton}" aria-label="More actions for ${escape(doc.title)}" aria-haspopup="menu" aria-expanded="false" aria-controls="${escape(menuId)}" data-document-menu="${escape(doc.id)}">⋯</button><div id="${escape(menuId)}" role="menu" aria-label="Actions for ${escape(doc.title)}" class="${styles.menuPanel}" data-document-menu-panel hidden>${item('details', 'Details')}${item('history', 'Verification history')}${!previous ? item('replace', 'Update / replace') : ''}${!previous && ['ADDITIONAL_EVIDENCE_REQUIRED','DISPUTED','REJECTED'].includes(doc.status) ? item('evidence', 'Add evidence') : ''}${item('download', 'Download', doc.scanStatus !== 'CLEAN')}</div></div></div>`;
}
export function documentPage(context: PageContext): string {
  const { documentState: state, escape, heading, card, badge, icon } = context;
  const previous = previousIds(state.items);
  const active = state.items.filter(doc => !previous.has(doc.id));
  const old = state.items.filter(doc => previous.has(doc.id));
  const timeline = [...active].sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)).slice(0, 3).map((doc, index) => `<div class="step ${doc.status === 'AUTHENTICATED' ? 'done' : 'current'}"><span class="step-number">${doc.status === 'AUTHENTICATED' ? icon('check') : index + 1}</span><div><h3>${escape(documentCategory(doc, context))} · ${escape(label(doc.status))}</h3><p>${escape(date(doc.updatedAt || doc.createdAt))} · ${escape(doc.title)}</p></div></div>`).join('');
  const body = loading(context) || `${alerts(context)}<div class="notice">Scan status and human verification are separate. Your original files and review history are preserved when you replace a document.</div><section class="card"><div class="card-head ${styles.listHead}"><h2>Submitted documents</h2><div class="${styles.countActions}">${badge(`${state.summary?.current ?? active.length} document${(state.summary?.current ?? active.length) === 1 ? '' : 's'}`)}<button type="button" class="${styles.refreshButton}" data-document-action="refresh" aria-label="Refresh document status" title="Refresh status" ${state.busy || state.status === 'refreshing' ? 'disabled' : ''}>↻</button></div></div>${active.length ? active.map(doc => compactRow(doc, context)).join('') : '<div class="card-body"><h3>No documents yet</h3><p>Start by uploading your National ID or passport.</p></div>'}</section><div class="grid section">${card('Verification timeline', timeline || '<p>No verification updates yet. Your submitted documents will appear here.</p>')}${card('Need to update a file?', '<p>Submit a replacement when a file or its details have changed. Previous versions stay in your verification history.</p><div class="mt"><button type="button" class="btn subtle" data-document-action="choose-update">Replace / add evidence →</button></div>')}</div>${old.length ? `<details class="card section ${styles.previous}"><summary>Previous versions ${badge(String(old.length))}</summary>${old.map(doc => compactRow(doc, context, true)).join('')}</details>` : ''}`;
  return `<section class="${styles.page}">${heading('My documents', 'Your qualifications, securely in one place.', `<button type="button" class="btn primary" data-document-action="upload" ${!state.requirements || state.busy ? 'disabled' : ''}>${state.busy ? 'Submitting…' : 'Upload a document →'}</button>`) }${body}</section>`;
}
const fieldLabels: Record<string, string> = { title: 'Document name', courseName: 'Course / programme name', certificationName: 'Certification name', issuer: 'Issuing organisation / professional body', institutionName: 'Institution name', issuedAt: 'Issue date', expiresAt: 'Expiry date', credentialNumber: 'Credential number', verificationUrl: 'Official verification URL' };
export function uploadMetadata(rule: DocumentRule | undefined, values: Record<string, unknown>, escape: PageContext['escape']): string {
  if (!rule) return '';
  const academic = ['BACHELOR', 'MASTER', 'PHD', 'DIPLOMA', 'TRANSCRIPT', 'SHORT_COURSE'].includes(rule.category);
  const professional = ['INDUSTRY_CERTIFICATION', 'PROFESSIONAL_REGISTRATION'].includes(rule.category);
  const fields = new Set([
    ...rule.requiredFields.filter(name => !['issuedAt', 'expiresAt'].includes(name)),
    ...(academic || rule.institutionRequired ? ['institutionName'] : []),
    ...(academic || professional ? ['issuedAt'] : []),
    ...(professional ? ['expiresAt'] : []),
    ...(academic || professional ? ['credentialNumber'] : []),
    ...rule.requiredFields,
    'verificationUrl',
  ]);
  return [...fields].map(name => {
    const required = rule.requiredFields.includes(name) || (name === 'institutionName' && rule.institutionRequired);
    if (name === 'institutionName') {
      const manual = !!values.institutionName && !values.institutionId;
      const fieldId = `institution-${++institutionFieldId}`;
      return `<div class="field ${styles.institution}" data-institution-field><label for="${fieldId}">Institution name${required ? '' : ' (optional)'}</label><input id="${fieldId}" name="${manual ? 'institutionName' : 'institutionQuery'}" value="${escape(values.institutionName || values.institutionQuery || '')}" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${fieldId}-results" aria-describedby="${fieldId}-help ${fieldId}-status" autocomplete="off" minlength="2" maxlength="${manual ? 200 : 150}" ${required ? 'required' : ''} data-institution-input data-manual="${manual}"><input type="hidden" name="institutionId" value="${escape(values.institutionId || '')}"><div id="${fieldId}-results" role="listbox" aria-label="Matching institutions" class="${styles.institutionResults}" hidden></div><small id="${fieldId}-help" data-institution-help>${manual ? 'Enter the full institution name.' : 'Type at least 2 characters, then select your institution.'}</small><small id="${fieldId}-status" role="status" aria-live="polite"></small><button type="button" class="${styles.institutionToggle}" data-institution-toggle>${manual ? 'Search listed institutions' : 'Institution not listed? Enter it manually'}</button></div>`;
    }
    const type = ['issuedAt', 'expiresAt'].includes(name) ? 'date' : name === 'verificationUrl' ? 'url' : 'text';
    const value = type === 'date' ? day(values[name] as string) : values[name] || '';
    return `<div class="field"><label for="document-${name}">${fieldLabels[name]}${required ? '' : ' (optional)'}</label><input id="document-${name}" name="${name}" type="${type}" value="${escape(value)}" ${required ? 'required' : ''} ${type === 'text' ? `minlength="${name === 'credentialNumber' ? 1 : 2}" maxlength="${name === 'credentialNumber' ? 150 : 200}"` : ''} ${name === 'verificationUrl' ? 'maxlength="1000" pattern="https://.*" placeholder="https://…"' : ''}></div>`;
  }).join('');
}
export function upload(context: PageContext, inDialog = false): string {
  const { documentState: state, routeParams, escape, heading, card } = context;
  const replacementId = routeParams.get('replace');
  const wait = loading(context);
  if (wait) return `<section class="${styles.page}">${heading('Upload a document', 'Add your qualifications to your career journey.')}${wait}</section>`;
  const replacement = replacementId && state.detail?.id === replacementId ? state.detail : null;
  if (replacementId && (!replacement || state.detailStatus !== 'ready')) return `<section class="${styles.page}">${heading('Replace a document', 'Previous versions and reviews are preserved.')}${card('Document details', state.detailStatus === 'error' ? `<p role="alert">${escape(state.detailError)}</p><button class="btn" data-document-action="detail-retry">Try again</button>` : '<p role="status">Loading the original document…</p>')}</section>`;
  if (replacement && previousIds(state.items).has(replacement.id)) return card('This document has been replaced', '<p>Choose the latest version from My documents.</p><a class="btn" href="/documents">My documents</a>');
  const requirements = state.requirements as DocumentRequirements;
  const hasIdentity = state.items.some(doc => identity(doc.category) && doc.scanStatus !== 'INFECTED' && !previousIds(state.items).has(doc.id));
  const requested = routeParams.get('category');
  const rule = requirements.categories.find(rule => rule.category === (replacement?.category || requested));
  const category = replacement && rule ? `<p>Replacing <strong>${escape(replacement.title)}</strong> (${escape(rule.label)}).</p><input type="hidden" name="category" value="${escape(rule.category)}">` : `<div class="field"><label for="document-category">Document category</label><select id="document-category" name="category" required><option value="" ${!rule ? 'selected' : ''}>Select the category of document you wish to upload</option>${requirements.categories.map(option => `<option value="${escape(option.category)}" ${option.category === rule?.category ? 'selected' : ''}>${escape(option.label)}</option>`).join('')}</select></div>`;
  const body = `${alerts(context)}${!hasIdentity ? '<div class="notice">Start with a National ID or passport. Academic uploads require an identity submission first.</div>' : ''}<form id="upload-form" data-replaces-id="${escape(replacementId || '')}" aria-busy="${state.busy}"><fieldset id="document-upload-fields" class="${styles.fields}" ${state.busy ? 'disabled' : ''}>${category}<div class="form-grid" id="document-metadata">${uploadMetadata(rule, replacement ? { ...replacement } : {}, escape)}</div><div class="upload"><h3>Choose your document</h3><p>PDF, JPEG or PNG. Up to ${requirements.maxFileBytes / 1048576} MB per file and ${requirements.maxTotalBytes / 1048576} MB combined.</p><label id="document-file-label" for="document-file">${rule?.transcriptsRequired ? 'Certificate file' : 'Document file'}</label><input type="file" id="document-file" name="file" accept="application/pdf,image/jpeg,image/png" required></div><div id="document-transcripts" class="upload" ${rule?.transcriptsRequired ? '' : 'hidden'}><label for="transcript-files">Transcript attachments (1–${requirements.maxTranscripts} files)</label><p>Attach fresh transcripts when replacing a degree or diploma.</p><input type="file" id="transcript-files" name="transcripts" multiple accept="application/pdf,image/jpeg,image/png" ${rule?.transcriptsRequired ? 'required' : 'disabled'}></div><label class="check"><input type="checkbox" name="confirm" required><span>I confirm that these documents belong to me and the details are accurate.</span></label><button type="submit" id="document-submit" class="btn primary" ${!rule ? 'disabled' : ''}>${state.busy ? 'Uploading…' : replacement ? 'Upload replacement' : 'Upload document'}</button>${inDialog ? '<button type="button" class="btn subtle" data-document-dialog-close>Cancel</button>' : '<a class="btn subtle" href="/documents">Cancel</a>'}</fieldset></form>`;
  return `<section class="${styles.page}">${heading(replacement ? 'Replace a document' : 'Upload a document', 'Add clear, complete files and accurate details.')}${card('Document details', body)}</section>`;
}
export function documentDetail(context: PageContext): string {
  const { documentState: state, escape, heading, card, button } = context;
  if (!context.routeParams.get('id')) return card('Choose a document', '<p>Open a document from My documents to see its details.</p><a class="btn" href="/documents">My documents</a>');
  if (state.detailStatus !== 'ready' || !state.detail || !state.history) return `<section class="${styles.page}">${heading('Document details', 'Your file and verification history.')}${card('Document details', state.detailStatus === 'error' ? `<p role="alert">${escape(state.detailError)}</p><button class="btn" data-document-action="detail-retry">Try again</button>` : '<p role="status">Loading document details…</p>')}</section>`;
  const doc = state.detail, previous = previousIds(state.items).has(doc.id);
  const canSubmitEvidence = !previous && ['ADDITIONAL_EVIDENCE_REQUIRED', 'DISPUTED', 'REJECTED'].includes(doc.status);
  const history = state.history.history.map(event => `<li><strong>${escape(label(event.toStatus))}</strong> · ${escape(date(event.createdAt))}<p>${escape(event.reason)}</p></li>`).join('');
  const reviews = state.history.reviews.map(review => `<li><strong>${escape(label(review.outcome))}</strong> · ${escape(label(review.method))} · ${escape(date(review.createdAt))}<p>${escape(review.reason)}</p></li>`).join('');
  const evidence = state.history.evidence.map(entry => `<li>${escape(date(entry.createdAt))}<p>${escape(entry.note)}</p>${entry.reference ? `<p>${escape(entry.reference)}</p>` : ''}</li>`).join('');
  return `<section class="${styles.page}">${heading(escape(doc.title), 'Your file and verification history.', button('My documents', 'documents', 'subtle'))}${alerts(context)}${card('Document details', `<p>${escape(documentCategory(doc, context))} · ${escape(date(doc.createdAt))}${doc.institutionName ? ` · ${escape(doc.institutionName)}` : ''}</p>${doc.courseName || doc.certificationName ? `<p>${escape(doc.courseName || doc.certificationName)}</p>` : ''}${previous ? '<p class="notice">Previous version. Submit changes on the latest document.</p>' : ''}${statuses(doc, context)}${actions(doc, context, previous)}`)}<div class="grid section">${card('Status history', history ? `<ol class="${styles.timeline}">${history}</ol>` : '<p>No status events yet.</p>')}${card('Verification reviews', reviews ? `<ol class="${styles.timeline}">${reviews}</ol>` : '<p>No human verification review has been recorded yet.</p>')}</div>${card('Your additional evidence', evidence ? `<ol class="${styles.timeline}">${evidence}</ol>` : '<p>No additional evidence submitted.</p>')}${canSubmitEvidence ? card('Respond to the review', `<form id="document-evidence-form" data-document-id="${escape(doc.id)}"><fieldset class="${styles.fields}" id="document-evidence-fields"><div class="field"><label for="evidence-note">Explanation / additional evidence</label><textarea id="evidence-note" name="note" required minlength="5" maxlength="4000"></textarea></div><div class="field"><label for="evidence-reference">Evidence reference (optional)</label><input id="evidence-reference" name="reference" maxlength="1000"></div><button class="btn primary" id="document-evidence-submit">Submit evidence</button></fieldset></form>`) : ''}</section>`;
}

export function documentSummary(context: PageContext): string {
  const { documentState: state, escape, badge } = context;
  if (['idle', 'loading'].includes(state.status)) return '<div class="card-body"><p role="status">Loading your documents…</p></div>';
  if (state.status === 'error') return '<div class="card-body"><p>Your documents could not be loaded.</p><button class="btn subtle" data-document-action="refresh">Try again</button></div>';
  const previous = previousIds(state.items);
  const active = state.items.filter(doc => !previous.has(doc.id));
  return active.length ? active.slice(0, 5).map(doc => `<div class="document-row"><div class="${styles.summaryDetails}"><h3><a href="/document?id=${encodeURIComponent(doc.id)}">${escape(doc.title)}</a></h3><p>${escape(documentCategory(doc, context))} · ${escape(date(doc.createdAt))}</p></div>${badge(escape(label(doc.status)), doc.status === 'AUTHENTICATED' ? 'green' : 'amber')}</div>`).join('') : '<div class="card-body"><p>No documents submitted yet. Start with your National ID or passport.</p><a class="btn subtle" href="/upload">Upload a document</a></div>';
}


export function documentDialogShell(title: string, escape: PageContext['escape']): string {
  return `<dialog data-document-dialog class="${styles.modal}" aria-labelledby="document-dialog-title"><header class="${styles.modalHeader}"><h2 id="document-dialog-title">${escape(title)}</h2><button type="button" class="${styles.closeButton}" data-document-dialog-close aria-label="Close dialog">×</button></header><div class="${styles.modalBody}" data-document-dialog-body></div></dialog>`;
}
export function documentDialog(context: PageContext, kind: string, previewUrl = '', previewType = ''): string {
  const { documentState: state, escape, card } = context;
  const doc = state.detail;
  if (kind === 'choose-update') {
    const previous = previousIds(state.items);
    const documents = state.items.filter(doc => !previous.has(doc.id));
    return documents.length ? `<p>Select the document you want to update.</p>${documents.map(doc => `<div class="document-row"><div class="${styles.rowInfo}"><h3>${escape(doc.title)}</h3><p>${escape(documentCategory(doc, context))}</p></div><button type="button" class="btn subtle" data-document-action="replace" data-document-id="${escape(doc.id)}">Update / replace</button>${['ADDITIONAL_EVIDENCE_REQUIRED','DISPUTED','REJECTED'].includes(doc.status) ? `<button type="button" class="btn subtle" data-document-action="evidence" data-document-id="${escape(doc.id)}">Add evidence</button>` : ''}</div>`).join('')}` : '<p>No documents submitted yet.</p><button class="btn primary" data-document-action="upload">Upload a document</button>';
  }
  if (kind === 'upload' || kind === 'replace') {
    return upload({ ...context, heading: () => '', card: (_title, body) => body }, true);
  }
  if (!doc) return '<p role="status">Loading document…</p>';
  if (kind === 'preview') {
    if (doc.scanStatus !== 'CLEAN') return `<p class="notice">${doc.scanStatus === 'QUARANTINED' ? 'This file is waiting for its malware scan.' : doc.scanStatus === 'INFECTED' ? 'This file is blocked because it did not pass malware scanning.' : 'This file is unavailable because its malware scan failed.'} Preview is available after a successful scan.</p>`;
    return `<p class="${styles.previewName}">${escape(doc.title)}</p>${previewType === 'application/pdf-unavailable' ? '<p class="notice">This browser cannot display PDF previews. Download the original to view it.</p>' : previewType === 'application/pdf' ? `<iframe class="${styles.pdfPreview}" src="${escape(previewUrl)}" title="Preview of ${escape(doc.title)}"></iframe><p class="${styles.previewName}">If the PDF preview does not load, use Download original.</p>` : `<img class="${styles.imagePreview}" src="${escape(previewUrl)}" alt="Preview of ${escape(doc.title)}">`}<div class="mt"><button type="button" class="btn subtle" data-document-action="download" data-document-id="${escape(doc.id)}">Download original</button></div>`;
  }
  if (kind === 'details') {
    const fields = [['Document', doc.title], ['Category', documentCategory(doc, context)], ['Institution', doc.institutionName], ['Course / programme', doc.courseName], ['Certification', doc.certificationName], ['Issuer', doc.issuer], ['Official verification URL', doc.verificationUrl], ['Issue date', date(doc.issuedAt)], ['Expiry date', date(doc.expiresAt)], ['Uploaded', date(doc.createdAt)], ['Size', `${(doc.size / 1024).toFixed(1)} KB`]];
    return `${statuses(doc, context)}<dl class="${styles.metadata}">${fields.filter(([, value]) => !!value).map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
  }
  // Reuse the backend-driven history/evidence rendering, without a second page header or actions.
  const content = documentDetail({ ...context, routeParams: new URLSearchParams({ id: doc.id }), heading: () => '', card });
  const start = content.indexOf('<div class="grid section">');
  return `<p class="${styles.previewName}">${escape(doc.title)}</p><div id="document-error" class="${styles.error}" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</div>${state.notice ? `<p class="notice" role="status">${escape(state.notice)}</p>` : ''}${start >= 0 ? content.slice(start).replace(/<\/section>$/, '') : '<p>No verification history yet.</p>'}`;
}
