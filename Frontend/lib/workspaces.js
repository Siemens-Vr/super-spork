import { config } from './config.js';

// Destinations come from deployment settings, never from a return URL or form value.
export function workspaceUrl(role, path = '/dashboard') {
  const base = role === 'ADMIN' ? config.adminUrl : role === 'TRAINER' ? config.trainerUrl : role === 'EMPLOYER' ? config.employerUrl : config.applicantUrl;
  return new URL(path, base).href;
}
export function availableWorkspaces(principal) {
  return ['APPLICANT', 'ADMIN', 'TRAINER', 'EMPLOYER'].filter(role => principal?.roles?.includes(role));
}
// Choose the most privileged supported workspace after a server session check.
export function defaultWorkspace(principal) {
  return ['ADMIN', 'TRAINER', 'EMPLOYER', 'APPLICANT'].find(role => principal?.roles?.includes(role)) || null;
}
export function sharedLoginUrl() { return workspaceUrl('APPLICANT', '/login'); }
