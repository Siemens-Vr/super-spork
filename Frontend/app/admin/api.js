import { createApi } from '../../lib/api.js';

const query = values => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) if (value !== '' && value != null) params.set(key, String(value));
  return params.size ? `?${params}` : '';
};
export function createAdminApi(options) {
  const api = createApi(options);
  return {
    ...api,
    trainers: filters => api.request(`/admin/trainers${query(filters)}`, {responseType:'envelope'}),
    trainer: id => api.request(`/admin/trainers/${encodeURIComponent(id)}`),
    trainerInvitations: filters => api.request(`/admin/trainer-invitations${query(filters)}`, {responseType:'envelope'}),
    inviteTrainer: email => api.request('/admin/trainer-invitations',{method:'POST',body:{email}}),
    revokeTrainerInvitation: id => api.request(`/admin/trainer-invitations/${encodeURIComponent(id)}/revoke`,{method:'POST',body:{}}),
    reviewTrainer: (id,body) => api.request(`/admin/trainers/${encodeURIComponent(id)}/reviews`,{method:'POST',body}),
    trainerDownload: id => api.request(`/admin/trainer-qualifications/${encodeURIComponent(id)}/download`,{responseType:'blob'}),
    assessmentReviews: filters => api.request(`/admin/assessment-sessions${query(filters)}`, { responseType: 'envelope' }),
    assessmentReview: id => api.request(`/admin/assessment-sessions/${encodeURIComponent(id)}`),
    approveAssessment: (id, body, key) => api.request(`/admin/assessment-sessions/${encodeURIComponent(id)}/approve-results`, { method: 'POST', body, idempotencyKey: key }),
    availability: filters => api.request(`/admin/availability${query(filters)}`, { responseType: 'envelope' }),
    blueprints: filters => api.request(`/admin/blueprints${query(filters)}`, { responseType: 'envelope' }),
    updateDelivery: (id, body) => api.request(`/admin/blueprints/${encodeURIComponent(id)}/delivery`, { method: 'PATCH', body }),
    publishAvailability: body => api.request('/admin/availability', { method: 'POST', body }),
    updateAvailability: (id, body) => api.request(`/admin/availability/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    adminBookings: filters => api.request(`/admin/bookings${query(filters)}`, { responseType: 'envelope' }),
    adminBooking: id => api.request(`/admin/bookings/${encodeURIComponent(id)}`),
    cancelAdminBooking: (id, reason) => api.request(`/admin/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } }),
    applicants: filters => api.request(`/admin/applicants${query(filters)}`, { responseType: 'envelope' }),
    applicant: id => api.request(`/admin/applicants/${encodeURIComponent(id)}`),
    accountStatus: (id, body) => api.request(`/admin/applicants/${encodeURIComponent(id)}/status`, { method: 'PATCH', body }),
    reviewDocuments: filters => api.request(`/admin/documents${query(filters)}`, { responseType: 'envelope' }),
    reviewDocument: id => api.request(`/admin/documents/${encodeURIComponent(id)}`),
    review: (id, body) => api.request(`/admin/documents/${encodeURIComponent(id)}/reviews`, { method: 'POST', body }),
    evidence: (id, body) => api.request(`/admin/documents/${encodeURIComponent(id)}/evidence`, { method: 'POST', body }),
    download: id => api.request(`/admin/documents/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
    setupMfa: () => api.request('/auth/mfa/setup', { method: 'POST', body: {} }),
    verifyMfa: code => api.request('/auth/mfa/verify', { method: 'POST', body: { code } }),
    sendEmailMfa: () => api.request('/auth/mfa/email/send', { method: 'POST', body: {} }),
    verifyEmailMfa: code => api.request('/auth/mfa/email/verify', { method: 'POST', body: { code } }),
    reauthenticate: password => api.request('/auth/reauthenticate', { method: 'POST', body: { password } }),
  };
}
