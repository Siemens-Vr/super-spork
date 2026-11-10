# Google authentication audit — 10 November 2026

> Implementation update: the ten application-audit findings have been addressed in code. See [security remediation](security-remediation.md) for migration, frontend and validation details. The findings below are the historical audit record.

The backend Google login and registration paths passed automated protocol and PostgreSQL integration checks. Live Google discovery and authorization URL construction succeeded using the configured environment. A real Google account sign-in and authorization-code exchange have not been performed, so the configured client secret, consent/test-user settings and console redirect registration are not yet verified end to end.

## Changes made

- Enabled explicit ID-token JWS signature verification against Google's published keys. The OAuth library already validates issuer, audience, expiration, nonce and state; signature verification is an additional check for the token received directly over TLS.
- Clear a rejected discovery promise so a transient Google/network failure returns `503 GOOGLE_UNAVAILABLE` and a later attempt can recover without restarting the backend.
- Construct the callback URL with the URL API, so a trailing slash in `APP_URL` does not produce a double slash in the registered callback path.
- Clear stale pending registration when a new Google authorization flow starts and whenever a callback is processed. A failed/replayed callback cannot leave the previous identity available for registration.
- Allow both the frontend origin on port 3000 and Swagger's origin on port 4000 in local CORS configuration, while retaining CSRF requirements and rejecting other origins. This backend allowlist is separate from Google's Authorized JavaScript origins setting.

## Verification

- All 144 tests passed across 10 files against a newly created, isolated temporary PostgreSQL `nexus_test` database. No development or production database was migrated or truncated.
- After the CORS correction, all 70 unit/security tests passed, including two new checks for credentialed frontend and Swagger requests.
- TypeScript typecheck, ESLint and production build passed after the final changes.
- Protocol tests use the actual installed `openid-client` library, intercepted HTTP responses and locally signed RSA test tokens. They cover valid token exchange, exact callback construction, PKCE verifier submission, state/nonce mismatch, wrong issuer/audience, expired tokens, unverified/missing email, untrusted signatures and recovery from discovery failure.
- Database-backed tests cover passwordless Google registration, APPLICANT assignment, verified email, subsequent login/session rotation, restricted users, explicit linking, existing-email collisions, consent, CSRF, registration expiration and stale-flow rejection. Google responses are mocked for these database tests.
- Live discovery returned Google's authorization endpoint, the expected `openid email profile` scope, S256 PKCE, state and nonce. No client secret appears in the authorization URL. Credentials were not printed or added to tracked files.

## Local configuration

```dotenv
PORT=4000
APP_URL=http://localhost:4000
CORS_ORIGINS=http://localhost:3000,http://localhost:4000
```

Register this exact Authorized redirect URI in the Google OAuth web client:

```text
http://localhost:4000/api/v1/auth/google/callback
```

During this audit, the configured development PostgreSQL endpoint `127.0.0.1:55432` and the backend HTTP endpoint on port 4000 were not reachable. Start the normal development infrastructure and backend before attempting a browser sign-in. The temporary test database is not a replacement for the application's configured development database.

## Frontend integration and remaining browser check

1. Start Google sign-in with a top-level browser navigation to `http://localhost:4000/api/v1/auth/google`. Swagger's Try it out or a frontend `fetch` following the Google redirect does not provide an interactive Google sign-in flow.
2. Sign in with a permitted Google test account. Google sends the browser back to the backend callback, carrying the session cookie.
3. The current callback returns JSON. For an existing linked user it returns `authenticated: true`; for a new user it returns `registrationRequired: true`. It does not yet redirect to a frontend route. A seamless frontend return flow still needs an agreed frontend route and implementation.
4. New users must obtain a CSRF token from `GET /api/v1/auth/csrf`, then submit `POST /api/v1/auth/google/complete` with `phone`, the current `consentVersion`, the session cookie and `X-CSRF-Token`. Consent version comes from the backend's configured `PRIVACY_NOTICE_VERSION`. Phone numbers are normalized to E.164. Successful completion rotates the session and returns a fresh CSRF token.
5. Frontend API requests to port 4000 must use `credentials: 'include'`. Call `GET /api/v1/auth/me` to confirm the authenticated identity. Refresh CSRF state after session rotation.
6. An existing password account with the same email is deliberately not merged automatically. The user must log into that account, recently reauthenticate, and explicitly link Google.

Only a completed browser sign-in can confirm that Google accepts the configured client/secret, redirect URI and test account. The live discovery check does not authenticate the client secret.
