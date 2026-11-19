import QRCode from 'qrcode';

export function recoveryCodeFile(codes) {
  return `VML NEXUS — Administrator recovery codes\n\nKeep this file private and store it somewhere safe.\nEach code can be used once instead of an authenticator code after setup is complete.\n\n${codes.join('\n')}\n`;
}

export const transitions = Object.freeze({
  UPLOADED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['ADDITIONAL_EVIDENCE_REQUIRED', 'AUTHENTICATED', 'REJECTED', 'DISPUTED'],
  ADDITIONAL_EVIDENCE_REQUIRED: ['UNDER_REVIEW', 'REJECTED'],
  AUTHENTICATED: ['UNDER_REVIEW', 'DISPUTED'],
  REJECTED: ['UNDER_REVIEW', 'DISPUTED'],
  DISPUTED: ['UNDER_REVIEW', 'REJECTED'],
});
export const previousIds = items => {
  const previous = new Set(items.map(item => item.replacesId).filter(Boolean));
  for (const item of items) if (item.qualificationId && previous.has(item.qualificationId)) previous.add(item.id);
  return previous;
};
export function createAdminStore({ client, onChange = () => {} }) {
  const empty = () => ({ auth: 'loading', user: null, setup: null, mfaMethod: 'authenticator', emailSent: false, resendAt: 0, authError: '', authNotice: '', busy: false, page: '', data: null, loading: false, error: '', notice: '', fieldErrors: {}, mutationUncertain: false });
  let state = empty(), generation = 0, pageVersion = 0;
  const text = error => error.code === 'ORIGIN_REJECTED' ? 'This admin address is not allowed by the API. Add the admin origin to the backend CORS_ORIGINS setting.' : error.message || 'Unable to complete the request. Please try again.';
  const current = (version, owner) => generation === version && state.user?.id === owner;
  function privateReset() { pageVersion++; state = { ...state, data: null, page: '', loading: false, error: '', notice: '', fieldErrors: {} }; }
  function handle(error) {
    if (error.code === 'MFA_REQUIRED') {
      generation++; privateReset(); state.auth = 'mfa'; state.setup = null; state.busy = false;
      state.authNotice = 'Confirm your authenticator code to continue. Your previous action was not submitted.';
      onChange('auth'); return true;
    }
    if (error.status === 401 && error.code !== 'MFA_INVALID') {
      generation++; state = { ...empty(), auth: 'login', authNotice: 'Your session ended. Sign in to continue.' }; client.clear();
      onChange('auth'); return true;
    }
    return false;
  }
  async function principal() {
    const user = await client.me();
    state.user = user;
    if (!user.roles?.includes('ADMIN')) { state.auth = 'denied'; state.authError = 'This workspace is for administrators. Your account does not have administrator access.'; return false; }
    if (!user.emailVerifiedAt) { state.auth = 'denied'; state.authError = 'Your administrator email must be verified before opening this workspace. Contact your institution operator.'; return false; }
    return true;
  }
  async function probe() {
    const permissions = state.user?.permissions || [];
    if (permissions.includes('users.manage')) await client.applicants({ limit: 1 });
    else if (permissions.includes('documents.review')) await client.reviewDocuments({ limit: 1 });
    else if (permissions.includes('assessments.review')) await client.assessmentReviews({ limit: 1 });
    else if (permissions.includes('trainers.manage')) await client.trainers({limit:1});
    else if (permissions.includes('assessments.manage')) await client.availability({ limit: 1 });
    else { state.auth = 'denied'; state.authError = 'Your account has no workspace management permissions. Contact your institution operator.'; return; }
    state.auth = 'ready'; state.setup = null; state.authError = ''; state.authNotice = '';
  }
  const store = {
    snapshot: () => state,
    can: permission => !!state.user?.permissions?.includes(permission),
    setMfaMethod(method) {
      if (state.auth !== 'mfa' || state.busy || !['email', 'authenticator'].includes(method)) return;
      state.mfaMethod = method; state.setup = null; state.authError = ''; state.authNotice = ''; onChange('auth');
    },
    async boot() {
      const version = ++generation; privateReset(); state.auth = 'loading'; state.authError = ''; state.busy = false; onChange('auth');
      try {
        const user = await client.me();
        if (version !== generation) return;
        state.user = user;
        if (!user.roles?.includes('ADMIN') || !user.emailVerifiedAt) {
          state.auth = 'denied'; state.authError = 'A verified administrator account is required for this workspace.';
        } else await probe();
      } catch (error) {
        if (version !== generation) return;
        if (error.status === 401) { state = { ...empty(), auth: 'login' }; client.clear(); }
        else if (!handle(error)) { state.auth = 'error'; state.authError = text(error); }
      }
      if (version === generation) onChange('auth');
    },
    async authAction(action, input = {}) {
      if (state.busy) return false;
      const version = ++generation;
      state.busy = true; state.authError = ''; onChange('auth-state');
      try {
        if (action === 'login') {
          await client.login({ email: input.email.trim().toLowerCase(), password: input.password });
          if (version !== generation) return false;
          privateReset(); state.setup = null;
          if (await principal()) await probe();
        } else if (action === 'mfa') {
          if (state.mfaMethod === 'email') await client.verifyEmailMfa(input.code.trim());
          else await client.verifyMfa(input.code.trim());
          if (version !== generation) return false;
          await probe();
        } else if (action === 'setup') {
          const setup = await client.setupMfa();
          if (version !== generation) return false;
          if (!setup.provisioningUri?.startsWith('otpauth://totp/') || !Array.isArray(setup.recoveryCodes)) throw new Error('The authenticator setup response could not be read. Try again.');
          let qrCode;
          try { qrCode = await QRCode.toDataURL(setup.provisioningUri, { width: 240, margin: 2 }); } catch { /* The manual key remains available. */ }
          if (version !== generation) return false;
          state.setup = { ...setup, qrCode }; onChange('auth');
        } else if (action === 'email-send') {
          if (Date.now() < state.resendAt) throw new Error('Please wait before requesting another email code.');
          const result = await client.sendEmailMfa();
          if (version !== generation) return false;
          state.emailSent = true; state.resendAt = Date.now() + result.resendAfterSeconds * 1000;
          state.authNotice = `A code has been queued for your verified email. It expires in ${Math.ceil(result.expiresInSeconds / 60)} minutes. Check your inbox and spam folder.`;
          onChange('auth');
        } else if (action === 'reauthenticate') {
          await client.reauthenticate(input.password);
          if (version !== generation) return false;
          state.authNotice = 'Identity confirmed. You can now set up your authenticator.';
          onChange('auth');
        } else if (action === 'forgot') {
          const result = await client.forgot({ email: input.email.trim().toLowerCase() });
          if (version !== generation) return false;
          state.authNotice = result.message; return true;
        } else if (action === 'reset') {
          if (input.password !== input.passwordConfirmation) throw new Error('The passwords do not match.');
          const result = await client.reset({ email: input.email.trim().toLowerCase(), code: input.code.trim(), password: input.password, passwordConfirmation: input.passwordConfirmation });
          if (version !== generation) return false;
          state.authNotice = result.message; state.user = null; state.setup = null; client.clear(); privateReset(); state.auth = 'login'; return true;
        }
        if (version === generation && state.auth === 'ready') onChange('auth');
        return true;
      } catch (error) {
        if (version !== generation) return false;
        // Invalid MFA is a form validation error, not an expired cookie session.
        if (error.code === 'MFA_REQUIRED') { privateReset(); state.auth = 'mfa'; state.setup = null; onChange('auth'); }
        else if (error.code === 'MFA_ALREADY_ENABLED') { state.setup = null; state.authNotice = 'Your authenticator is already configured. Enter a current code or recovery code.'; onChange('auth'); }
        else if (error.status === 401 && error.code !== 'MFA_INVALID' && action !== 'login') handle(error);
        else state.authError = text(error);
        return false;
      } finally { if (version === generation) { state.busy = false; onChange('auth-state'); } }
    },
    async logout() {
      if (state.busy) return;
      const version = ++generation;
      state.busy = true; state.error = ''; state.authError = ''; onChange('mutation-state');
      try { await client.logout(); }
      catch (error) {
        if (version !== generation) return;
        if (error.status !== 401) { state.error = text(error); state.authError = text(error); state.busy = false; onChange('mutation-state'); return; }
      }
      if (version !== generation) return;
      client.clear(); state = { ...empty(), auth: 'login' }; onChange('auth');
    },
    async load(page, filters = {}, force = false) {
      const key = `${page}:${JSON.stringify(filters)}`;
      if (state.auth !== 'ready' || (!force && state.page === key)) return;
      const version = generation, owner = state.user.id, request = ++pageVersion;
      state.page = key; state.loading = true; state.data = null; state.error = ''; state.fieldErrors = {}; onChange('page');
      try {
        let data;
        if (page === 'overview') {
          const hasUsers = store.can('users.manage'), hasDocs = store.can('documents.review');
          const [applicants, active, suspended, documents] = await Promise.all([
            hasUsers ? client.applicants({ page: 1, limit: 5 }) : null,
            hasUsers ? client.applicants({ status: 'ACTIVE', limit: 1 }) : null,
            hasUsers ? client.applicants({ status: 'SUSPENDED', limit: 1 }) : null,
            hasDocs ? client.reviewDocuments({ page: 1, limit: 5 }) : null,
          ]);
          data = { applicants, active, suspended, documents };
        } else if (page === 'trainers') data=await client.trainers(filters);
        else if (page==='trainer')data=await client.trainer(filters.id);
        else if (page==='trainer-invitations')data=await client.trainerInvitations(filters);
        else if (page === 'applicants') data = await client.applicants(filters);
        else if (page === 'availability') {
          const [windows, blueprints] = await Promise.all([(async () => {
            const rows = [];
            for (let page = 1; ; page++) {
              const result = await client.availability({ page, limit: 100 });
              if (!current(version, owner) || request !== pageVersion) return { data: [] };
              rows.push(...result.data);
              if (result.data.length < 100) return { data: rows };
            }
          })(), (async () => {
            const rows = [];
            for (let page = 1; ; page++) { const result = await client.blueprints({ page, limit: 100 }); rows.push(...result.data); if (result.data.length < 100) return rows; }
          })()]);
          data = { windows, blueprints };
        }
        else if (page === 'assessment-reviews') data = await client.assessmentReviews(filters);
        else if (page === 'assessment-review') data = await client.assessmentReview(filters.id);
        else if (page === 'bookings') data = await client.adminBookings(filters);
        else if (page === 'booking') data = await client.adminBooking(filters.id);
        else if (page === 'documents') data = await client.reviewDocuments(filters);
        else if (page === 'applicant') data = await client.applicant(filters.id);
        else if (page === 'document') {
          const document = await client.reviewDocument(filters.id);
          const applicant = store.can('users.manage') ? await client.applicant(document.applicantId) : null;
          data = { document, applicant, previous: applicant ? previousIds(applicant.documents).has(document.id) : false };
        } else data = {};
        if (!current(version, owner) || request !== pageVersion) return;
        state.data = data; state.mutationUncertain = false;
      } catch (error) {
        if (!current(version, owner) || request !== pageVersion) return;
        if (!handle(error)) state.error = text(error);
      } finally { if (current(version, owner) && request === pageVersion) { state.loading = false; onChange('page'); } }
    },
    clearNotice() { state.notice = ''; },
    async mutate(kind, id, input) {
      if (state.auth !== 'ready' || state.busy || state.mutationUncertain) return false;
      const version = generation, owner = state.user.id;
      state.busy = true; state.error = ''; state.notice = ''; state.fieldErrors = {}; onChange('mutation-state');
      try {
        if (['invite-trainer','revoke-trainer-invitation','review-trainer'].includes(kind)) {
          if (!store.can('trainers.manage'))throw new Error('Trainer management access is required.');
          if(kind==='invite-trainer')await client.inviteTrainer(input.email.trim().toLowerCase());
          else if(kind==='revoke-trainer-invitation')await client.revokeTrainerInvitation(id);
          else {if(input.outcome==='APPROVED'&&!input.evidenceReference?.trim())throw new Error('Record an independent evidence reference before approval.');await client.reviewTrainer(id,{version:Number(input.version),outcome:input.outcome,reason:input.reason.trim(),...(input.evidenceReference?.trim()?{evidenceReference:input.evidenceReference.trim()}:{})});}
        } else if (kind === 'review') {
          if (!transitions[state.data?.document?.status]?.includes(input.outcome)) throw new Error('Refresh this document before choosing a review outcome.');
          if (input.outcome === 'AUTHENTICATED' && (input.method === 'AI_ASSISTED' || !input.evidenceReference?.trim())) throw new Error('Authentication requires an independent review method and evidence reference.');
          const body = { outcome: input.outcome, method: input.method, reason: input.reason.trim() };
          for (const key of ['internalNotes', 'evidenceReference']) if (input[key]?.trim()) body[key] = input[key].trim();
          await client.review(id, body);
        } else if (kind === 'evidence') {
          await client.evidence(id, { note: input.note.trim(), ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}) });
        } else if (kind === 'status') await client.accountStatus(id, { status: input.status, reason: input.reason.trim() });
        else if (kind === 'approve-assessment') {
          if (!store.can('assessments.review') || !state.data?.evaluation) throw new Error('Assessment review access and a completed evaluation are required.');
          const results = state.data.evaluation.map(r => ({ requirementId: r.requirementId, score: Number(input[`score-${r.requirementId}`]), evidence: input[`evidence-${r.requirementId}`]?.trim() || '' }));
          await client.approveAssessment(id, { results }, `review-${id}-${crypto.randomUUID()}`);
        }
        else if (kind === 'publish-availability') {
          if (!store.can('assessments.manage')) throw new Error('Assessment management access is required.');
          const offset = input.timezone === 'UTC' ? 'Z' : '+03:00';
          const body = { blueprintId: input.blueprintId, startsAt: new Date(input.startsAt + offset).toISOString(), endsAt: new Date(input.endsAt + offset).toISOString(), timezone: input.timezone };
          for (const key of ['capacity', 'minNoticeMinutes', 'maxHorizonDays', 'cancellationNoticeMinutes', 'rescheduleLimit']) body[key] = Number(input[key]);
          if (new Date(body.endsAt) <= new Date(body.startsAt)) throw new Error('End must follow start.');
          await client.publishAvailability(body);
        } else if (kind === 'update-delivery') {
          if (!store.can('assessments.manage')) throw new Error('Assessment management access is required.');
          const body = { onDemandEnabled: input.onDemandEnabled === 'true', onDemandCapacity: Number(input.onDemandCapacity), requiresSupervision: input.requiresSupervision === 'true', requiresEquipment: input.requiresEquipment === 'true' };
          if (body.onDemandEnabled && (body.requiresSupervision || body.requiresEquipment)) throw new Error('Assessments requiring supervision or equipment must use scheduled bookings.');
          await client.updateDelivery(id, body);
        } else if (kind === 'update-availability') {
          if (!store.can('assessments.manage')) throw new Error('Assessment management access is required.');
          await client.updateAvailability(id, { active: input.active === 'true', capacity: Number(input.capacity) });
        } else if (kind === 'cancel-booking') {
          if (!store.can('assessments.manage')) throw new Error('Assessment management access is required.');
          await client.cancelAdminBooking(id, input.reason.trim());
        }
        else throw new Error('Unknown action.');
        if (!current(version, owner)) return false;
        state.notice = ({ 'update-delivery':'Assessment delivery settings saved. Existing reservations are retained.', 'invite-trainer':'Trainer invitation queued for delivery.', 'revoke-trainer-invitation':'Trainer invitation revoked.', 'review-trainer':'Trainer decision recorded and notification queued.', 'approve-assessment': 'Final assessment results and learning plan published.', 'publish-availability': 'Availability published. Eligible applicants can book its available places.', 'update-availability': 'Availability updated. Existing bookings are retained.', 'cancel-booking': 'Booking cancelled. The applicant notification has been queued.' })[kind] || (kind === 'review' ? 'Review saved. The applicant will receive the review update.' : kind === 'evidence' ? 'Evidence added to the verification record.' : 'Account status updated. Existing applicant sessions have been revoked.');
        return true;
      } catch (error) {
        if (!current(version, owner)) return false;
        if (!handle(error)) {
          state.error = text(error);
          if (['NETWORK_ERROR','TRAINER_VERSION_CONFLICT'].includes(error.code)) { state.mutationUncertain = true; state.error += ' The outcome could not be confirmed. Refresh the record before submitting again.'; }
          for (const detail of error.details || []) state.fieldErrors[detail.path] = detail.message;
        }
        return false;
      } finally { if (current(version, owner)) { state.busy = false; onChange('mutation-state'); } }
    },
    async download(id) {
      const version = generation, owner = state.user?.id;
      try { const result = await client.download(id); return current(version, owner) && state.auth === 'ready' ? result : null; }
      catch (error) { if (current(version, owner) && !handle(error)) throw error; return null; }
    },
  };
  return store;
}
