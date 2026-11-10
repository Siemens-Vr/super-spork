// Framework-independent navigation helper; no React runtime is required.
export function getRoute(hash = globalThis.location.hash) {
  return hash.replace(/^#\/?/, '') || 'dashboard';
}
