import { config } from './config.js';

// Destinations come from deployment settings, never from a return URL or form value.
export function workspaceUrl(role, path = '/dashboard') {
  const base = role === 'ADMIN' ? config.adminUrl : role === 'TRAINER' ? config.trainerUrl : config.applicantUrl;
  return new URL(path, base).href;
}
export function availableWorkspaces(principal) {
  return ['APPLICANT', 'ADMIN', 'TRAINER'].filter(role => principal?.roles?.includes(role));
}
export function sharedLoginUrl() { return workspaceUrl('APPLICANT', '/login'); }
