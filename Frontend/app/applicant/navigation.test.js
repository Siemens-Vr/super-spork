import test from 'node:test';
import assert from 'node:assert/strict';
import { getRoute, getRouteParams, navigate, initializeNavigation } from '../../hooks/navigation.js';

function browser(path = '/booking') {
  const handlers = {}, entries = [];
  const setPath = path => { const url = new URL(path, 'http://localhost:3000'); globalThis.location = url; };
  setPath(path);
  globalThis.window = new EventTarget();
  globalThis.document = { addEventListener: (type, callback) => { handlers[type] = callback; } };
  globalThis.history = {
    pushState: (_data, _title, path) => { entries.push(['push', path]); setPath(path); },
    replaceState: (_data, _title, path) => { entries.push(['replace', path]); setPath(path); },
  };
  return { handlers, entries, setPath };
}

test('routes and query parameters use pathname/search without hash routes', () => {
  browser('/document?id=doc-1');
  assert.equal(getRoute(), 'document');
  assert.equal(getRouteParams().get('id'), 'doc-1');
  assert.equal(getRoute('/'), 'dashboard');
  assert.equal(getRoute('/register/google/'), 'register/google');
  assert.equal(getRouteParams('?career=career-1').get('career'), 'career-1');
});

test('navigation pushes history, skips duplicate entries, and renders after the current guard finishes', async () => {
  const { entries } = browser(); let updates = 0;
  window.addEventListener('app:navigate', () => updates++);
  navigate('/career?id=career-1');
  assert.equal(location.pathname, '/career');
  assert.equal(location.search, '?id=career-1');
  assert.equal(updates, 0);
  await Promise.resolve(); assert.equal(updates, 1);
  navigate('/career?id=career-1'); assert.equal(entries.length, 1);
  navigate('/documents', { replace: true });
  assert.deepEqual(entries.at(-1), ['replace', '/documents']);
  assert.throws(() => navigate('//other.example/booking'));
});

test('old bookmarks migrate without an extra history entry and popstate updates the screen', async () => {
  const { entries, setPath } = browser('/#/document?id=doc-1'); let updates = 0;
  window.addEventListener('app:navigate', () => updates++);
  initializeNavigation();
  assert.deepEqual(entries, [['replace', '/document?id=doc-1']]);
  assert.equal(getRoute(), 'document'); assert.equal(location.hash, '');
  setPath('/booking'); window.dispatchEvent(new Event('popstate'));
  await Promise.resolve(); assert.equal(updates, 1); assert.equal(getRoute(), 'booking');
  setPath('/#/documents'); window.dispatchEvent(new Event('hashchange'));
  await Promise.resolve(); assert.equal(updates, 2); assert.equal(location.pathname, '/documents');
});

test('same-origin page clicks navigate in-app while modified, download and external links keep browser behavior', () => {
  const { handlers, entries } = browser(); initializeNavigation();
  const click = (href, extra = {}, attributes = {}) => {
    let prevented = false;
    const anchor = { target: '', hasAttribute: name => !!attributes[name], getAttribute: () => href, ...attributes };
    handlers.click({ defaultPrevented: false, button: 0, target: { closest: () => anchor }, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  };
  assert.equal(click('/documents'), true);
  assert.equal(click('/booking', { ctrlKey: true }), false);
  assert.equal(click('/booking', {}, { target: '_blank' }), false);
  assert.equal(click('/documents/file', {}, { download: true }), false);
  assert.equal(click('http://localhost:4000/api/v1/auth/google'), false);
  assert.equal(click('//other.example/'), false);
  assert.equal(click('#help'), false);
  assert.equal(entries.length, 1);
});
