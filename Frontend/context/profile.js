// Account data stays in memory and is discarded when the signed-in user changes.
export function createProfileStore({ client, onChange = () => {}, onSaved = () => {}, onUnauthorized = () => {} }) {
  const empty = () => ({ ownerId: null, status: 'idle', data: null, onboarding: null, error: '', fieldErrors: {}, draft: null, saving: false, notice: '', onboardingError: '' });
  let state = empty();
  let version = 0;
  const errorText = error => error.status === 403 ? 'You do not have permission to access this applicant profile.' : error.message || 'Unable to load your profile. Please try again.';
  const current = (requestVersion, ownerId) => requestVersion === version && ownerId === state.ownerId;
  return {
    snapshot: () => state,
    reset() { version++; state = empty(); },
    async load(ownerId, force = false) {
      if (!ownerId || (!force && state.ownerId === ownerId && state.status !== 'idle')) return;
      const requestVersion = ++version;
      state = { ...empty(), ownerId, status: 'loading' };
      // The caller renders the synchronous loading state; only completion notifies.
      const [profile, onboarding] = await Promise.allSettled([client.applicantProfile(), client.applicantOnboarding()]);
      if (!current(requestVersion, ownerId)) return;
      const failure = profile.status === 'rejected' ? profile.reason : onboarding.status === 'rejected' ? onboarding.reason : null;
      if (failure) {
        state = { ...state, status: 'error', error: errorText(failure) };
        if (failure.status === 401) onUnauthorized();
      } else if (profile.value.id !== ownerId) {
        state = { ...state, status: 'error', error: 'Your session changed. Please sign in again.' };
        onUnauthorized();
      } else {
        state = { ...state, status: 'ready', data: profile.value, onboarding: onboarding.value };
      }
      onChange();
    },
    async save(input) {
      if (state.status !== 'ready' || state.saving) return false;
      const ownerId = state.ownerId;
      const requestVersion = ++version;
      // Whitelist editable fields. Identity, email and verification are server-owned.
      const body = Object.fromEntries(['legalName', 'phone', 'country', 'discipline'].map(key => [key, String(input[key] ?? '').trim()]));
      state = { ...state, saving: true, draft: body, error: '', fieldErrors: {}, notice: '', onboardingError: '' };
      onChange();
      try {
        const data = await client.updateApplicantProfile(body);
        if (!current(requestVersion, ownerId)) return false;
        if (data.id !== ownerId) throw new Error('Your session changed. Please sign in again.');
        state = { ...state, data, draft: null, notice: 'Your profile has been saved.' };
        onSaved(data);
        try {
          const onboarding = await client.applicantOnboarding();
          if (!current(requestVersion, ownerId)) return false;
          state = { ...state, onboarding };
        } catch (error) {
          if (!current(requestVersion, ownerId)) return false;
          state = { ...state, onboarding: null, onboardingError: 'Your profile was saved, but the checklist could not be refreshed. Reload the profile to try again.' };
          if (error.status === 401) onUnauthorized();
        }
        return true;
      } catch (error) {
        if (!current(requestVersion, ownerId)) return false;
        const fieldErrors = {};
        for (const detail of error.details || []) {
          if (['legalName', 'phone', 'country', 'discipline'].includes(detail.path)) fieldErrors[detail.path] = detail.message;
        }
        state = { ...state, error: errorText(error), fieldErrors };
        if (error.status === 401) onUnauthorized();
        return false;
      } finally {
        if (current(requestVersion, ownerId)) { state = { ...state, saving: false }; onChange(); }
      }
    },
  };
}
