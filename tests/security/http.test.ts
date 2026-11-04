import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
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
