import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { runInNewContext } from 'node:vm';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
const app = createApp();
afterAll(() => prisma.$disconnect());
describe('HTTP security without external services', () => {
  it('exposes liveness independently of the database', async () => {
    const r = await request(app).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-request-id']).toBeTruthy();
  });
  it('requires CSRF before state changes', async () => {
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'someone@example.test', password: 'password' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_INVALID');
    expect(r.body.error.requestId).toBeTruthy();
  });
  it('rejects origins outside the allowlist', async () => {
    const r = await request(app).get('/api/v1/auth/csrf').set('Origin', 'https://untrusted.test');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORIGIN_REJECTED');
  });
  it('requires authentication for private resources', async () => {
    const r = await request(app).get('/api/v1/applicants/me');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
  it('serves interactive Swagger documentation', async () => {
    const r = await request(app).get('/docs/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('swagger-ui');
  });
  it('keeps Swagger request errors visible when CSRF fetching fails', async () => {
    const r = await request(app).get('/docs/swagger-ui-init.js');
    expect(r.status).toBe(200);
    type SwaggerRequest = { method: string; headers: Record<string, string> };
    type SwaggerOptions = {
      showMutatedRequest: boolean;
      requestInterceptor: (request: SwaggerRequest) => Promise<SwaggerRequest>;
    };
    let options: SwaggerOptions | undefined;
    const window = { location: { search: '', origin: 'http://localhost:3000' }, onload: () => {} };
    let csrfResponse: { ok: boolean; status: number; json: () => Promise<unknown> } = {
      ok: false,
      status: 500,
      json: async () => ({
        error: { message: 'The request could not be completed', requestId: 'csrf-failure' },
      }),
    };
    runInNewContext(r.text, {
      window,
      fetch: async () => csrfResponse,
      SwaggerUIStandalonePreset: {},
      SwaggerUIBundle: Object.assign(
        (config: SwaggerOptions) => {
          options = config;
          return {};
        },
        { presets: { apis: {} }, plugins: { DownloadUrl: {} } },
      ),
    });
    window.onload();
    expect(options?.showMutatedRequest).toBe(false);
    if (!options) throw new Error('Swagger did not initialize');
    const intercept = options.requestInterceptor;
    await expect(intercept({ method: 'POST', headers: {} })).rejects.toThrow(
      'Could not obtain a CSRF token (HTTP 500): The request could not be completed. Request ID: csrf-failure.',
    );
    const getRequest = { method: 'GET', headers: {} };
    expect(await intercept(getRequest)).toBe(getRequest);
    csrfResponse = {
      ok: true,
      status: 200,
      json: async () => ({ data: { csrfToken: 'browser-test-csrf' } }),
    };
    const postRequest = { method: 'POST', headers: {} };
    expect((await intercept(postRequest)).headers['X-CSRF-Token']).toBe('browser-test-csrf');
  });
  it('serves OpenAPI 3.1 and documents every workflow', async () => {
    const r = await request(app).get('/api/v1/openapi.json');
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe('3.1.0');
    expect(
      r.body.paths['/assessments/bookings'].post.parameters.some(
        (p: { name: string }) => p.name === 'Idempotency-Key',
      ),
    ).toBe(true);
    expect(r.body.paths['/admin/documents/{id}/reviews'].post.security).toEqual([
      { sessionCookie: [] },
    ]);
    expect(Object.keys(r.body.paths).length).toBeGreaterThan(50);
  });
});
