# Frontend/backend Google authentication audit — 13 November 2026

The backend implements Google sign-in, passwordless registration completion, explicit linking, and frontend return redirects. The current applicant frontend implements password authentication but does not yet connect the Google flow. Adding a Google button alone will not make it work.

This pass audited the current code and added this report; it did not change application authentication behavior.

## Implementation follow-up

The frontend Google sign-in/signup connection has now been implemented. Findings 1–4 are resolved: real return paths redirect into hash routes with bounded outcome parameters, callback success is confirmed through `/auth/me`, Google completion is public and collects phone/consent, and failure messages survive the return redirect. Login/signup use the existing auth layout, colors, buttons and responsive styles.

Finding 5 is handled by explaining matching-password-account collisions and directing users to password login. A settings UI for explicit account linking remains separate work. Finding 6 remains a deployment configuration step: `lib/config.js` still contains public localhost defaults and the current consent version; no runtime configuration was introduced.

Follow-up: Google requests now include `prompt=select_account`. The completion form loads verified email/name and expiry from cookie-bound `/auth/google/registration`, shows an explicit account-switch action, reloads pending identity after refresh, and hides the form when its original ten-minute deadline expires.

Validation for this implementation: 16 frontend tests, 79 backend unit/security tests and 7 Google database integration tests pass, including real HTTP return-path tests; frontend syntax/type/build checks and backend type/build checks pass. Lint passes for changed backend code; the full lint command reports existing undefined-global errors in `scripts/setup-smtp.mjs`. The login and Google completion screens were checked in the browser. A live Google account authorization/code exchange still needs a manual check with the configured Google app.

The findings below preserve the original audit snapshot.

## Findings

### 1. P1 — Both successful Google return destinations are 404

Backend `googleResult()` redirects HTML browsers to `/auth/google/callback?status=authenticated` or `/register/google?status=registrationRequired`, under FRONTEND_URL. The frontend server only recognizes its existing password-auth paths. Neither Google path is in the static file map or the auth-path allowlist.

Confirmed with the real frontend server on an isolated temporary port:

| Request | Actual response |
| --- | --- |
| `/` | 200 |
| `/auth/google/callback?status=authenticated` | 404 |
| `/register/google?status=registrationRequired` | 404 |
| `/login?error=ACCOUNT_LINK_REQUIRED` | 302 to `/#/login` |

Implementation: [frontend server](../server.mjs#L23), [backend callbacks](../../Backend/src/controllers/auth.controller.ts#L132).

Required change: serve the applicant shell for both Google paths, or explicitly translate them into supported hash routes while retaining the outcome parameters. Test real HTTP returns, not only rendering a hash page in isolation.

### 2. P1 — Google registration cannot pass the auth gate or submit its required fields

`register/google` is absent from the frontend's auth/public route sets. A new Google applicant intentionally has no authenticated application user until completing phone and privacy consent. The startup `/auth/me` therefore returns 401; the guard redirects the user back to login rather than letting them finish registration.

There is also no Google-completion form, API helper, or submit-handler branch. The generic auth renderer assumes an email field on every submission (`values.email.trim()`); a new phone-and-consent-only form must have its own branch before that assumption. Passing `register/google` to the existing renderer produces verification-oriented UI instead of the intended Google completion form.

Implementation: [auth routes and guard](../context/auth.js#L6), [submission handler](../context/auth.js#L96), [API client methods](../lib/api.js#L55).

Required change: treat Google completion as a public authentication route, render phone and consent fields, and POST only `phone` and `consentVersion` to `/api/v1/auth/google/complete`, with the cookie and CSRF header. Do not request another password or an email verification code for an email already verified by Google. On expired/missing pending state, offer to restart Google sign-in.

### 3. P2 — The callback is a placeholder and the router cannot parse outcome parameters

The applicant route map contains an `auth/google/callback` placeholder; it does not retrieve the actual principal or accept the cookie session. It is also absent from the public auth route set, so a loading/failed session can reach the normal protected-route guard instead.

`getRoute()` returns the whole hash as a route string. Simply redirecting to `/#/auth/google/callback?status=authenticated` would produce the route name `auth/google/callback?status=authenticated`, which does not match the existing route map.

Implementation: [applicant route map](../app/applicant/app.js#L73), [navigation](../hooks/navigation.js#L2), [auth bootstrap](../context/auth.js#L76).

Required change: separate route identity from URL parameters. Handle the callback as a public loading state, clear stale in-memory CSRF state, retrieve `/auth/me`, enforce the APPLICANT role using the server principal, and navigate to the appropriate signed-in page. A URL containing `status=authenticated` is not evidence of authentication.

### 4. P2 — The frontend drops Google failure information

The backend redirects failures to `/login?error=<code>`. The frontend's path-to-hash redirect uses only pathname, discarding the query. The login UI also has no Google-specific outcome handling.

Confirmed: `/login?error=ACCOUNT_LINK_REQUIRED` becomes `/#/login` with the error removed.

Required change: preserve and parse a bounded set of outcome parameters. Map known backend error codes to fixed, escaped messages for cancelled/invalid flows, unavailable Google service, restricted accounts, and existing-account linking. Do not render arbitrary query text as HTML or honor query-supplied external return destinations.

### 5. P2 — Existing password accounts need an explicit linking UX and a browser-compatible linking contract

The backend deliberately returns ACCOUNT_LINK_REQUIRED when a Google email matches an unlinked password account. The frontend settings page still says Google integration is unavailable; it has no reauthentication or linking action.

The backend linking endpoint is CSRF-protected POST `/auth/google/link` and currently responds with a redirect to Google. The frontend's generic API wrapper uses fetch, follows redirects by default, and expects JSON. Calling that endpoint through the wrapper will not create a top-level interactive Google login. A plain top-level GET cannot substitute for its required POST and CSRF header.

Implementation: [backend linking route](../../Backend/src/routes/auth.routes.ts#L66), [Google start](../../Backend/src/controllers/auth.controller.ts#L103), [API fetch wrapper](../lib/api.js#L15), [settings placeholder](../app/applicant/settings/settings.tsx#L23).

Required change: initially explain the collision and direct users to password login. If linking is included in the implementation, expose a JSON authorization URL for the authenticated, CSRF-protected linking request, then navigate the browser to it. Require recent reauthentication and retain the existing server-bound link state. Do not auto-merge accounts by email.

### 6. P2 for hosted deployment — Public frontend configuration is fixed to localhost

The frontend API origin is hardcoded to `http://localhost:4000/api/v1`, and the consent version is hardcoded to `2026-11-01`. These match the current local backend settings, but a hosted frontend would contact the end user's own machine, and later privacy-notice changes would cause registration rejection.

Implementation: [frontend configuration](../lib/config.js#L1).

Required change: introduce public build/runtime configuration for the API base and approved consent version, with a deployment check against the backend. Keep Google client secrets on the backend. Current SameSite=Lax cookies support the localhost port split; hosting frontend and API on unrelated sites requires an explicit cookie/deployment design in addition to CORS.

## What already works in the reviewed code

- Backend OAuth uses state, nonce, S256 PKCE, explicit ID-token signature verification, issuer/audience/expiry checks, and requires verified Google email.
- Existing linked users receive rotated server-side application sessions; new users have a ten-minute session-bound completion window and server-selected APPLICANT role.
- Completion requires a valid phone number, the configured privacy-notice version, the same browser session, and CSRF protection.
- The frontend API client uses credentials included, obtains CSRF state, accepts replacement tokens after session rotation, refreshes a rejected CSRF token once, and avoids replaying credential errors.
- Frontend authentication trusts `/auth/me`, and the ordinary password login path checks the applicant role. Passwords and session tokens are not saved in localStorage by the auth module.
- Current local backend origin, frontend origin, CORS settings and frontend consent version match. Google client ID and secret are present; their values were not printed. Presence does not establish that Google will accept the credentials or Console settings.

## Implementation sequence

1. Add Continue with Google to password login and signup. Use a top-level navigation to `${apiBase}/auth/google`; the same backend entry handles both returning and new users. No frontend Google SDK or client secret is needed for this existing backend-owned redirect flow.
2. Wire the real return paths through the frontend server and router, preserving only supported outcome parameters.
3. Complete the returning-user callback using `/auth/me`; never trust the status parameter alone.
4. Implement the phone/consent completion page and API request, then refresh authenticated state and enter the applicant workspace.
5. Handle cancellation, expiry, unavailable service, restricted accounts and account-link collisions clearly. Add linking only with the authenticated/CSRF-protected URL response contract described above.
6. Add public deployment configuration and regression coverage for the complete browser return path, not just API mocks.

The backend Console redirect URI remains `http://localhost:4000/api/v1/auth/google/callback`; the new frontend paths do not replace it.

## Verification and limits

- Backend unit/security suite: **79 tests passed across nine files**, including the real OAuth library exercised against signed synthetic tokens. This pass did not rerun database-backed integration tests.
- Frontend auth test command passed; frontend syntax checks, TypeScript checking and production build passed. Existing frontend tests cover password flows and API cookies/CSRF; they do not exercise Google callbacks or completion.
- Real frontend HTTP probes confirmed the two 404s and loss of the login error parameter. The temporary server was stopped after the probes.
- No real Google account login, authorization-code exchange, or production cookie/proxy configuration was validated. The Google Console configuration remains an external end-to-end check.
- Most applicant dashboard/profile/documents/assessment content remains demo data, as stated in the frontend README. Adding Google authentication will not by itself connect those business workflows.
