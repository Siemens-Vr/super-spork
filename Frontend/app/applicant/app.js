import { dashboard as renderDashboard } from './dashboard/dashboard.tsx';
import { profile as renderProfile } from './profile/profile.tsx';
import { documentPage as renderDocumentPage, upload as renderUpload } from './documents/documents.tsx';
import { explore as renderExplore, career as renderCareer, target as renderTarget } from './careers/careers.tsx';
import { booking as renderBooking, preflight as renderPreflight, assessment as renderAssessment } from './assessments/assessments.tsx';
import { results as renderResults } from './results/results.tsx';
import { learning as renderLearning } from './learning/learning.tsx';
import { settings as renderSettings } from './settings/settings.tsx';
import { escapeHtml as escape } from '../../components/html.js';
import { getRoute } from '../../hooks/navigation.js';
import { authGate, authPage as auth, initializeAuth, currentUser } from '../../context/auth.js';

const icons={grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',file:'<path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6"/>',career:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0M12 12v4"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',chart:'<path d="M4 3v18h17M8 16v-5M13 16V7M18 16v-8"/>',book:'<path d="M12 5C9 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1v15"/>',settings:'<circle cx="12" cy="12" r="4"/><path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 1 3 2 4-2 1-4 3-3-2-4-3-1-1-3z"/>',bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 22h4"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5"/>',shield:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',logout:'<path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n]||icons.grid}</svg>`;
const saved=JSON.parse(localStorage.getItem('nexus-demo')||'{}');
const state={name:'Alex Morgan',discipline:'Mechatronics Engineering',career:'Mechatronics Engineer',booked:false,prepared:false,learning:[false,false,false],...saved,slot:0,messages:[],started:false};
const persist=()=>localStorage.setItem('nexus-demo',JSON.stringify({name:state.name,discipline:state.discipline,career:state.career,booked:state.booked,prepared:state.prepared,learning:state.learning}));
const badge=(s,c='')=>`<span class="badge ${c}">${s}</span>`;
const button=(text,href,cls='primary')=>
    `<a class="btn ${cls}" href="#/${href}">${text}${icon('arrow')}</a>`;
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
const docs=[['National identity card','Identity document · Uploaded 08 Nov 2026','Authenticated','green'],['Degree certificate','Bachelor of Engineering · Uploaded 09 Nov 2026','Under review','amber'],['Academic transcript','Academic record · Uploaded 09 Nov 2026','Under review','amber']];
function documents(){return docs.map(d=>`<div class="document-row"><div class="file-icon">${icon('file')}</div><div><h3>${d[0]}</h3><p>${d[1]}</p></div>${badge(d[2],d[3])}</div>`).join('')}
const navigation=[['dashboard','Overview','grid'],['onboarding','My profile','user'],['documents','My documents','file'],['careers','Explore careers','career'],['booking','Assessments','calendar'],['results','My results','chart'],['learning','Learning plan','book']];
let route='dashboard';
function shell(body){const admin=false;const nav=navigation;document.getElementById('app').innerHTML=`<aside class="sidebar"><a class="brand" href="#/dashboard"><span class="mark">N</span><span>VML NEXUS<small>VIRTUAL MECHATRONICS LABS</small></span></a><div class="nav-label">${admin?'ADMIN WORKSPACE':'APPLICANT WORKSPACE'}</div><nav aria-label="Main navigation">${nav.map(([path,label,i])=>`<a class="nav-link ${route===path?'active':''}" ${route===path?'aria-current="page"':''} href="#/${path}">${icon(i)}${label}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="help-box"><strong>Every step brings you closer.</strong>Build your skills. Shape your future.<a href="#/help">Need a little guidance? ↗</a></div><a class="nav-link ${route==='settings'?'active':''}" href="#/settings">${icon('settings')}Account settings</a><button class="nav-link logout-button" data-auth-action="logout">${icon('logout')}Sign out</button></div></aside><main class="main"><header class="topbar"><div class="inline-actions"><button class="icon-button mobile-menu" aria-label="Toggle navigation" data-action="menu">${icon('menu')}</button><span class="breadcrumb">${admin?'Admin workspace':'Applicant workspace'} &nbsp; / &nbsp; <b>${nav.find(n=>n[0]===route)?.[1]||titles[route]||'My account'}</b></span></div><div class="top-actions"><span class="demo">DEMO DASHBOARD</span><button class="icon-button" data-action="notifications" aria-label="Notifications">${icon('bell')}</button><a class="user" href="#/settings"><span class="avatar">${escape((currentUser()?.legalName||state.name).split(' ').map(s=>s[0]).join('').slice(0,2))}</span><div>${escape(currentUser()?.legalName||state.name)}<small>${admin?'Administrator':'Applicant'}</small></div></a></div></header><div class="content">${body}<footer class="footer"><span>© ${new Date().getFullYear()} VML NEXUS. Your potential, realized.</span><span><a href="#/privacy">Privacy policy</a><a href="#/help">Help center ↗</a></span></footer></div></main>`}

const careers=['Mechatronics Engineer','Automation Engineer','Robotics Engineer','Maintenance Engineer','Manufacturing Engineer','Control Systems Engineer'];

const titles={onboarding:'My profile',upload:'Upload document',target:'Career target',career:'Career details',preflight:'Device check',assessment:'Assessment room',settings:'Account settings',login:'Sign in',register:'Register',help:'Help center',privacy:'Privacy policy'};

const pageContext = () => ({ state, escape, heading, button, card, badge, field, documents, icon, currentUser, careers });
const dashboard = () => renderDashboard(pageContext());
const profile = () => renderProfile(pageContext());
const documentPage = () => renderDocumentPage(pageContext());
const upload = () => renderUpload(pageContext());
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
    
    const gate=authGate(route);if(gate!==null){document.getElementById('app').innerHTML=gate;document.title=`${route} · VML NEXUS`;return;}
    const pages={dashboard,onboarding:profile,documents:documentPage,upload,careers:explore,career,target,booking,preflight,assessment,results,learning,settings,login:auth,register:auth,'register/google':auth,'verify-email':auth,'forgot-password':auth,'reset-password':auth,mfa:auth,'auth/google/callback':()=>heading('Google sign-in callback','API integration is required to complete authentication.')+button('Return to sign in','login'),help:()=>heading('How can we help?','A little guidance for your next step.')+card('Your journey, explained','<h3>Can I continue while documents are reviewed?</h3><p>Yes. After identity submission you can explore careers. Booking requires a clean identity scan and any additional checks required by your assessment policy.</p><h3 class="mt">Can I change my career?</h3><p>Draft targets are editable. Preparation locks your choices. Complete or appropriately abandon the current target before selecting a new career.</p><h3 class="mt">Are AI scores final?</h3><p>No. An authorized assessor must review and publish final results.</p>'),privacy:()=>heading('Privacy information','A transparent view of this preview.')+card('Demo data & local storage','<p>This frontend uses illustrative records and stores demo profile choices and learning progress in this browser. Login, registration, verification and password recovery send the supplied account details to the configured backend. Passwords and session tokens are not stored by this frontend. Other dashboard records remain illustrative. Use Account settings to reset locally saved choices.</p><p class="mt">The production privacy notice must be approved by the institution before real applicant data is collected.</p>')};shell((pages[route]||(()=>heading('Page not found','This page is not available.')+button('Back to overview','dashboard')))());document.title=`${titles[route]||navigation.find(n=>n[0]===route)?.[1]||'Workspace'} · VML NEXUS`;}
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.classList.remove('show'),4500)}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='menu')document.querySelector('.sidebar').classList.toggle('open');if(a==='notifications')toast('You’re up to date. Academic document review is in progress.');if(a==='career'){state.career=b.dataset.value;persist();location.hash='/career'}if(a==='slot'){state.slot=Number(b.dataset.value);render()}if(a==='book'){if(!state.prepared){toast('Prepare your career target before booking.');return}state.booked=true;persist();render();toast('Demo booking confirmed. No real slot has been reserved.')}if(a==='cancel'||a==='reschedule'){state.booked=false;persist();render();toast(a==='cancel'?'Demo booking cancelled. Your target remains prepared.':'Choose another example time.')}if(a==='reset'){localStorage.removeItem('nexus-demo');location.reload()}if(a==='catalogue')toast(`${b.dataset.value} management is a page preview. Editing requires API integration.`);if(a==='review')toast(`This ${b.dataset.value} is an illustrative record. No live data has been loaded.`)});
document.addEventListener('input',e=>{if(e.target.id==='career-search'){let count=0;document.querySelectorAll('[data-career]').forEach(el=>{el.hidden=!el.dataset.career.includes(e.target.value.toLowerCase());if(!el.hidden)count++});document.getElementById('no-careers').hidden=!!count}});
document.addEventListener('change',e=>{if(e.target.matches('[data-learning]')){state.learning[Number(e.target.dataset.learning)]=e.target.checked;persist();render()}});
document.addEventListener('submit',e=>{e.preventDefault();const id=e.target.id;if(id==='profile-form'){state.name=e.target.elements.name.value;state.discipline=e.target.elements.discipline.value;persist();render();toast('Demo profile saved in this browser.')}if(id==='upload-form')toast('File selected successfully. Upload is not connected to the backend.');if(id==='target-form'){if(!e.target.querySelector('[name="industries"]:checked')){toast('Select at least one industry.');return}state.prepared=true;persist();location.hash='/booking';toast('Demo target prepared. Your choices are now locked.')}if(id==='preflight-form'){state.started=true;location.hash='/assessment'}if(id==='answer-form'){state.messages.push(document.getElementById('answer').value);render();toast('Practice answer saved for this session.')}if(id==='admin-form')toast('Availability preview complete. No backend window has been published.');});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});render();initializeAuth(render);

