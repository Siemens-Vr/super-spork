import { dashboard as renderDashboard } from './dashboard/dashboard.tsx';
import { profile as renderProfile } from './profile/profile.tsx';
import { documentPage as renderDocumentPage, upload as renderUpload, documentDetail as renderDocumentDetail, uploadMetadata, documentSummary as renderDocumentSummary, documentDialog, documentDialogShell } from './documents/documents.tsx';
import { explore as renderExplore, career as renderCareer, target as renderTarget } from './careers/careers.tsx';
import { booking as renderBooking, preflight as renderPreflight, assessment as renderAssessment } from './assessments/assessments.tsx';
import { results as renderResults } from './results/results.tsx';
import { learning as renderLearning } from './learning/learning.tsx';
import { settings as renderSettings } from './settings/settings.tsx';
import { escapeHtml as escape } from '../../components/html.js';
import { getRoute, getRouteParams, navigate, initializeNavigation } from '../../hooks/navigation.js';
import { authGate, authPage as auth, initializeAuth, refreshGoogleRegistration, currentUser, updateProfileIdentity } from '../../context/auth.js';

import { api } from '../../lib/api.js';
import { createDocumentDialogs } from '../../context/document-dialog.js';
import { createDocumentStore } from '../../context/documents.js';
import { initializeInstitutionSearch } from '../../context/institution-search.js';
import { createProfileStore } from '../../context/profile.js';
import { createBookingStore } from '../../context/bookings.js';
import { createCareerStore } from '../../context/careers.js';

import { createAssessmentStore } from '../../context/assessment.js';
import { createLearningStore } from '../../context/learning.js';
import { createAssessmentDevices } from '../../context/assessment-devices.js';
const assessmentRoutes = new Set(['preflight', 'assessment', 'results']);
const learningStore = createLearningStore({ client: api, onChange: () => { if (getRoute() === 'learning') render(); }, onUnauthorized: () => { void initializeAuth(render); } });
const assessmentStore = createAssessmentStore({ client: api, onChange: () => { if (assessmentStore.snapshot().session?.status === 'COMPLETED') { bookingStore.reset(); careerStore.reset(); learningStore.reset(); } if (assessmentRoutes.has(getRoute())) render(); }, onUnauthorized: () => { void initializeAuth(render); } });
const assessmentDevices = createAssessmentDevices({ store: assessmentStore, active: () => assessmentRoutes.has(getRoute()) && !!currentUser(), questionsActive: () => getRoute() === 'assessment' && !!currentUser() });

const bookingStore = createBookingStore({ client: api, onChange: () => { if (['booking', 'dashboard'].includes(getRoute())) render(); }, onUnauthorized: () => { void initializeAuth(render); } });

const careerRoutes = new Set(['careers', 'career', 'target']);
const careerStore = createCareerStore({
  client: api,
  onChange: () => { if (careerRoutes.has(getRoute()) || getRoute() === 'booking') render(); },
  onUnauthorized: () => { void initializeAuth(render); },
  onAbandoned: () => { bookingStore.reset(); assessmentDevices.reset(); assessmentStore.reset(); if (getRoute() === 'target') navigate('/careers'); },
});

initializeInstitutionSearch({ client: api, ownerId: () => currentUser()?.id, onUnauthorized: () => { void initializeAuth(render); } });

const profileStore = createProfileStore({
  client: api,
  onChange: () => { if (getRoute() === 'onboarding') render(); },
  onSaved: profile => { updateProfileIdentity(profile); bookingStore.reset(); },
  onUnauthorized: () => { void initializeAuth(render); },
});

const documentRoutes = new Set(['documents', 'upload', 'document']);
const documentStore = createDocumentStore({
  client: api,
  onUnauthorized: () => { void initializeAuth(render); },
  onMutation: () => { profileStore.reset(); careerStore.reset(); bookingStore.reset(); },
  onChange: reason => {
    if (!documentRoutes.has(getRoute()) && getRoute() !== 'dashboard') return;
    if (reason === 'download-error') { updateDocumentForm('evidence'); return; }
    if (reason === 'upload-state' && document.getElementById('upload-form')) { updateDocumentForm('upload'); return; }
    if (reason === 'evidence-state' && document.getElementById('document-evidence-form')) {
      if (!documentStore.snapshot().busy && documentStore.snapshot().notice) render();
      else updateDocumentForm('evidence');
      return;
    }
    render();
  },
});
function updateDocumentForm(kind) {
  const snapshot = documentStore.snapshot();
  const scope = document.querySelector('dialog[data-document-dialog][open]') || document;
  const error = scope.querySelector('#document-error');
  if (error) { error.hidden = !snapshot.error; error.textContent = snapshot.error; }
  const fieldset = scope.querySelector(kind === 'upload' ? '#document-upload-fields' : '#document-evidence-fields');
  if (fieldset) fieldset.disabled = snapshot.busy;
  const form = scope.querySelector(kind === 'upload' ? '#upload-form' : '#document-evidence-form');
  form?.setAttribute('aria-busy', String(snapshot.busy));
  const submit = scope.querySelector(kind === 'upload' ? '#document-submit' : '#document-evidence-submit');
  if (submit) submit.disabled = snapshot.busy || (kind === 'upload' && !form.elements.category.value);
  if (submit) submit.textContent = snapshot.busy ? (kind === 'upload' ? 'Uploading…' : 'Submitting…') : kind === 'upload' ? (form.dataset.replacesId ? 'Upload replacement' : 'Upload document') : 'Submit evidence';
}

const icons={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6"/>',career:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0M12 12v4"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',chart:'<path d="M4 3v18h17M8 16v-5M13 16V7M18 16v-8"/>',book:'<path d="M12 5C9 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1v15"/>',settings:'<circle cx="12" cy="12" r="4"/><path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 1 3 2 4-2 1-4 3-3-2-4-3-1-1-3z"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 22h4"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',shield:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',logout:'<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.grid}</svg>`;
const saved=JSON.parse(localStorage.getItem('nexus-demo')||'{}');
const state={name:'Alex Morgan',discipline:'Mechatronics Engineering',career:'Choose a career',prepared:false,learning:saved.learning||[false,false,false],booked:false,slot:0,messages:[],started:false};
const persist=()=>localStorage.setItem('nexus-demo',JSON.stringify({learning:state.learning}));
const badge=(s,c='')=>`<span class="badge ${c}">${s}</span>`;
const button=(text,href,cls='primary')=>
    `<a class="btn ${cls}" href="/${href}">${text}${icon('arrow')}</a>`;
const card=(title,body,link='')=>
    `<section class="card">
<div class="card-head">
   <h2>${title}</h2>
    ${link}
</div>
<div class="card-body">
    ${body}
</div>
</section>`;
const heading=(title,sub,action='')=>
    `<div class="page-heading">
<div>
 <div class="eyebrow">
   Your career, connected
 </div>
<h1>${title}</h1> 
<p>${sub}</p>
</div>${action||`<span class="date">
    ${icon('calendar')} ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Nairobi'}).format(new Date())}</span>`}
    </div>`;
const field=(label,name,value='',type='text')=>
    `<div class="field">
<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" required></div>`;
function documents(){return renderDocumentSummary(pageContext());}
const navigation=[['dashboard','Overview','grid'],['onboarding','My profile','user'],['documents','My documents','file'],['careers','Explore careers','career'],['booking','Assessments','calendar'],['results','My results','chart'],['learning','Learning plan','book']];
let route='dashboard';
function shell(body){const admin=false;const nav=navigation;document.getElementById('app').innerHTML=`<aside class="sidebar"><a class="brand" href="/dashboard"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a><div class="nav-label">${admin?'ADMIN WORKSPACE':'APPLICANT WORKSPACE'}</div><nav aria-label="Main navigation">${nav.map(([path,label,i])=>`<a class="nav-link ${route===path?'active':''}" ${route===path?'aria-current="page"':''} href="/${path}">${icon(i)}${label}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="help-box"><strong>Every step brings you closer.</strong>Build your skills. Shape your future.<a href="/help">Need a little guidance? ↗</a></div><a class="nav-link ${route==='settings'?'active':''}" href="/settings">${icon('settings')}Account settings</a><button class="nav-link logout-button" data-auth-action="logout">${icon('logout')}Sign out</button></div></aside><main class="main"><header class="topbar"><div class="inline-actions"><button class="icon-button mobile-menu" aria-label="Toggle navigation" data-action="menu">${icon('menu')}</button><span class="breadcrumb">${admin?'Admin workspace':'Applicant workspace'} &nbsp; / &nbsp; <b>${nav.find(n=>n[0]===route)?.[1]||titles[route]||'My account'}</b></span></div><div class="top-actions"><span class="demo">${route==='onboarding'?'MY PROFILE':documentRoutes.has(route)?'MY DOCUMENTS':careerRoutes.has(route)?'CAREER EXPLORER':route==='booking'?'ASSESSMENT BOOKING':(assessmentRoutes.has(route)||route==='learning')?'ASSESSMENT WORKSPACE':'DEMO DASHBOARD'}</span><button class="icon-button" data-action="notifications" aria-label="Notifications">${icon('bell')}</button><a class="user" href="/settings"><span class="avatar">${escape((currentUser()?.legalName||state.name).split(' ').map(s=>s[0]).join('').slice(0,2))}</span><div>${escape(currentUser()?.legalName||state.name)}<small>${admin?'Administrator':'Applicant'}</small></div></a></div></header><div class="content">${body}<footer class="footer"><span>© ${new Date().getFullYear()} VML NEXUS. Your potential, realized.</span><span><a href="/privacy">Privacy policy</a><a href="/help">Help center ↗</a></span></footer></div></main>`}

// Career choices, assessment bookings and learning plans come from the backend.

const titles={onboarding:'My profile',document:'Document details',upload:'Upload document',target:'Career target',career:'Career details',preflight:'Device check',assessment:'Assessment room',settings:'Account settings',login:'Sign in',register:'Register',help:'Help center',privacy:'Privacy policy'};

const pageContext = () => ({ state, assessmentState: assessmentStore.snapshot(), learningState: learningStore.snapshot(), bookingState: bookingStore.snapshot(), documentState: documentStore.snapshot(), routeParams: getRouteParams(), profileState: profileStore.snapshot(), careerState: careerStore.snapshot(), escape, heading, button, card, badge, field, documents, icon, currentUser, careers: careerStore.snapshot().items.map(role => role.title) });
const documentDialogs = createDocumentDialogs({
  client: api, store: documentStore, context: pageContext,
  renderShell: documentDialogShell, renderContent: documentDialog,
  onChanged: () => render(), onUnauthorized: () => { void initializeAuth(render); },
  ownerId: () => currentUser()?.id,
});
const dashboard = () => renderDashboard(pageContext());
const profile = () => renderProfile(pageContext());
const documentPage = () => renderDocumentPage(pageContext());
const upload = () => renderUpload(pageContext());
const documentDetail = () => renderDocumentDetail(pageContext());
const explore = () => renderExplore(pageContext());
const career = () => renderCareer(pageContext());
const target = () => renderTarget(pageContext());
const booking = () => renderBooking(pageContext());
const preflight = () => renderPreflight(pageContext());
const assessment = () => renderAssessment(pageContext());
const results = () => renderResults(pageContext());
const learning = () => renderLearning(pageContext());
const settings = () => renderSettings(pageContext());

function render(){route=getRoute();
    
    const gate=authGate(route);if(gate!==null){documentDialogs.reset();assessmentDevices.reset();assessmentStore.reset();learningStore.reset();profileStore.reset();documentStore.reset();bookingStore.reset();careerStore.reset();state.career='Choose a career';state.prepared=false;document.getElementById('app').innerHTML=gate;document.title=`${route} · VML NEXUS`;return;}
    if (documentRoutes.has(route) || route === 'dashboard') {
      void documentStore.load(currentUser()?.id);
      const id = getRouteParams().get(route === 'upload' ? 'replace' : 'id');
      if ((route === 'document' || route === 'upload') && id) void documentStore.select(id);
    }
    if (assessmentRoutes.has(route)) void assessmentStore.load(currentUser()?.id, getRouteParams().get('booking') || '');
    if (route === 'learning') void learningStore.load(currentUser()?.id, getRouteParams().get('booking') || '');
    if (['booking', 'dashboard'].includes(route)) void bookingStore.load(currentUser()?.id);
    if (route === 'onboarding') void profileStore.load(currentUser()?.id);
    if (careerRoutes.has(route) || route === 'booking') {
      void careerStore.load(currentUser()?.id);
      const data = careerStore.snapshot();
      const active = data.activeTarget;
      const params = getRouteParams();
      const selectedId = route === 'career' ? params.get('id') :
        route === 'target' ? (active && active.status !== 'DRAFT' ? active.jobRoleId : params.get('career') || active?.jobRoleId || data.selectedId) : null;
      if (selectedId) void careerStore.select(selectedId);
      else if (route === 'career' && data.status === 'ready') { navigate('/careers'); return; }
      state.career = active?.jobRole.title || data.detail?.title || 'Choose a career';
      state.prepared = !!active && ['PREPARED', 'IN_PROGRESS'].includes(active.status);
    }
    const pages={dashboard,onboarding:profile,documents:documentPage,document:documentDetail,upload,careers:explore,career,target,booking,preflight,assessment,results,learning,settings,login:auth,register:auth,'register/google':auth,'verify-email':auth,'forgot-password':auth,'reset-password':auth,mfa:auth,help:()=>heading('How can we help?','A little guidance for your next step.')+card('Your journey, explained','<h3>Can I continue while documents are reviewed?</h3><p>Yes. After identity submission you can explore careers. Booking requires a clean identity scan and any additional checks required by your assessment policy.</p><h3 class="mt">Can I change my career?</h3><p>Draft targets are editable. Preparation locks your choices. Complete or appropriately abandon the current target before selecting a new career.</p><h3 class="mt">Are AI scores final?</h3><p>No. An authorized assessor must review and publish final results.</p>'),privacy:()=>heading('Privacy information','A transparent view of this preview.')+card('Demo data & local storage','<p>Your assessment bookings, confirmed answers, results and learning progress are saved to your backend account. Some other dashboard records remain illustrative. Login, registration, verification and password recovery send the supplied account details to the configured backend. My profile loads and saves your personal and academic details through the backend. Explore careers loads the career catalogue and saves your assessment target through the backend. My documents uploads your files and supporting details to private backend storage and displays their scan and verification history. Passwords and session tokens are not stored by this frontend. Other dashboard records remain illustrative. Use Account settings to reset locally saved choices.</p><p class="mt">The production privacy notice must be approved by the institution before real applicant data is collected.</p>')};shell((pages[route]||(()=>heading('Page not found','This page is not available.')+button('Back to overview','dashboard')))());assessmentDevices.attach();document.title=`${titles[route]||navigation.find(n=>n[0]===route)?.[1]||'Workspace'} · VML NEXUS`;}
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='menu')document.querySelector('.sidebar').classList.toggle('open');if(a==='notifications')toast('You’re up to date. Academic document review is in progress.');if(a==='reset'){localStorage.removeItem('nexus-demo');location.reload()}if(a==='catalogue')toast(`${b.dataset.value} management is a page preview. Editing requires API integration.`);if(a==='review')toast(`This ${b.dataset.value} is an illustrative record. No live data has been loaded.`)});
document.addEventListener('input',e=>{if(e.target.id==='career-search'){let count=0;document.querySelectorAll('[data-career]').forEach(el=>{el.hidden=!el.dataset.career.includes(e.target.value.toLowerCase());if(!el.hidden)count++});document.getElementById('no-careers').hidden=!!count}});
document.addEventListener('change',e=>{if(e.target.matches('[data-learning]')){state.learning[Number(e.target.dataset.learning)]=e.target.checked;persist();render()}});
document.addEventListener('submit',e=>{e.preventDefault();const id=e.target.id;if(id==='profile-form'){void profileStore.save(Object.fromEntries(new FormData(e.target)));}if(id==='upload-form'&&!e.target.closest('[data-document-dialog]')){void documentStore.upload(new FormData(e.target),e.target.dataset.replacesId||undefined).then(saved=>{if(saved&&getRoute()==='upload')navigate('/documents');});}if(id==='document-evidence-form'&&!e.target.closest('[data-document-dialog]')){void documentStore.evidence(e.target.dataset.documentId,Object.fromEntries(new FormData(e.target)));}if(id==='target-form'){void careerStore.prepare().then(saved=>{if(saved){bookingStore.reset();if(getRoute()==='target')toast('Career target saved and prepared.');}});}if(id==='preflight-form'){const input=Object.fromEntries(new FormData(e.target));assessmentStore.device('speakerConfirmed',!!input.speakerConfirmed);void assessmentStore.action('start',{confirmed:!!input.confirmed,privacyAcknowledged:!!input.privacyAcknowledged,audioProcessingConsent:!!input.audioProcessingConsent,mode:assessmentStore.snapshot().preflight.policy.allowText?'TEXT':'VOICE'}).then(ok=>{if(ok&&getRoute()==='preflight')navigate('/assessment?booking='+encodeURIComponent(assessmentStore.snapshot().bookingId));});}if(id==='skip-assessment-form'){void assessmentStore.action('skip');}if(id==='answer-form'){assessmentStore.draft(document.getElementById('answer').value);void assessmentStore.action('answer');}if(id==='admin-form')toast('Availability preview complete. No backend window has been published.');});
document.addEventListener('click',e=>{if(e.target.closest('[data-profile-action=retry]')){void profileStore.load(currentUser()?.id,true);render();}});
document.addEventListener('change',event=>{
  if(event.target.id!=='document-category')return;
  const form=event.target.closest('form');
  const values=Object.fromEntries(new FormData(form));
  const rule=documentStore.snapshot().requirements.categories.find(rule=>rule.category===event.target.value);
  form.querySelector('#document-metadata').innerHTML=uploadMetadata(rule,values,escape);
  form.querySelector('#document-transcripts').hidden=!rule?.transcriptsRequired;
  const transcripts=form.querySelector('#transcript-files');
  transcripts.value='';
  transcripts.required=!!rule?.transcriptsRequired;transcripts.disabled=!rule?.transcriptsRequired;
  form.querySelector('#document-file-label').textContent=rule?.transcriptsRequired?'Certificate file':'Document file';
  form.querySelector('#document-submit').disabled=!rule || documentStore.snapshot().busy;
});
document.addEventListener('click',async event=>{
  const control=event.target.closest('[data-document-action]');
  if(!control||control.disabled)return;
  const action=control.dataset.documentAction;
  if(action==='refresh'){void documentStore.load(currentUser()?.id,true);render();}
  if(action==='detail-retry'){void documentStore.select(getRouteParams().get(getRoute()==='upload'?'replace':'id'),true);render();}
  if(action==='download'){
    control.disabled=true;
    const file=await documentStore.download(control.dataset.documentId);
    if(file){
      const url=URL.createObjectURL(file.blob),link=document.createElement('a');
      link.href=url;link.download=`document-${control.dataset.documentId}.${file.blob.type==='application/pdf'?'pdf':file.blob.type==='image/png'?'png':'jpg'}`;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    control.disabled=false;
  }
});

document.addEventListener('click', event => {
  const control = event.target.closest('[data-career-action]');
  if (!control || control.disabled) return;
  const action = control.dataset.careerAction;
  if (action === 'refresh') { void careerStore.load(currentUser()?.id, true); render(); }
  if (action === 'retry-detail') { void careerStore.select(careerStore.snapshot().selectedId, true); render(); }
  if (action === 'begin-recovery') careerStore.recovery(true);
  if (action === 'cancel-recovery') careerStore.recovery(false);
  if (action === 'remove') {
    const { field, value } = control.dataset;
    careerStore.edit(field, careerStore.snapshot().draft[field].filter(id => id !== value));
  }
});
document.addEventListener('input', event => { if (event.target.id === 'target-recovery-reason') careerStore.recoveryReason(event.target.value); });
document.addEventListener('submit', event => { if (event.target.id !== 'target-recovery-form') return; event.preventDefault(); careerStore.recoveryReason(new FormData(event.target).get('reason') || ''); void careerStore.abandon(new FormData(event.target).get('confirm') === 'on'); });
document.addEventListener('change', event => {
  const input = event.target;
  if (!input.closest('#target-form')) return;
  if (input.name === 'industryIds') {
    careerStore.edit('industryIds', [...input.form.querySelectorAll('[name="industryIds"]:checked')].map(el => el.value));
  } else if (input.dataset.careerField && input.value) {
    const field = input.dataset.careerField;
    careerStore.edit(field, field === 'blueprintId' ? input.value : [...careerStore.snapshot().draft[field], input.value]);
  }
});
window.addEventListener('app:navigate',()=>{documentDialogs.reset();if(getRoute()==='booking')void bookingStore.load(currentUser()?.id,true);if(['upload','document'].includes(getRoute()))documentStore.clearMessages();render();if(getRoute()==='register/google')void refreshGoogleRegistration();window.scrollTo(0,0)});initializeNavigation();render();initializeAuth(render);

document.addEventListener('click', event => {
  const control = event.target.closest('[data-booking-action]');
  if (!control || control.disabled) return;
  const action = control.dataset.bookingAction;
  if (action === 'refresh') void bookingStore.load(currentUser()?.id, true);
  if (action === 'select') bookingStore.select(control.dataset.slotId);
  if (['cancel', 'reschedule', 'dismiss'].includes(action)) bookingStore.mode(action === 'dismiss' ? '' : action);
});
document.addEventListener('input', event => { if (event.target.id === 'booking-reason') bookingStore.reason(event.target.value); });
document.addEventListener('submit', event => { if (event.target.id !== 'booking-form') return; event.preventDefault(); void bookingStore.mutate(event.target.dataset.bookingSubmit); });

document.addEventListener('click', event => { if (event.target.closest('[data-learning-action="reload"]')) void learningStore.load(currentUser()?.id, getRouteParams().get('booking') || '', true); });
document.addEventListener('input', event => { if (event.target.id === 'answer') assessmentStore.draft(event.target.value); });
document.addEventListener('change', event => {
  if (event.target.matches('[data-learning-item]')) void learningStore.progress(event.target.dataset.learningItem, event.target.checked ? 'COMPLETED' : 'PENDING');
  if (event.target.closest('#preflight-form')) { assessmentStore.snapshot().startDraft = Object.fromEntries(new FormData(event.target.closest('form'))); }
});
document.addEventListener('click', event => {
  const control = event.target.closest('[data-assessment-action]'); if (!control || control.disabled) return;
  const action = control.dataset.assessmentAction;
  if (action === 'reload') void assessmentStore.load(currentUser()?.id, getRouteParams().get('booking') || '', true);
  if (action === 'resume') void assessmentStore.action('resume');
  if (action === 'camera' || action === 'microphone') void assessmentDevices.check(action);
  if (action === 'speaker') assessmentDevices.speaker();
  if (action === 'spoken-questions') assessmentDevices.toggleQuestions();
  if (action === 'stop-speaking') assessmentDevices.stopSpeaking();
  if (action === 'dictate') assessmentDevices.dictate();
  if (action === 'stop-dictation') assessmentDevices.stop();
});
window.addEventListener('app:navigate', () => { if (!['preflight', 'assessment'].includes(getRoute())) assessmentDevices.reset(); });
window.addEventListener('pagehide', () => assessmentDevices.reset());
window.addEventListener('offline', () => {
  const s = assessmentStore.snapshot();
  if (s.session && assessmentRoutes.has(getRoute())) { void api.assessmentEvent(s.session.id, 'DISCONNECTED').catch(() => {}); assessmentStore.message('Connection lost. Confirmed answers are saved; reload the saved session after reconnecting.'); }
});
