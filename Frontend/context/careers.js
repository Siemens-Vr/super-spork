import { previousDocumentIds } from './documents.js';

const activeStatuses = new Set(['DRAFT', 'PREPARED', 'IN_PROGRESS']);
const qualificationCategories = new Set(['BACHELOR', 'MASTER', 'PHD', 'DIPLOMA', 'SHORT_COURSE', 'INDUSTRY_CERTIFICATION', 'PROFESSIONAL_REGISTRATION']);

export function eligibleQualifications(documents) {
  const previous = previousDocumentIds(documents);
  return documents.filter(doc => qualificationCategories.has(doc.category) && doc.scanStatus === 'CLEAN' && doc.status !== 'REJECTED' && !previous.has(doc.id));
}

// Catalogue endpoints are paginated, including on installations with more than 100 records.
async function allPages(read) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await read(page);
    items.push(...result.data);
    if (items.length >= result.meta.total || !result.data.length) return items;
  }
}

export function createCareerStore({ client, onChange = () => {}, onUnauthorized = () => {}, onAbandoned = () => {} }) {
  const empty = () => ({ ownerId: null, status: 'idle', items: [], industries: [], companies: [], qualifications: [], activeTarget: null, selectedId: '', detail: null, frameworks: [], detailStatus: 'idle', detailError: '', draft: null, busy: false, uncertain: false, error: '', notice: '', recoveryTargetId: '', recoveryReason: '' });
  let state = empty(), generation = 0, detailVersion = 0;
  const current = (version, owner) => version === generation && owner === state.ownerId;
  const failed = error => {
    if (error.status === 401) onUnauthorized();
    return error.message || 'Unable to load career information. Please try again.';
  };
  const targets = () => allPages(page => client.assessmentTargets(page));
  function setActive(items) { state.activeTarget = items.find(target => activeStatuses.has(target.status)) || null; }
  function resetDraft(role) {
    const target = state.activeTarget;
    state.draft = target?.jobRoleId === role.id ? {
      jobRoleId: role.id, industryIds: target.industries.map(link => link.industryId),
      companyIds: target.companies.map(link => link.companyId), qualificationIds: target.qualifications.map(link => link.documentId),
      blueprintId: target.attempt?.blueprintId || defaultBlueprint(role),
    } : { jobRoleId: role.id, industryIds: role.industries.filter(link => link.industry.active).slice(0, 1).map(link => link.industry.id), companyIds: [], qualificationIds: [], blueprintId: defaultBlueprint(role) };
  }
  const defaultBlueprint = role => role.blueprints?.find(blueprint => blueprint.active && state.frameworks.some(framework => framework.id === blueprint.frameworkId && framework.scope === 'CORE'))?.id || '';
  return {
    snapshot: () => state,
    reset() { generation++; detailVersion++; state = empty(); },
    async load(ownerId, force = false) {
      if (!ownerId) return;
      if (state.ownerId !== ownerId) { generation++; detailVersion++; state = { ...empty(), ownerId }; }
      if (state.busy || (!force && state.status !== 'idle')) return;
      const version = ++generation;
      detailVersion++;
      state.status = 'loading'; state.error = ''; state.detailStatus = 'idle'; state.detail = null; state.draft = null;
      const results = await Promise.allSettled([
        allPages(page => client.careers(page)), allPages(page => client.industries(page)),
        allPages(page => client.companies(page)), targets(), client.eligibleQualifications(),
      ]);
      if (!current(version, ownerId)) return;
      const error = results.find(result => result.status === 'rejected');
      if (error) { state.status = 'error'; state.error = failed(error.reason); }
      else {
        [state.items, state.industries, state.companies] = results.slice(0, 3).map(result => result.value);
        setActive(results[3].value);
        state.qualifications = eligibleQualifications(results[4].value);
        state.status = 'ready'; state.uncertain = false;
        if (state.recoveryTargetId && results[3].value.some(target => target.id === state.recoveryTargetId && target.status === 'ABANDONED')) onAbandoned();
        state.recoveryTargetId = ''; state.recoveryReason = '';
      }
      onChange();
    },
    async select(id, force = false) {
      if (!id || state.status !== 'ready' || state.busy || (!force && state.selectedId === id && state.detailStatus !== 'idle')) return;
      const version = generation, owner = state.ownerId, request = ++detailVersion;
      state.selectedId = id; state.detail = null; state.frameworks = []; state.detailStatus = 'loading'; state.detailError = ''; state.error = ''; state.notice = ''; state.draft = null;
      try {
        const [role, frameworks] = await Promise.all([client.career(id), client.careerCompetencies(id)]);
        if (!current(version, owner) || request !== detailVersion) return;
        state.detail = role; state.frameworks = frameworks; state.detailStatus = 'ready'; resetDraft(role);
      } catch (error) {
        if (!current(version, owner) || request !== detailVersion) return;
        state.detailStatus = 'error'; state.detailError = failed(error);
      }
      onChange();
    },
    edit(field, values) {
      if (!state.draft || state.busy || (state.activeTarget && state.activeTarget.status !== 'DRAFT')) return;
      if (field === 'blueprintId') state.draft.blueprintId = values;
      else if (['industryIds', 'companyIds', 'qualificationIds'].includes(field)) state.draft[field] = [...new Set(values)];
      if (field === 'industryIds') {
        state.draft.companyIds = state.draft.companyIds.filter(id => state.companies.some(company => company.id === id && company.industries.some(link => values.includes(link.industryId))));
      }
      state.error = ''; state.notice = ''; onChange();
    },
    recovery(open) {
      if (state.busy || state.uncertain || state.activeTarget?.status !== 'PREPARED') return;
      state.recoveryTargetId = open ? state.activeTarget.id : '';
      state.recoveryReason = ''; state.error = ''; onChange();
    },
    recoveryReason(value) { if (!state.busy && !state.uncertain) state.recoveryReason = value; },
    async abandon(confirmed = false) {
      const target = state.activeTarget;
      if (state.status !== 'ready' || state.busy || state.uncertain || target?.status !== 'PREPARED' || state.recoveryTargetId !== target.id) return false;
      const reason = state.recoveryReason.trim();
      if (!confirmed || reason.length < 5 || reason.length > 1000) {
        state.error = 'Enter a reason of 5–1000 characters and confirm that you want to abandon this target.'; onChange(); return false;
      }
      const version = generation, owner = state.ownerId;
      state.busy = true; state.error = ''; state.notice = ''; onChange();
      try {
        const result = await client.abandonAssessmentTarget(target.id, reason);
        if (!current(version, owner)) return false;
        if (result?.id !== target.id || result.status !== 'ABANDONED') throw new Error('The server did not confirm target abandonment. Refresh career information before continuing.');
        state.activeTarget = null; state.selectedId = ''; state.detail = null; state.frameworks = []; state.draft = null; state.detailStatus = 'idle';
        state.recoveryTargetId = ''; state.recoveryReason = '';
        state.notice = 'Your target was abandoned and any scheduled bookings for it were cancelled. History has been preserved. Choose a career to build a new target.';
        onAbandoned();
        // Another tab may have created a new target after abandonment; restore the server's current state.
        try {
          const savedTargets = await targets();
          if (!current(version, owner)) return false;
          setActive(savedTargets); state.uncertain = false;
        } catch (error) {
          if (!current(version, owner)) return false;
          state.uncertain = true;
          state.error = `Your target was abandoned, but career information could not be refreshed. ${failed(error)} Refresh before creating another target.`;
        }
        return true;
      } catch (error) {
        if (!current(version, owner)) return false;
        state.error = failed(error);
        if (error.code === 'NETWORK_ERROR' || error.status >= 500 || error.status === 409 || !error.status) {
          state.uncertain = true;
          state.error += ' Refresh career information to confirm the saved target before continuing.';
        }
        return false;
      } finally {
        if (current(version, owner)) { state.busy = false; onChange(); }
      }
    },
    async prepare() {
      if (state.status !== 'ready' || state.busy || state.uncertain || !state.draft || state.detailStatus !== 'ready') return false;
      if (state.activeTarget && state.activeTarget.status !== 'DRAFT') return false;
      const input = structuredClone(state.draft);
      if (input.industryIds.length < 1 || input.industryIds.length > 3 || input.companyIds.length > 3 || input.qualificationIds.length > 10 || !input.blueprintId) {
        state.error = 'Choose 1–3 industries, up to 3 companies, up to 10 qualifications and an assessment blueprint.'; onChange(); return false;
      }
      const version = generation, owner = state.ownerId;
      state.busy = true; state.error = ''; state.notice = ''; onChange();
      try {
        // Reconcile first: a previous timed-out request or another tab may have saved a target.
        const savedTargets = await targets();
        if (!current(version, owner)) return false;
        setActive(savedTargets);
        if (state.activeTarget && state.activeTarget.status !== 'DRAFT') {
          state.notice = 'Your current target is already prepared. Its choices are locked.';
          state.detailStatus = 'idle'; state.uncertain = false;
          return false;
        }
        const { blueprintId, ...body } = input;
        const target = state.activeTarget ? await client.updateAssessmentTarget(state.activeTarget.id, body) : await client.createAssessmentTarget(body);
        if (!current(version, owner)) return false;
        state.activeTarget = target;
        const attempt = await client.prepareAssessmentTarget(target.id, blueprintId);
        if (!current(version, owner)) return false;
        state.activeTarget = { ...target, status: 'PREPARED', attempt };
        state.notice = 'Your career target has been prepared and saved. Its choices are now locked.';
        state.uncertain = false;
        return true;
      } catch (error) {
        if (!current(version, owner)) return false;
        state.error = failed(error);
        if (['NETWORK_ERROR', 'ACTIVE_TARGET_EXISTS', 'TARGET_LOCKED'].includes(error.code)) {
          state.uncertain = true;
          state.error += ' Refresh career information to confirm your saved target before continuing.';
        }
        return false;
      } finally {
        if (current(version, owner)) { state.busy = false; onChange(); }
      }
    },
  };
}
