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
  async function send(path, options) {
    let response;
    try {
      response = await fetcher(`${base}${path}`, {
        ...options, credentials: 'include', signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ApiError('Unable to reach the server. Check your connection and try again.');
    }
    if (response.status === 204) return null;
    let body;
    try { body = await response.json(); }
    catch { throw new ApiError('The server returned an unexpected response. Try again.', response.status); }
    if (!response.ok) {
      const error = body.error || {};
      throw new ApiError(error.message || 'The request could not be completed.', response.status, error.code, error.details);
    }
    if (body.data?.csrfToken) csrf = body.data.csrfToken;
    return body.data;
  }
  async function token() {
    if (csrf) return csrf;
    csrfPending ??= send('/auth/csrf', { method: 'GET' }).then(data => {
      if (!data?.csrfToken) throw new ApiError('Unable to initialize a secure session. Try again.');
      return data.csrfToken;
    }).finally(() => { csrfPending = undefined; });
    return csrfPending;
  }
  async function request(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') headers['X-CSRF-Token'] = await token();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const options = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
    try { return await send(path, options); }
    catch (error) {
      // Only a CSRF rejection is retried; failed login/register requests are never replayed.
      if (error.code !== 'CSRF_INVALID') throw error;
      csrf = undefined;
      options.headers['X-CSRF-Token'] = await token();
      return send(path, options);
    }
  }
  return {
    request,
    clear() { csrf = undefined; },
    me: () => request('/auth/me'),
    login: body => request('/auth/login', { method: 'POST', body }),
    register: body => request('/auth/register', { method: 'POST', body }),
    forgot: body => request('/auth/forgot-password', { method: 'POST', body }),
    reset: body => request('/auth/reset-password', { method: 'POST', body }),
    verify: body => request('/auth/verify-email', { method: 'POST', body }),
    resend: body => request('/auth/resend-verification', { method: 'POST', body }),
    async logout() { await request('/auth/logout', { method: 'POST' }); csrf = undefined; },
  };
}

export const api = createApi();
