// Preview bytes are fetched through the authenticated API, never through a public storage URL.
export function createDocumentPreview({ download, createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url) }) {
  let version = 0, url = null;
  const clear = () => { version++; if (url) revokeUrl(url); url = null; };
  return {
    clear,
    async load(doc) {
      clear();
      if (doc.scanStatus !== 'CLEAN') return null;
      const request = version;
      const result = await download(doc.id);
      if (request !== version) return null;
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(result.blob.type)) throw new Error('This file type cannot be previewed.');
      url = createUrl(result.blob);
      return { url, type: result.blob.type };
    },
  };
}

export function createDocumentDialogs({ client, store, context, renderShell, renderContent, onChanged, onUnauthorized, ownerId }) {
  let dialog = null, version = 0, trigger = null, selectedId = '', kind = '', oldOverflow = '';
  const preview = createDocumentPreview({ download: id => client.downloadDocument(id) });
  const modalActions = new Set(['details', 'history', 'replace', 'evidence', 'preview', 'choose-update', 'upload']);
  const titles = { details: 'Document details', history: 'Verification history', replace: 'Update / replace document', evidence: 'Additional evidence', preview: 'Document preview', 'choose-update': 'Update a document', upload: 'Upload a document' };
  const escape = value => context().escape(value);
  function closeMenus(restore = false) {
    for (const button of document.querySelectorAll('[data-document-menu]')) {
      if (restore && button.getAttribute('aria-expanded') === 'true') button.focus();
      button.setAttribute('aria-expanded', 'false');
    }
    for (const panel of document.querySelectorAll('[data-document-menu-panel]')) panel.hidden = true;
  }
  function close(restore = true) {
    version++; preview.clear();
    if (!dialog) return;
    dialog.close(); dialog.remove(); dialog = null;
    document.body.style.overflow = oldOverflow;
    if (restore) {
      if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus();
      else [...document.querySelectorAll('[data-document-menu]')].find(button => button.dataset.documentMenu === selectedId)?.focus();
    }
  }
  function frame(content) { if (dialog) dialog.querySelector('[data-document-dialog-body]').innerHTML = content; }
  function showError(error) {
    frame(`<p role="alert">${escape(error.message || 'Unable to load this document. Please try again.')}</p><button type="button" class="btn subtle" data-document-dialog-retry>Try again</button>`);
    if (error.status === 401) onUnauthorized();
  }
  function view(doc = null, history = null) {
    const current = context();
    return {
      ...current,
      routeParams: new URLSearchParams(kind === 'replace' ? { replace: selectedId } : {}),
      documentState: { ...current.documentState, detail: doc, history, detailId: selectedId, detailStatus: 'ready' },
    };
  }
  async function open(action, id = '', source = null) {
    if (!modalActions.has(action) || store.snapshot().busy) return;
    close(false); closeMenus();
    kind = action; selectedId = id; trigger = source;
    const request = ++version, owner = ownerId();
    store.clearMessages();
    const holder = document.createElement('div');
    holder.innerHTML = renderShell(titles[action], context().escape);
    dialog = holder.firstElementChild;
    document.body.append(dialog);
    oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-document-dialog-close]')) close();
      else if (event.target.closest('[data-document-dialog-retry]')) void open(kind, selectedId, trigger);
    });
    dialog.addEventListener('submit', async event => {
      const form = event.target;
      if (!['upload-form', 'document-evidence-form'].includes(form.id)) return;
      event.preventDefault();
      const request = version;
      if (form.id === 'upload-form') {
        const saved = await store.upload(new FormData(form), form.dataset.replacesId || undefined);
        if (saved && request === version) { close(); onChanged(); }
      } else {
        const saved = await store.evidence(selectedId, Object.fromEntries(new FormData(form)));
        if (saved && request === version) {
          kind = 'history';
          dialog.querySelector('#document-dialog-title').textContent = titles.history;
          frame(renderContent(view(store.snapshot().detail, store.snapshot().history), 'history'));
          dialog.querySelector('[data-document-dialog-close]').focus();
          onChanged();
        }
      }
    });
    frame('<p role="status">Loading document…</p>');
    dialog.showModal();
    const current = () => request === version && owner === ownerId() && dialog?.open;
    try {
      if (['upload', 'choose-update'].includes(action)) {
        frame(renderContent(view(), action));
        return;
      }
      const doc = await client.document(id);
      if (!current()) return;
      if (action === 'preview') {
        if (doc.scanStatus !== 'CLEAN') { frame(renderContent(view(doc), action)); return; }
        const file = await preview.load(doc);
        if (!current() || !file) return;
        const type = file.type === 'application/pdf' && navigator.pdfViewerEnabled === false ? 'application/pdf-unavailable' : file.type;
        frame(renderContent(view(doc), action, file.url, type));
      } else {
        const history = action === 'replace' || action === 'details' ? { history: [], reviews: [], evidence: [] } : await client.documentHistory(id);
        if (!current()) return;
        frame(renderContent(view(doc, history), action));
        if (action === 'evidence') dialog.querySelector('#evidence-note')?.focus();
      }
    } catch (error) { if (current()) showError(error); }
  }
  function openMenu(button, last = false) {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    if (!panel) return;
    closeMenus(); panel.hidden = false; button.setAttribute('aria-expanded', 'true');
    const bounds = button.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    panel.style.left = `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`;
    panel.style.top = `${bounds.bottom + height + 8 < window.innerHeight ? bounds.bottom + 5 : Math.max(8, bounds.top - height - 5)}px`;
    const items = [...panel.querySelectorAll('button:not(:disabled)')];
    (last ? items.at(-1) : items[0])?.focus();
  }
  document.addEventListener('click', event => {
    const menuButton = event.target.closest('[data-document-menu]');
    if (menuButton) {
      if (menuButton.getAttribute('aria-expanded') === 'true') closeMenus();
      else openMenu(menuButton);
      return;
    }
    const action = event.target.closest('[data-document-action]');
    if (action && modalActions.has(action.dataset.documentAction)) { void open(action.dataset.documentAction, action.dataset.documentId || '', action); return; }
    if (!event.target.closest('[data-document-menu-panel]') || action) closeMenus();
  });
  document.addEventListener('keydown', event => {
    const button = event.target.closest('[data-document-menu]');
    const panel = event.target.closest('[data-document-menu-panel]');
    if (button && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu(button, event.key === 'ArrowUp'); }
    if (!panel) return;
    const items = [...panel.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); closeMenus(true); }
    if (event.key === 'Tab') closeMenus(true);
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  window.addEventListener('resize', () => closeMenus());
  window.addEventListener('scroll', () => closeMenus(), true);
  return { open, close, reset() { close(false); closeMenus(); } };
}
