// History routing keeps screens separate while using normal, shareable URLs.
export function getRoute(path = globalThis.location.pathname) {
  return path.split('?')[0].replace(/^\/+|\/+$/g, '') || 'dashboard';
}

export function getRouteParams(search = globalThis.location.search) {
  return new URLSearchParams(search.includes('?') ? search.slice(search.indexOf('?') + 1) : search);
}

function announce() {
  // Defer rendering until the current event/guard finishes, as browser navigation does.
  queueMicrotask(() => globalThis.window?.dispatchEvent(new Event('app:navigate')));
}

export function navigate(route, { replace = false } = {}) {
  const path = route.startsWith('/') ? route : `/${route}`;
  if (path.startsWith('//')) throw new Error('Navigation requires an application path.');
  const url = new URL(path, globalThis.location.origin);
  if (url.origin !== globalThis.location.origin) throw new Error('Navigation must stay within this application.');
  if (url.pathname + url.search + url.hash === globalThis.location.pathname + globalThis.location.search + globalThis.location.hash) return;
  globalThis.history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash);
  announce();
}

export function initializeNavigation() {
  const migrate = () => {
    if (!globalThis.location.hash.startsWith('#/')) return false;
    const path = globalThis.location.hash.slice(1);
    if (path.startsWith('//')) return false;
    const url = new URL(path, globalThis.location.origin);
    if (url.origin !== globalThis.location.origin) return false;
    globalThis.history.replaceState(null, '', url.pathname + url.search);
    return true;
  };
  migrate();
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const href = anchor.getAttribute('href');
    if (!href.startsWith('/') || href.startsWith('//')) return;
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', announce);
  window.addEventListener('hashchange', () => { if (migrate()) announce(); });
}
