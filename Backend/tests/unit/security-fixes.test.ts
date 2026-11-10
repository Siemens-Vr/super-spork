import { describe, expect, it } from 'vitest';
import {
  companyPatchSchema,
  industryPatchSchema,
  institutionPatchSchema,
  rolePatchSchema,
} from '../../src/validators/admin.schema.js';
import { loadEnv } from '../../src/config/env.js';

describe('security configuration and catalogue update contracts', () => {
  it.each([
    [companyPatchSchema, { name: 'Renamed employer' }],
    [industryPatchSchema, { description: 'Updated engineering description' }],
    [institutionPatchSchema, { name: 'Renamed university' }],
    [rolePatchSchema, { title: 'Renamed career' }],
  ])('preserves omitted fields in a partial update', (schema, input) => {
    expect(schema.parse(input)).toEqual(input);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });
  it.each([
    'javascript:alert(1)',
    'https://trusted.example/redirect',
    'https://user:password@trusted.example',
    'https://trusted.example?returnTo=https://untrusted.test',
  ])('rejects unsafe frontend origins: %s', (origin) => {
    expect(() => loadEnv({ ...process.env, FRONTEND_URL: origin })).toThrow();
  });
  it('requires HTTPS for the production frontend as well as the API', () => {
    expect(() =>
      loadEnv({
        ...process.env,
        NODE_ENV: 'production',
        APP_URL: 'https://api.example.test',
        FRONTEND_URL: 'http://frontend.example.test',
      }),
    ).toThrow();
    expect(
      loadEnv({
        ...process.env,
        NODE_ENV: 'production',
        APP_URL: 'https://api.example.test',
        FRONTEND_URL: 'https://frontend.example.test',
      }).FRONTEND_URL,
    ).toBe('https://frontend.example.test');
  });
});
