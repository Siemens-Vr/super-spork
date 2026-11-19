import { enrollmentForm, matchingApplicants, sessionRoster, traineeCard, weekdays, workingHoursForm } from './training-delivery-views.js';
import { escapeHtml as e } from '../components/html.js';
import './training.css';
const when = value => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(new Date(value));
const option = (id, name, selected) => `<option value="${e(id)}" ${id === selected ? 'selected' : ''}>${e(name)}</option>`;
const localTime = value => value ? new Date(Date.parse(value) + 3 * 3600000).toISOString().slice(0,16) : '';
export function createTrainingWorkspace({ client, mode, onChange, onAuthError }) {
  let owner, version = 0, data = null, loading = false, busy = false, error = '', notice = '', search = '', page = 1, selected = '', editing = null, draft = {};
  let hours = [];
  const base = mode === 'admin' ? '/admin/training' : '/trainers/training';
  function reset() { hours = []; owner = null; version++; data = null; loading = false; busy = false; error = ''; notice = ''; editing = null; draft = {}; selected = ''; }
  async function load() {
    if (!owner || loading) return;
    const v = version; loading = true; onChange();
    try {
      const principal = await client.me();
      if (v !== version) return;
      if (principal.id !== owner) { reset(); onAuthError(); return; }
      const [result, workingHours] = await Promise.all([
        client.request(base + (mode === 'admin' ? `?${new URLSearchParams({search,page})}` : '')),
        mode === 'trainer' ? client.request(base + '/working-hours') : [],
      ]);
      if (v !== version) return;
      data = result; hours = workingHours; error = '';
    } catch (err) { if (v === version) { error = err.message; if (err.status === 401 || err.code === 'MFA_REQUIRED') onAuthError(); } }
    finally { if (v === version) { loading = false; onChange(); } }
  }
  function ensure(userId) { if (owner !== userId) { reset(); owner = userId; queueMicrotask(load); } }
  async function mutate(path, method, body) {
    if (busy) return;
    const v = version; busy = true; error = ''; notice = ''; onChange();
    try {
      const principal = await client.me();
      if (v !== version) return;
      if (principal.id !== owner) { reset(); onAuthError(); return; }
      await client.request(base + path, { method, body });
      if (v !== version) return;
      editing = null; draft = {}; notice = 'Changes saved.'; await load();
    } catch (err) { if (v === version) { error = err.message; if (err.status === 401 || err.code === 'MFA_REQUIRED') onAuthError(); } }
    finally { if (v === version) { busy = false; onChange(); } }
  }
  function adminView() {
    const { trainers, competencies, items, total } = data;
    return `<div class="page-heading"><div><div class="eyebrow">TRAINING OPERATIONS</div><h1>Connect skills with expertise</h1><p>Assign teaching skills, then match applicants’ published skill gaps to approved trainers.</p></div></div><div class="stats"><div class="stat"><div><strong>${trainers.length}</strong><small>Approved trainers</small></div></div><div class="stat"><div><strong>${total}</strong><small>Open learning items${search ? ' matching search' : ''}</small></div></div></div><section class="card training-section"><div class="card-head"><h2>Trainer teaching skills</h2></div><div class="card-body"><form data-training-form="skill" class="training-form"><fieldset ${busy ? 'disabled' : ''}><div class="form-grid"><div class="field"><label for="teaching-trainer">Trainer</label><select id="teaching-trainer" name="trainerId" required><option value="">Choose trainer</option>${trainers.map(t=>option(t.userId,t.user.legalName)).join('')}</select></div><div class="field"><label for="teaching-skill">Skill</label><select id="teaching-skill" name="competencyId" required><option value="">Choose skill</option>${competencies.map(c=>option(c.id,`${c.code} · ${c.name}`)).join('')}</select></div></div><button class="btn primary">Assign teaching skill</button></fieldset></form><div class="training-teachers">${trainers.map(t=>`<div><strong>${e(t.user.legalName)}</strong><p>${e(t.teachingSkills.map(s=>s.competency.name).join(' · ')||'No teaching skills assigned')}</p></div>`).join('') || '<p>No approved trainers yet. Approve trainer profiles first.</p>'}</div></div></section><section class="card"><div class="card-head"><h2>Applicant skill groups</h2></div><div class="card-body"><form data-training-form="search" class="toolbar"><input class="search" aria-label="Search applicant or skill" name="search" maxlength="100" placeholder="Search applicant or skill" value="${e(search)}"><button class="btn subtle">Search</button></form><p>Each row is one unfinished learning item. Assignment follows the skill, so one applicant can work with different trainers for different skills.</p><div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Skill to upskill</th><th>Assigned trainer</th></tr></thead><tbody>${items.map(i=>`<tr><td>${e(i.plan.attempt.target.applicant.legalName)}<small>${e(i.status.toLowerCase().replaceAll('_',' '))}</small></td><td><strong>${e(i.result.requirement.name)}</strong><p>${e(i.objective)}</p></td><td><form data-training-form="assign" data-item="${e(i.id)}"><fieldset ${busy ? 'disabled' : ''}><select aria-label="Trainer for ${e(i.plan.attempt.target.applicant.legalName)} · ${e(i.result.requirement.name)}" name="trainerId" required><option value="">Choose a skilled trainer</option>${trainers.filter(t=>t.teachingSkills.some(s=>s.enabled!==false&&s.competencyId===i.result.requirement.competencyId)).map(t=>option(t.userId,t.user.legalName,i.trainingAssignment?.trainerId)).join('')}</select><button class="btn subtle">${i.trainingAssignment ? 'Reassign' : 'Assign'}</button></fieldset></form>${enrollmentForm(i, trainers.find(t => t.userId === i.trainingAssignment?.trainerId), busy, when)}</td></tr>`).join('') || '<tr><td colspan="3">No open skill gaps found. Published assessment results create learning items.</td></tr>'}</tbody></table></div><div class="training-pagination"><button class="btn subtle" data-training-action="previous" ${page<=1||loading?'disabled':''}>Previous</button><span>Page ${page} · ${total} items</span><button class="btn subtle" data-training-action="next" ${page*50>=total||loading?'disabled':''}>Next</button></div></div></section>`;
  }
  function trainerView() {
    if (!selected || !data.some(g=>g.competencyId===selected)) selected = data[0]?.competencyId || '';
    const group = data.find(g=>g.competencyId===selected);
    const learners = new Set(data.flatMap(g=>g.assignments.map(a=>a.learningItem.plan.attempt.target.applicant.id)));
    const upcoming = data.flatMap(g=>g.sessions).filter(s=>!s.cancelledAt&&Date.parse(s.endsAt)>Date.now());
    const values = Object.keys(draft).length ? draft : editing || {};
    const field = (name,label,type='text',attrs='') => `<div class="field"><label for="training-${name}">${label}</label><input id="training-${name}" name="${name}" type="${type}" value="${e(values[name] || '')}" ${attrs}></div>`;
    return `<section class="hero training-hero"><div><div class="eyebrow">YOUR EXPERTISE. THEIR NEXT CHAPTER.</div><h1>Make room for progress.</h1><p>Plan your training dates and guide each skill group towards its next milestone.</p></div><span class="badge">Africa/Nairobi · EAT</span></section><div class="stats"><div class="stat"><div><strong>${data.length}</strong><small>Teaching skills</small></div></div><div class="stat"><div><strong>${learners.size}</strong><small>Assigned trainees</small></div></div><div class="stat"><div><strong>${upcoming.length}</strong><small>Upcoming sessions</small></div></div></div><section class="training-section"><div class="page-heading"><div><h2>Your skill groups</h2><p>Applicants are assigned by your administrator based on their learning needs.</p></div></div><div class="training-skill-grid">${data.map(g=>`<button class="training-skill ${selected===g.competencyId?'selected':''}" data-training-action="group" data-id="${e(g.competencyId)}" aria-pressed="${selected===g.competencyId}"><span class="eyebrow">${e(g.competency.code)}</span><strong>${e(g.competency.name)}</strong><small>${new Set(g.assignments.map(a=>a.learningItem.plan.attempt.target.applicant.id)).size} trainees · ${g.sessions.filter(s=>!s.cancelledAt&&Date.parse(s.endsAt)>Date.now()).length} upcoming sessions</small></button>`).join('') || '<div class="card card-body"><h3>Your teaching skills will appear here</h3><p>Ask an administrator to assign skills to your approved profile.</p></div>'}</div></section>${group ? `<div class="training-tools"><button class="btn subtle" data-training-action="toggle-skill" ${busy ? 'disabled' : ''}>${group.enabled === false ? 'Enable teaching skill' : 'Pause teaching skill'}</button></div><div class="training-columns"><section class="card"><div class="card-head"><h2>${editing?'Reschedule training':'Schedule training'}</h2></div><div class="card-body"><p><strong>${e(group.competency.name)}</strong></p><p>An administrator enrolls applicants after verifying payment. Times are in East Africa Time (UTC+03:00).</p><form data-training-form="session"><fieldset ${busy || (!editing && group.enabled === false)?'disabled':''}>${field('title','Session title','text','required minlength="3" maxlength="150"')}<div class="form-grid">${field('startsAt','Start (EAT)','datetime-local','required')}${field('endsAt','End (EAT)','datetime-local','required')}</div>${field('location','Venue or meeting link','text','required minlength="3" maxlength="300"')}${field('capacity','Capacity','number','required min="1" max="500"')}<button class="btn primary">${editing?'Save new dates':'Schedule session'}</button>${editing?'<button type="button" class="btn subtle" data-training-action="stop-edit">Cancel edit</button>':''}</fieldset></form></div></section><section class="card"><div class="card-head"><h2>Trainees · ${e(group.competency.name)}</h2></div><div class="card-body">${group.assignments.map(a => traineeCard(a, busy, when)).join('') || '<div class="empty"><h3>No trainees assigned yet</h3><p>Your administrator can assign applicants with this skill gap.</p></div>'}</div></section></div><section class="card training-section"><div class="card-head"><h2>Training dates · ${e(group.competency.name)}</h2></div><div class="card-body"><p>Latest 100 sessions for this group. Scheduling updates go to verified enrollees.</p>${[...group.sessions].sort((a,b)=>Date.parse(b.startsAt)-Date.parse(a.startsAt)).map(s=>`<article class="training-session"><div><span class="badge ${s.cancelledAt?'grey':Date.parse(s.endsAt)<Date.now()?'grey':'green'}">${s.cancelledAt?'Cancelled':Date.parse(s.endsAt)<Date.now()?'Past':'Scheduled'}</span><h3>${e(s.title)}</h3><p>${when(s.startsAt)} – ${when(s.endsAt)} EAT</p><p>${e(s.location)} · ${s.capacity} places</p>${sessionRoster(s, group.assignments, busy)}</div>${!s.cancelledAt&&Date.parse(s.startsAt)>Date.now()?`<div class="inline-actions"><button class="btn subtle" data-training-action="edit" data-id="${e(s.id)}" ${busy?'disabled':''}>Reschedule</button><button class="btn subtle" data-training-action="cancel" data-id="${e(s.id)}" ${busy?'disabled':''}>Cancel session</button></div>`:''}</article>`).join('') || '<div class="empty"><h3>Your calendar is clear</h3><p>Schedule your first training session for this skill.</p></div>'}</div></section>`:''}${group ? matchingApplicants(group) : ''}${workingHoursForm(hours, busy)}`;
  }
  function view() {
    return `<div class="training-workspace"><div class="training-tools"><button class="btn subtle" data-training-action="refresh" ${loading||busy?'disabled':''}>${loading?'Refreshing…':'Refresh'}</button></div>${error?`<p class="notice" role="alert">${e(error)}</p>`:''}${notice?`<p class="notice" role="status">${e(notice)}</p>`:''}${data ? mode==='admin'?adminView():trainerView() : `<div class="empty"><p role="status">${loading?'Loading your training workspace…':'Training data is unavailable. Try refreshing.'}</p></div>`}</div>`;
  }
  document.addEventListener('input',event=>{ const form=event.target.closest('[data-training-form="session"]');if(form)draft=Object.fromEntries(new FormData(form)); });
  document.addEventListener('submit',event=>{
    const form = event.target.closest('[data-training-form]');if (!form) return;event.preventDefault();if(busy)return;
    const body=Object.fromEntries(new FormData(form));
    if(form.dataset.trainingForm==='search'){search=body.search;page=1;void load();}
    if(form.dataset.trainingForm==='skill')void mutate('/skills','POST',body);
    if (form.dataset.trainingForm === 'enroll') void mutate('/enrollments', 'POST', { ...body, assignmentId: form.dataset.item });
    if (form.dataset.trainingForm === 'hours') {
      const windows = weekdays.map((_, day) => ({ day, start: body[`start-${day}`], end: body[`end-${day}`] }));
      void mutate('/working-hours', 'PUT', windows.filter(row => row.start || row.end));
    }
    if (form.dataset.trainingForm === 'progress') {
      if (body.progress !== 'COMPLETED' || confirm('Sign off on this training milestone? The applicant moves to mock interview scheduling after every milestone is signed off.')) {
        void mutate(`/assignments/${form.dataset.item}`, 'PATCH', body);
      }
    }
    if (form.dataset.trainingForm === 'attendance') void mutate(`/sessions/${form.dataset.session}/attendance/${form.dataset.item}`, 'PUT', body);
    if(form.dataset.trainingForm==='assign')void mutate('/assignments','POST',{trainerId:body.trainerId,learningItemId:form.dataset.item});
    if(form.dataset.trainingForm==='session'){
      draft=body;
      void mutate(editing?`/sessions/${editing.id}`:'/sessions',editing?'PATCH':'POST',{...body,competencyId:selected,startsAt:new Date(body.startsAt+':00+03:00').toISOString(),endsAt:new Date(body.endsAt+':00+03:00').toISOString(),capacity:Number(body.capacity)});
    }
  });
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-training-action]');if(!b||b.disabled||busy)return;
    const a=b.dataset.trainingAction;
    if(a==='refresh')void load();
    if (a === 'toggle-skill') {
      const group = data.find(row => row.competencyId === selected);
      if (group) void mutate(`/skills/${group.competencyId}`, 'PUT', { enabled: group.enabled === false });
    }
    if(a==='next'||a==='previous'){page+=a==='next'?1:-1;void load();}
    if(a==='group'){selected=b.dataset.id;editing=null;draft={};onChange();}
    if(a==='stop-edit'){editing=null;draft={};onChange();}
    if(a==='edit'){const session=data.flatMap(g=>g.sessions).find(s=>s.id===b.dataset.id);editing={...session,startsAt:localTime(session.startsAt),endsAt:localTime(session.endsAt)};draft={};onChange();document.getElementById('training-title')?.focus();}
    if(a==='cancel'&&confirm('Cancel this training session? Verified enrollees will receive an email.'))void mutate(`/sessions/${b.dataset.id}/cancel`,'POST',{});
  });
  return { ensure, reset, view };
}
