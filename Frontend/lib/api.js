import { config } from './config.js';

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR', details = []) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

export function createApi({ base = config.apiBase, fetcher = globalThis.fetch } = {}) {
  let csrf;
  let csrfPending;
  let collectionGeneration = 0;
  async function send(path, options, responseType = 'json', timeoutMs = 20000) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        ...options, credentials: 'include', signal: AbortSignal.timeout(responseType === 'blob' || options.body instanceof FormData ? 120000 : timeoutMs),
      });
    } catch {
      throw new ApiError('Unable to reach the server. Check your connection and try again.');
    }
    if (response.status === 204) return null;
    if (response.ok && responseType === 'blob') {
      const blob = await response.blob();
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(blob.type)) throw new ApiError('The server returned an unexpected file type.', response.status);
      return { blob };
    }
    let body;
    try { body = await response.json(); }
    catch { throw new ApiError('The server returned an unexpected response. Try again.', response.status); }
    if (!response.ok) {
      const error = body.error || {};
      throw new ApiError(error.message || 'The request could not be completed.', response.status, error.code, error.details);
    }
    if (body.data?.csrfToken) csrf = body.data.csrfToken;
    return responseType === 'envelope' ? { data: body.data, meta: body.meta } : body.data;
  }
  async function token() {
    if (csrf) return csrf;
    csrfPending ??= send('/auth/csrf', { method: 'GET' }).then(data => {
      if (!data?.csrfToken) throw new ApiError('Unable to initialize a secure session. Try again.');
      return data.csrfToken;
    }).finally(() => { csrfPending = undefined; });
    return csrfPending;
  }
  async function request(path, { method = 'GET', body, responseType = 'json', idempotencyKey, timeoutMs = 20000 } = {}) {
    const headers = { Accept: 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (method !== 'GET') headers['X-CSRF-Token'] = await token();
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
    const options = { method, headers, ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}) };
    try { return await send(path, options, responseType, timeoutMs); }
    catch (error) {
      // Only a CSRF rejection is retried; failed login/register requests are never replayed.
      if (error.code !== 'CSRF_INVALID') throw error;
      csrf = undefined;
      options.headers['X-CSRF-Token'] = await token();
      return send(path, options, responseType, timeoutMs);
    }
  }
  async function documentPages(identity = false, eligibleForAssessment = false) {
    const generation = collectionGeneration, items = new Map(), cursors = new Set();
    let cursor, summary;
    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);
      if (eligibleForAssessment) params.set('eligibleForAssessment', 'true');
      const page = await request(`${identity ? '/identity/documents' : '/documents'}?${params}`, { responseType: 'envelope' });
      if (generation !== collectionGeneration) throw new ApiError('Your session changed. Reload your documents.', 401, 'SESSION_CHANGED');
      if (!Array.isArray(page.data) || typeof page.meta?.hasMore !== 'boolean' || !page.meta.summary) throw new ApiError('The server returned an incomplete document list. Please refresh.');
      summary ??= page.meta.summary;
      for (const doc of page.data) items.set(doc.id, doc);
      cursor = page.meta.hasMore ? page.meta.nextCursor : null;
      if (page.meta.hasMore && (!cursor || cursors.has(cursor))) throw new ApiError('The document list could not advance. Please refresh.');
      cursors.add(cursor);
    } while (cursor);
    return { items: [...items.values()], summary };
  }
  return {
    request,
    clear() { csrf = undefined; collectionGeneration++; },
    me: () => request('/auth/me'),
    bookingEligibility: () => request('/assessments/eligibility'),
    reserveOnDemand: (blueprintId, key) => request('/assessments/on-demand', { method: 'POST', body: { blueprintId }, idempotencyKey: key }),
    bookingSlots: blueprintId => request(`/assessments/available-slots?${new URLSearchParams({ blueprintId })}`),
    bookings: (page = 1) => request(`/assessments/bookings?${new URLSearchParams({ page, limit: '100' })}`, { responseType: 'envelope' }),
    bookAssessment: (slotId, key) => request('/assessments/bookings', { method: 'POST', body: { slotId }, idempotencyKey: key }),
    cancelBooking: (id, reason) => request(`/assessments/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } }),
    rescheduleBooking: (id, slotId, reason, key) => request(`/assessments/bookings/${encodeURIComponent(id)}/reschedule`, { method: 'POST', body: { slotId, reason }, idempotencyKey: key }),
    bookingPreflight: id => request(`/assessments/${encodeURIComponent(id)}/preflight`),
    assessmentSession: id => request(`/assessment-sessions/${encodeURIComponent(id)}`),
    startAssessment: (id, body) => request(`/assessments/${encodeURIComponent(id)}/start`, { method: 'POST', body, timeoutMs: 150000 }),
    assessmentResponse: (id, body, key) => request(`/assessment-sessions/${encodeURIComponent(id)}/responses`, { method: 'POST', body, idempotencyKey: key, timeoutMs: 150000 }),
    resumeAssessment: (id, devices) => request(`/assessment-sessions/${encodeURIComponent(id)}/resume`, { method: 'POST', body: { devices }, timeoutMs: 150000 }),
    assessmentResults: id => request(`/assessment-sessions/${encodeURIComponent(id)}/results`),
    assessmentTranscript: (id, body) => request(`/assessment-sessions/${encodeURIComponent(id)}/audio/transcribe`, { method: 'POST', body }),
    assessmentAudioTranscript: (id, audio) => {
      const body = new FormData(); body.set('audio', audio, 'response.wav');
      return request(`/assessment-sessions/${encodeURIComponent(id)}/audio/transcribe`, { method: 'POST', body });
    },
    assessmentEvent: (id, kind) => request(`/assessment-sessions/${encodeURIComponent(id)}/events`, { method: 'POST', body: { kind } }),
    assessmentAttempt: id => request(`/assessments/attempts/${encodeURIComponent(id)}`),
    learningPlan: id => request(`/assessments/learning-plans/${encodeURIComponent(id)}`),
    learningProgress: (plan, item, status) => request(`/assessments/learning-plans/${encodeURIComponent(plan)}/items/${encodeURIComponent(item)}`, { method: 'PATCH', body: { status } }),
    careers: (page = 1) => request(`/careers?${new URLSearchParams({ page, limit: '100' })}`, { responseType: 'envelope' }),
    career: id => request(`/careers/${encodeURIComponent(id)}`),
    careerCompetencies: id => request(`/careers/${encodeURIComponent(id)}/competencies`),
    industries: (page = 1) => request(`/industries?${new URLSearchParams({ page, limit: '100' })}`, { responseType: 'envelope' }),
    companies: (page = 1) => request(`/companies?${new URLSearchParams({ page, limit: '100' })}`, { responseType: 'envelope' }),
    assessmentTargets: (page = 1) => request(`/assessments/targets?${new URLSearchParams({ page, limit: '100' })}`, { responseType: 'envelope' }),
    createAssessmentTarget: body => request('/assessments/targets', { method: 'POST', body }),
    updateAssessmentTarget: (id, body) => request(`/assessments/targets/${encodeURIComponent(id)}`, { method: 'PUT', body }),
    prepareAssessmentTarget: (id, blueprintId) => request(`/assessments/targets/${encodeURIComponent(id)}/prepare`, { method: 'POST', body: { blueprintId } }),
    abandonAssessmentTarget: (id, reason) => request(`/assessments/targets/${encodeURIComponent(id)}/abandon`, { method: 'POST', body: { reason } }),
    documentRequirements: () => request('/documents/requirements'),
    institutions: search => request(`/institutions?${new URLSearchParams({ search, limit: '20' })}`),
    documents: async () => (await documentPages()).items,
    identityDocuments: async () => (await documentPages(true)).items,
    eligibleQualifications: async () => (await documentPages(false, true)).items,
    documentCollection: async () => {
      const [identity, academic] = await Promise.all([documentPages(true), documentPages()]);
      return { items: [...identity.items, ...academic.items], summary: {
        current: identity.summary.current + academic.summary.current,
        authenticated: identity.summary.authenticated + academic.summary.authenticated,
      } };
    },
    document: id => request(`/documents/${encodeURIComponent(id)}`),
    documentHistory: id => request(`/documents/${encodeURIComponent(id)}/verification`),
    uploadDocument: (body, identity = false, replacesId) => request(`${identity ? '/identity/documents' : '/documents'}${replacesId ? `/${encodeURIComponent(replacesId)}/replace` : ''}`, { method: 'POST', body }),
    documentEvidence: (id, body) => request(`/documents/${encodeURIComponent(id)}/evidence`, { method: 'POST', body }),
    downloadDocument: id => request(`/documents/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
    applicantProfile: () => request('/applicants/me'),
    applicantOnboarding: () => request('/applicants/me/onboarding'),
    updateApplicantProfile: body => request('/applicants/me', { method: 'PATCH', body }),
    googleRegistration: () => request('/auth/google/registration'),
    googleStartUrl: () => `${base}/auth/google`,
    completeGoogle: body => request('/auth/google/complete', { method: 'POST', body }),
    login: body => request('/auth/login', { method: 'POST', body }),
    register: body => request('/auth/register', { method: 'POST', body }),
    forgot: body => request('/auth/forgot-password', { method: 'POST', body }),
    reset: body => request('/auth/reset-password', { method: 'POST', body }),
    verify: body => request('/auth/verify-email', { method: 'POST', body }),
    resend: body => request('/auth/resend-verification', { method: 'POST', body }),
    async logout() { await request('/auth/logout', { method: 'POST' }); csrf = undefined; collectionGeneration++; },
  };
}

export const api = createApi();
