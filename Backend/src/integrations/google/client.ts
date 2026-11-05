import * as oidc from 'openid-client';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
export interface GoogleClaims {
  subject: string;
  email: string;
  name: string;
}
let config: Promise<oidc.Configuration> | undefined;
async function configuration() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)
    throw new AppError(503, 'GOOGLE_UNAVAILABLE', 'Google authentication is not configured');
  return (config ??= oidc.discovery(
    new URL('https://accounts.google.com'),
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  ));
}
export const googleProvider = {
  async start() {
    const c = await configuration();
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: `${env.APP_URL}/api/v1/auth/google/callback`,
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return { url: url.href, state, nonce, verifier };
  },
  async finish(
    url: URL,
    checks: { state: string; nonce: string; verifier: string },
  ): Promise<GoogleClaims> {
    const c = await configuration();
    const tokens = await oidc.authorizationCodeGrant(c, url, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.verifier,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || claims.email_verified !== true || typeof claims.email !== 'string')
      throw new AppError(401, 'GOOGLE_CLAIMS_INVALID', 'Google must provide a verified email');
    return {
      subject: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : claims.email,
    };
  },
};
