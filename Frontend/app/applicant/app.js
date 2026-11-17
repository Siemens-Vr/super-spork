import { dashboard as renderDashboard } from './dashboard/dashboard.tsx';
import { profile as renderProfile } from './profile/profile.tsx';
import { documentPage as renderDocumentPage, upload as renderUpload } from './documents/documents.tsx';
import { explore as renderExplore, career as renderCareer, target as renderTarget } from './careers/careers.tsx';
import { booking as renderBooking, preflight as renderPreflight, assessment as renderAssessment } from './assessments/assessments.tsx';
import { results as renderResults } from './results/results.tsx';
import { learning as renderLearning } from './learning/learning.tsx';
import { settings as renderSettings } from './settings/settings.tsx';
import { escapeHtml as escape } from '../../components/html.js';
import { dashboardLayout } from '../../components/dashboard-layout/dashboard-layout.tsx';
import { icon } from '../../components/icon/icon.tsx';
import { getRoute } from '../../hooks/navigation.js';
import { authGate, authPage as auth, initializeAuth, currentUser } from '../../context/auth.js';

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
import { navigation } from './navigation';
let route='dashboard';
function shell(body){document.getElementById('app').innerHTML=dashboardLayout({role:'applicant', links:navigation, route, title:titles[route], name:currentUser()?.legalName||state.name, body, demo:true});}

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
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;if(a==='menu'){const open=document.querySelector('.sidebar').classList.toggle('open');b.setAttribute('aria-expanded',String(open));}if(a==='notifications')toast('You’re up to date. Academic document review is in progress.');if(a==='career'){state.career=b.dataset.value;persist();location.hash='/career'}if(a==='slot'){state.slot=Number(b.dataset.value);render()}if(a==='book'){if(!state.prepared){toast('Prepare your career target before booking.');return}state.booked=true;persist();render();toast('Demo booking confirmed. No real slot has been reserved.')}if(a==='cancel'||a==='reschedule'){state.booked=false;persist();render();toast(a==='cancel'?'Demo booking cancelled. Your target remains prepared.':'Choose another example time.')}if(a==='reset'){localStorage.removeItem('nexus-demo');location.reload()}if(a==='catalogue')toast(`${b.dataset.value} management is a page preview. Editing requires API integration.`);if(a==='review')toast(`This ${b.dataset.value} is an illustrative record. No live data has been loaded.`)});
document.addEventListener('input',e=>{if(e.target.id==='career-search'){let count=0;document.querySelectorAll('[data-career]').forEach(el=>{el.hidden=!el.dataset.career.includes(e.target.value.toLowerCase());if(!el.hidden)count++});document.getElementById('no-careers').hidden=!!count}});
document.addEventListener('change',e=>{if(e.target.matches('[data-learning]')){state.learning[Number(e.target.dataset.learning)]=e.target.checked;persist();render()}});
document.addEventListener('submit',e=>{e.preventDefault();const id=e.target.id;if(id==='profile-form'){state.name=e.target.elements.name.value;state.discipline=e.target.elements.discipline.value;persist();render();toast('Demo profile saved in this browser.')}if(id==='upload-form')toast('File selected successfully. Upload is not connected to the backend.');if(id==='target-form'){if(!e.target.querySelector('[name="industries"]:checked')){toast('Select at least one industry.');return}state.prepared=true;persist();location.hash='/booking';toast('Demo target prepared. Your choices are now locked.')}if(id==='preflight-form'){state.started=true;location.hash='/assessment'}if(id==='answer-form'){state.messages.push(document.getElementById('answer').value);render();toast('Practice answer saved for this session.')}if(id==='admin-form')toast('Availability preview complete. No backend window has been published.');});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});render();initializeAuth(render);

