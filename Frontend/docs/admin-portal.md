# Administrator portal

The administrator workspace at `http://localhost:3002` uses the existing applicant theme, system fonts, purple palette, sidebar, cards and responsive layout. It implements the administration counterparts of the applicant features currently integrated with the backend. No demo applicant records are bundled into the admin application.

## Run

From `Frontend`, run `npm run dev:admin`. The server builds and watches `app/admin/app.js` and `admin.css`, serving `/dist/admin/app.js` and `/dist/admin/app.css`. The root build command builds both applicant and admin bundles. The employer and trainer entries remain placeholders.

Start the backend normally with its database and configured private file storage/scanning services. `CORS_ORIGINS` must include `http://localhost:3002`. The default and example configuration include this origin; existing environment files need updating and the API must restart. The shared public `lib/config.js` still controls the API URL.

An authorized operator provisions administrators through the existing backend bootstrap procedure. The frontend does not create accounts, assign roles, bypass MFA or embed administrator credentials. Applicant-only accounts cannot open the workspace.

## Implemented workflows

| Screen / flow | API contract |
| --- | --- |
| Sign in and session restore | POST `/auth/login`, GET `/auth/me`; probe an authorized admin collection to verify the server's MFA requirement |
| Authenticator enrollment / verification | POST `/auth/mfa/setup`, `/auth/mfa/verify`, `/auth/reauthenticate` |
| Password recovery and reset | POST `/auth/forgot-password`, `/auth/reset-password` |
| Sign out | POST `/auth/logout` |
| Overview | Recent applicants and documents; registered, active and suspended applicant totals from `/admin/applicants` metadata |
| Applicant directory | GET `/admin/applicants` with name/email search, account status and pagination |
| Applicant profile | GET `/admin/applicants/:id`; contact/profile information, computed onboarding indicators, current and previous documents |
| Account access | PATCH `/admin/applicants/:id/status` with supported status and a required reason; confirmation explains session revocation |
| Document / identity queues | GET `/admin/documents`, filtered by verification status, identity/academic group and optionally applicant ID |
| Document details and history | GET `/admin/documents/:id`; private metadata, verification history, review decisions, supporting evidence and internal notes |
| Preview and download | GET `/admin/documents/:id/download` with session cookies; CLEAN files only; object URLs revoked on close, navigation and auth changes |
| Verification decision | POST `/admin/documents/:id/reviews` with outcome, method, reason and optional internal notes/evidence reference |
| Administrator evidence | POST `/admin/documents/:id/evidence` with note and optional reference |
| My account | Identity from `/auth/me`, sign-out and an explanation of the MFA session requirement |

All paths above are under `/api/v1`. The shared API transport sends credentialed requests with CSRF headers on writes. The new `envelope` response mode retains `meta` for admin pagination; existing applicant callers still receive `body.data` as before.

## Review behavior

Review choices follow the backend's allowed transitions. An uploaded file must first be marked UNDER_REVIEW; authentication cannot jump directly from UPLOADED. Authentication requires a clean scan, an independent evidence reference, and a review method other than AI_ASSISTED. The server remains authoritative for permissions, current versions and transition validation.

Where applicant-management access is available, the document detail page also reads the applicant's documents to identify previous versions, including transcripts attached to a replaced qualification. Previous versions can be inspected but do not show decision/evidence forms. Administrators without verification permission can inspect records but cannot submit review decisions.

Applicant-visible review reasons and administrator-only notes are labeled separately. Administrator evidence is recorded through the existing evidence endpoint; no replacement, upload or new applicant-profile editing endpoint was added on the admin side.

Document list responses do not include a global total. The UI displays page numbers and the count on that page, offering Next when a full page is returned. It does not invent a queue total.

## Session and error handling

- The UI checks the actual ADMIN role and available permissions. The API still performs all authorization and MFA checks.
- Expired MFA clears private page data and opens the verification screen. Failed actions are not replayed after MFA; the administrator reopens/retries the action deliberately.
- Invalid authenticator codes remain a form error rather than signing the administrator out.
- Authenticator setup/recovery material, records and file bytes are not placed in browser storage. Sign-out clears in-memory state. Late reads/downloads cannot restore data after the session changes.
- Validation errors preserve entered form values. Network failures warn that the outcome is unconfirmed and ask for a record refresh before retrying a mutation.
- Modal previews have their own accessible error region, including failed downloads. Closing or leaving a preview revokes its private object URL.
- Mobile navigation has a close control, Escape/outside dismissal, focus trapping, an inert background and a scrollable sidebar. Closed navigation is hidden from keyboard and accessibility traversal.

## Validation

Run `npm run check` and `npm test` from `Frontend`. Admin tests cover endpoint payloads/cookies/CSRF, pagination metadata, MFA gates and expiry, applicant-only denial, stale responses after logout, review guards, mutation field whitelists, escaped API text, fresh detail loading and portal asset/return-path serving. Existing applicant tests run as regression coverage.

The backend unit/security suite verifies the added local admin CORS origin and continues to reject untrusted origins. The running local API's credentialed preflight for port 3002 was also checked.

Browser QA uses an isolated local fixture server serving the actual admin bundle with synthetic accounts and documents. It covers sign-in/MFA, applicant search, profile/account-status management, document review changes, failed/successful evidence submission, preview download errors, navigation and compact mobile layout. Fixture data and credentials are not included in the application. No real applicant status or verification decision was changed during QA.

Live administrator credentials, real storage bytes, email delivery and worker scanning were not exercised through the new portal. These continue to depend on the existing backend deployment.
