import { escapeHtml as e } from '../components/html.js';

export const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const progressLabels = { IN_PROGRESS: 'In progress', NEEDS_ATTENTION: 'Needs attention', COMPLETED: 'Completed and signed off' };
const attendanceLabels = { PRESENT: 'Present', ABSENT: 'Absent', EXCUSED: 'Excused' };
const option = (key, label, current) => `<option value="${e(key)}" ${key === current ? 'selected' : ''}>${e(label)}</option>`;

export function enrollmentForm(item, trainer, busy, when) {
  const assigned = item.trainingAssignment;
  if (!assigned?.id) return '';
  const sessions = trainer?.teachingSkills.find(skill => skill.competencyId === item.result.requirement.competencyId)?.sessions || [];
  const enrolled = new Set(assigned.enrollments?.map(row => row.sessionId));
  const available = sessions.filter(session => !enrolled.has(session.id));
  return `<p>${enrolled.size} verified session enrollments</p>${available.length ? `<form data-training-form="enroll" data-item="${e(assigned.id)}">
    <fieldset ${busy ? 'disabled' : ''}>
      <label>Training session <select name="sessionId" required><option value="">Choose a session</option>${available.map(session => option(session.id, `${session.title} · ${when(session.startsAt)}`)).join('')}</select></label>
      <label>Payment reference <input name="reference" minlength="2" maxlength="150" required></label>
      <button class="btn subtle">Verify payment and enroll</button>
    </fieldset>
  </form>` : '<small>No upcoming sessions available for enrollment.</small>'}`;
}

export function workingHoursForm(hours, busy) {
  return `<section class="card training-section"><div class="card-head"><h2>Working hours</h2></div><div class="card-body">
    <p>Set a weekly teaching window in East Africa Time. Leave all days blank for flexible scheduling.</p>
    <form data-training-form="hours"><fieldset ${busy ? 'disabled' : ''}>
      <div class="form-grid">${weekdays.map((label, day) => {
        const window = hours.find(row => row.day === day);
        return `<div class="field"><strong>${label}</strong>
          <label>From <input type="time" name="start-${day}" aria-label="${label} start" value="${e(window?.start || '')}"></label>
          <label>Until <input type="time" name="end-${day}" aria-label="${label} end" value="${e(window?.end || '')}"></label>
        </div>`;
      }).join('')}</div><button class="btn primary">Save working hours</button>
    </fieldset></form>
  </div></section>`;
}

export function traineeCard(assignment, busy, when) {
  const { learningItem, enrollments = [] } = assignment;
  const { applicant } = learningItem.plan.attempt.target;
  const progress = assignment.progress || 'IN_PROGRESS';
  const profile = [applicant.profile?.discipline, applicant.profile?.educationLevel, applicant.profile?.professionalStatus].filter(Boolean);
  const active = enrollments.filter(({ session }) => !session.cancelledAt);
  const finished = active.some(({ session }) => Date.parse(session.endsAt) <= Date.now());
  return `<article class="training-trainee"><strong>${e(applicant.legalName)}</strong>
    <span class="badge">${e(progressLabels[progress])}</span>
    ${profile.length ? `<p>${e(profile.join(' · '))}</p>` : ''}
    <p>${e(learningItem.objective)}</p>
    ${enrollments.length ? `<ul>${enrollments.map(({ session, attendance }) =>
      `<li>${e(session.title)} · ${session.cancelledAt ? 'Cancelled' : e(attendanceLabels[attendance] || 'Attendance pending')}</li>`).join('')}</ul>` : ''}
    ${assignment.signedOffAt ? `<p>Signed off ${when(assignment.signedOffAt)} EAT</p><p>${e(assignment.performanceNotes)}</p>` : active.length ?
      `<form data-training-form="progress" data-item="${e(assignment.id)}"><fieldset ${busy ? 'disabled' : ''}>
        <label>Progress <select name="progress">${Object.entries(progressLabels).filter(([key]) => key !== 'COMPLETED' || finished).map(([key, label]) => option(key, label, progress)).join('')}</select></label>
        <label>Performance feedback <textarea name="performanceNotes" maxlength="3000" rows="3">${e(assignment.performanceNotes || '')}</textarea></label>
        <button class="btn subtle">Save progress</button>
      </fieldset></form>` : '<small>Awaiting verified enrollment.</small>'}
  </article>`;
}

export function sessionRoster(session, assignments, busy) {
  const roster = assignments.flatMap(assignment => {
    const enrollment = assignment.enrollments?.find(row => row.session.id === session.id);
    return enrollment ? [{ assignment, enrollment }] : [];
  });
  return `<details><summary>Verified roster (${roster.length})</summary>
    ${roster.map(({ assignment, enrollment }) => `<div class="training-trainee">
      <strong>${e(assignment.learningItem.plan.attempt.target.applicant.legalName)}</strong>
      ${!session.cancelledAt && Date.parse(session.startsAt) <= Date.now() ? `<form data-training-form="attendance" data-item="${e(assignment.id)}" data-session="${e(session.id)}">
        <fieldset ${busy ? 'disabled' : ''}>
          <label>Attendance <select name="attendance" required><option value="">Choose status</option>${Object.entries(attendanceLabels).map(([key, label]) => option(key, label, enrollment.attendance)).join('')}</select></label>
          <button class="btn subtle">Save attendance</button>
        </fieldset></form>` : ''}
    </div>`).join('') || '<p>No verified enrollments.</p>'}
  </details>`;
}

export function matchingApplicants(group) {
  if (group.enabled === false) return '';
  const matches = group.matchedApplicants || [];
  return `<section class="card training-section"><div class="card-head"><h2>Unassigned applicants · ${e(group.competency.name)}</h2></div>
    <div class="card-body"><p>Applicants with a published assessment gap in this skill. Administrators manage assignments.</p>
    ${matches.length ? `<ul>${matches.map(match => `<li>${e(match.initials)} · ${e(match.role)}</li>`).join('')}</ul>` : '<p>No unassigned applicants match this skill.</p>'}
    ${matches.length === 25 ? '<p>Showing up to 25 matches.</p>' : ''}</div>
  </section>`;
}
