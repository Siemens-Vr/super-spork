import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientId = 'test-client.apps.googleusercontent.com';
let claims: Record<string, unknown>;
let invalidSignature: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
let provider: typeof import('../../src/integrations/google/client.js').googleProvider;

function idToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), invalidSignature ? wrongKeys.privateKey : keys.privateKey).toString('base64url')}`;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GOOGLE_CLIENT_ID', clientId);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret');
  vi.stubEnv('APP_URL', 'http://localhost:4000/');
  invalidSignature = false;
  claims = {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: 'google-subject',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'Applicant@Example.test',
    email_verified: true,
    name: 'Test Applicant',
  };
  fetchMock = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: 'https://accounts.google.com',
        authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
      });
    if (url === 'https://oauth2.googleapis.com/token')
      return Response.json({
        access_token: 'test-access-token',
        token_type: 'Bearer',
        id_token: idToken(),
      });
    if (url === 'https://www.googleapis.com/oauth2/v3/certs')
      return Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: 'jwk' }),
            kid: 'test-key',
            alg: 'RS256',
            use: 'sig',
          },
        ],
      });
    throw new Error('Unexpected OAuth endpoint');
  });
  vi.stubGlobal('fetch', fetchMock);
  provider = (await import('../../src/integrations/google/client.js')).googleProvider;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function flow() {
  const start = await provider.start();
  claims.nonce = start.nonce;
  const callback = new URL('http://localhost:4000/api/v1/auth/google/callback');
  callback.searchParams.set('state', start.state);
  callback.searchParams.set('code', 'test-code');
  return { start, callback };
}

describe('Google OAuth protocol with signed test tokens', () => {
  it('builds the exact callback with state, nonce and S256 PKCE', async () => {
    const { start } = await flow();
    const params = new URL(start.url).searchParams;
    expect(params.get('redirect_uri')).toBe('http://localhost:4000/api/v1/auth/google/callback');
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('state')).toBe(start.state);
    expect(params.get('nonce')).toBe(start.nonce);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBeTruthy();
    expect(start.url).not.toContain(start.verifier);
    expect(start.url).not.toContain('test-secret');
  });
  it('exchanges the code, verifies the signature and returns normalized claims', async () => {
    const { start, callback } = await flow();
    await expect(provider.finish(callback, start)).resolves.toEqual({
      subject: 'google-subject',
      email: 'applicant@example.test',
      name: 'Test Applicant',
    });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/token'));
    const body = new URLSearchParams(String((call as unknown as [unknown, RequestInit])[1].body));
    expect(body.get('code_verifier')).toBe(start.verifier);
    expect(body.get('redirect_uri')).toBe('http://localhost:4000/api/v1/auth/google/callback');
    expect(body.get('client_secret')).toBe('test-secret');
  });
  it('rejects state mismatch before exchanging a code', async () => {
    const { start, callback } = await flow();
    callback.searchParams.set('state', 'wrong-state');
    await expect(provider.finish(callback, start)).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/token'))).toBe(false);
  });
  it.each([
    ['nonce', 'wrong-nonce'],
    ['aud', 'another-client'],
    ['iss', 'https://untrusted.test'],
    ['exp', 1],
    ['email_verified', false],
    ['email', null],
  ])('rejects invalid %s claims', async (field, value) => {
    const { start, callback } = await flow();
    claims[String(field)] = value;
    await expect(provider.finish(callback, start)).rejects.toThrow();
  });
  it('rejects a token signed by an untrusted key', async () => {
    const { start, callback } = await flow();
    invalidSignature = true;
    await expect(provider.finish(callback, start)).rejects.toThrow();
  });
  it('recovers after transient discovery failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Temporary outage'));
    await expect(provider.start()).rejects.toMatchObject({
      status: 503,
      code: 'GOOGLE_UNAVAILABLE',
    });
    await expect(provider.start()).resolves.toHaveProperty('url');
  });
});
