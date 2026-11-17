import styles from "./profile.module.css";
import type { PageContext } from "../page-context";

export function profile({ profileState, escape, heading, card, badge, button }: PageContext): string {
  const wrap = (body: string) => `<section class="${styles.page}">${heading("Your profile", "A little about you. A better path forward.")}${body}</section>`;
  const retry = '<button type="button" class="btn subtle" data-profile-action="retry">Try again</button>';
  if (profileState.status === 'idle' || profileState.status === 'loading') {
    return wrap(card('Your profile', '<p role="status">Loading your profile…</p>'));
  }
  if (profileState.status === 'error' || !profileState.data) {
    return wrap(card('Unable to load your profile', `<p role="alert">${escape(profileState.error)}</p>${retry}`));
  }
  const { data, draft, saving, fieldErrors, onboarding } = profileState;
  const values = draft || { legalName: data.legalName, phone: data.phone || '', country: data.profile?.country || '', discipline: data.profile?.discipline || '' };
  const field = (label: string, name: string, type: string, attrs: string) => `<div class="field"><label for="profile-${name}">${label}</label><input id="profile-${name}" name="${name}" type="${type}" value="${escape(values[name as keyof typeof values])}" aria-describedby="profile-error-${name}" ${fieldErrors[name] ? 'aria-invalid="true"' : ''} ${attrs} required><span class="field-error" id="profile-error-${name}">${escape(fieldErrors[name] || '')}</span></div>`;
  const countries: Record<string, string> = { KE: 'Kenya', UG: 'Uganda', TZ: 'Tanzania', RW: 'Rwanda' };
  if (values.country && !Object.hasOwn(countries, values.country)) countries[values.country] = values.country;
  const country = `<div class="field"><label for="profile-country">Country</label><select id="profile-country" name="country" required aria-describedby="profile-error-country" ${fieldErrors.country ? 'aria-invalid="true"' : ''}><option value="">Select country</option>${Object.entries(countries).map(([code, label]) => `<option value="${escape(code)}" ${code === values.country ? 'selected' : ''}>${escape(label)}</option>`).join('')}</select><span class="field-error" id="profile-error-country">${escape(fieldErrors.country || '')}</span></div>`;
  const form = `${profileState.notice ? `<p class="notice" role="status">${escape(profileState.notice)}</p>` : ''}${profileState.error ? `<p class="${styles.error}" role="alert">${escape(profileState.error)}</p>` : ''}<form id="profile-form" aria-busy="${saving}"><fieldset class="${styles.fields}" ${saving ? 'disabled' : ''}><div class="form-grid">${field('Full legal name', 'legalName', 'text', 'autocomplete="name" minlength="3" maxlength="150"')}<div class="field"><label for="profile-email">Email address</label><input id="profile-email" type="email" value="${escape(data.email)}" readonly aria-describedby="profile-email-help"><small id="profile-email-help">Your sign-in email cannot be changed here.</small></div>${field('Phone number', 'phone', 'tel', 'autocomplete="tel" maxlength="32"')}${country}<div class="full">${field('Discipline / course', 'discipline', 'text', 'minlength="2" maxlength="150"')}</div></div><button type="submit" class="btn primary">${saving ? 'Saving…' : 'Save profile'}</button></fieldset></form>`;
  let checklist: string;
  if (!onboarding) {
    checklist = `<p role="status">${escape(profileState.onboardingError || 'Checklist unavailable. Please reload your profile.')}</p><button type="button" class="btn subtle" data-profile-action="retry">Reload profile</button>`;
  } else {
    const academic = onboarding.documents.filter(doc => !['NATIONAL_ID', 'PASSPORT'].includes(doc.category));
    const needsAttention = academic.some(doc => ['INFECTED', 'FAILED'].includes(doc.scanStatus) || ['REJECTED', 'ADDITIONAL_EVIDENCE_REQUIRED', 'DISPUTED'].includes(doc.status));
    const authenticated = academic.length > 0 && academic.every(doc => doc.status === 'AUTHENTICATED' && doc.scanStatus === 'CLEAN');
    const academicBadge = needsAttention ? badge('Needs attention', 'amber') : authenticated ? badge('Authenticated', 'green') : academic.length ? badge('Pending review', 'amber') : badge('Not submitted');
    checklist = `<div class="detail-list"><div>Email verified ${onboarding.emailVerified ? badge('Verified', 'green') : badge('Not verified', 'amber')}</div><div>Profile information ${onboarding.profileComplete ? badge('Complete', 'green') : badge('Incomplete', 'amber')}</div><div>Identity submission ${onboarding.identitySubmitted ? badge('Submitted', 'green') : badge('Not submitted')}</div><div>Academic & supporting documents ${academicBadge}</div></div>`;
  }
  return wrap(`<div class="grid">${card('Personal & academic information', form)}${card('Your onboarding checklist', `${checklist}<div class="notice">Qualification and institution details belong to your document uploads.</div>${button('Manage documents', 'documents', 'subtle')}`)}</div>`);
}
