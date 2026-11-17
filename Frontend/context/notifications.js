import { escapeHtml as escape } from '../components/html.js';
import './notifications.css';

export function createReviewNotifications({ client, currentUser, onUnauthorized }) {
  let owner = null, version = 0, pending = false, loadedAt = 0;
  let items = [], unreadCount = 0, error = '', dialog;
  const label = value => value.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  function badge() {
    const button = document.querySelector('[data-action="notifications"]');
    if (!button) return;
    button.classList.add('notification-bell');
    button.setAttribute('aria-label', `Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`);
    button.querySelector('.notification-count')?.remove();
    if (unreadCount) button.insertAdjacentHTML('beforeend', `<span class="notification-count" aria-hidden="true">${unreadCount > 99 ? '99+' : unreadCount}</span>`);
  }
  function draw() {
    if (!dialog?.open) return;
    dialog.innerHTML = `<div class="notification-heading"><div><h2 id="notification-title">Notifications</h2><p>Document review updates · ${unreadCount} unread</p></div><button type="button" class="icon-button" data-notification-close aria-label="Close notifications">✕</button></div>${error ? `<p role="alert">${escape(error)}</p><button class="btn subtle" data-notification-refresh>Try again</button>` : ''}${pending && !items.length ? '<p role="status">Loading updates…</p>' : !items.length && !error ? '<div class="empty"><h3>You’re all caught up</h3><p>Your document review updates will appear here.</p></div>' : `<div class="notification-list">${items.map(item => `<a class="notification-item ${item.applicantReadAt ? '' : 'unread'}" href="/document?id=${encodeURIComponent(item.documentId)}" data-notification-id="${escape(item.id)}"><span class="notification-status">${escape(label(item.outcome))}${item.applicantReadAt ? '' : ' · Unread'}</span><strong>${escape(item.document.title)}</strong><p>${escape(item.reason)}</p><time datetime="${escape(item.createdAt)}">${escape(new Date(item.createdAt).toLocaleString('en-GB'))}</time></a>`).join('')}</div>${unreadCount ? '<button type="button" class="btn subtle" data-notification-read>Mark displayed updates as read</button>' : ''}`}`;
  }
  async function load(force = false) {
    if (!owner || pending || (!force && Date.now() - loadedAt < 30000)) return;
    const requestVersion = version, requestOwner = owner;
    pending = true; error = ''; draw();
    try {
      const result = await client.request('/documents/notifications');
      if (requestVersion !== version || requestOwner !== currentUser()?.id) return;
      items = result.items; unreadCount = result.unreadCount; loadedAt = Date.now();
    } catch (e) {
      if (requestVersion !== version) return;
      error = e.message || 'Unable to load notifications.';
      if (e.status === 401) onUnauthorized();
    } finally {
      if (requestVersion === version) { pending = false; badge(); draw(); }
    }
  }
  function sync() {
    const user = currentUser();
    const next = user?.emailVerifiedAt && user.roles?.includes('APPLICANT') ? user.id : null;
    if (owner !== next) {
      owner = next; version++; pending = false; loadedAt = 0; items = []; unreadCount = 0; error = '';
      dialog?.remove(); dialog = null;
    }
    badge(); void load();
  }
  async function markRead(ids) {
    if (!ids.length) return;
    const requestVersion = version;
    try {
      await client.request('/documents/notifications/read', { method: 'POST', body: { ids } });
      if (version !== requestVersion) return;
      loadedAt = 0; await load(true);
    } catch (e) {
      if (version !== requestVersion) return;
      error = e.message; draw();
      if (e.status === 401) onUnauthorized();
    }
  }
  function open() {
    sync();
    if (!owner) return;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'notification-dialog'; dialog.setAttribute('aria-labelledby', 'notification-title');
      dialog.addEventListener('click', event => {
        if (event.target.closest('[data-notification-close]')) dialog.close();
        if (event.target.closest('[data-notification-refresh]')) void load(true);
        if (event.target.closest('[data-notification-read]')) void markRead(items.filter(i => !i.applicantReadAt).map(i => i.id));
        const link = event.target.closest('[data-notification-id]');
        if (link) { void markRead([link.dataset.notificationId]); dialog.close(); }
      });
      dialog.addEventListener('close', () => document.querySelector('[data-action="notifications"]')?.focus());
      document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();
    draw(); void load(true);
  }
  setInterval(() => { if (!document.hidden) { sync(); } }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  return { sync, open };
}
