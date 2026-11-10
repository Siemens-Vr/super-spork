# Backend functionality and security audit — 10 November 2026

> Implementation update: the ten application-audit findings have been addressed in code. See [security remediation](security-remediation.md) for migration, frontend and validation details. The findings below are the historical audit record.

**Assessment:** the backend has substantial authentication and ownership controls, but it is not ready for production sign-off. This review identifies **two high-priority findings, seven medium-priority findings, and one low-priority finding**. The highest priorities are reliable session revocation and excluding credentials from Docker builds. Several assessment and catalogue edge cases also need correction.

This audit reviews the current working tree, including the earlier Google authentication changes. It adds audit artifacts; the findings below remain open. No application source was changed during this audit pass.

## Scope and evidence

Reviewed the application middleware and every router; authentication, profiles, catalogues, private documents and verification; assessment targets, rubrics, scheduling, interaction, speech, scoring and learning plans; workers, storage, configuration, database constraints, development pages and Docker packaging. This repository contains a backend and development assessment pages, not a production frontend.

- Enumerated **115 API router operations**, matching the 115 documented OpenAPI operations, plus six development routes. Application-level health and documentation endpoints were reviewed separately. See the [complete route inventory](route-security-inventory.md).
- Ran **146 tests across 10 files**, including PostgreSQL-backed integration tests: all passed. Typecheck, ESLint and the production build passed.
- Ran **197 additional HTTP authorization checks**: 105 protected API operations returned 401 for anonymous sessions; all 46 admin operations returned 403 for applicants and 403 for administrators without MFA. No unexpected result occurred. These are negative-access tests, not successful business-operation tests for every endpoint.
- Queried npm's vulnerability database: **zero reported advisories** across the audited dependency tree. This does not establish that application logic or dependencies are vulnerability-free.
- Reproduced session revocation, absolute session expiry, catalogue update, infected-object cleanup and expired-booking defects using synthetic records in a separate temporary `nexus_test` database. The development database and real user accounts were not modified.
- [Sanitized reproduction evidence](application-audit-evidence.json) records outcomes and limitations.

## Findings, ordered by priority

### F1 — High: an in-flight save can restore a revoked session

**Location:** [session store](../src/config/session.ts#L15), [logout and individual revocation](../src/controllers/auth.controller.ts#L41).

The store's `set()` unconditionally upserts a session. Logout and individual session revocation delete the row, without retaining a revocation marker. A request that loaded that session before deletion can subsequently save its stale snapshot, recreating the same authenticated SID. The user's `sessionVersion` does not change for single-session revocation, so authentication accepts the restored session.

**Reproduced:** `/auth/me` returned 200 before revocation, 401 immediately after DELETE returned 204, then 200 after a stale store save. The same restoration worked after logout. Logout-all continued returning 401 after the stale save because it increments the user's session version.

**Impact:** a stolen session cookie can remain usable after the user believes that particular session has been revoked, if a modifying request overlaps revocation. This does not allow arbitrary cookies to create authenticated sessions.

**Fix:** record per-session revocation atomically and reject late writes to revoked SIDs. Retain the marker through the SID's maximum lifetime. Cover logout, explicit revocation and old SIDs invalidated during rotation. Add concurrent-request regression tests; simply changing `resave` does not solve a stale modifying request. The current `resave:false` setting is appropriate for ordinary unmodified requests.

### F2 — High: the documented Docker build includes `.env` in its build context

**Location:** [Dockerfile COPY](../Dockerfile#L6), [documented build command](../README.md#L113).

The Dockerfile is inside `Backend/`, and the documented build runs from that directory. The only `.dockerignore` is at the repository root. There is no `Backend/.dockerignore` or Dockerfile-specific ignore file. Consequently, `COPY . .` copies `Backend/.env` into the build stage and also allows local dependencies/artifacts into that stage.

**Impact:** real database, Google, AI and other credentials can reach the build daemon and persist in intermediate layers or exported build caches. The final runtime stage does not explicitly copy `/app/.env`; this finding concerns build-stage/cache exposure, not a demonstrated secret in the final runtime image. No image containing real secrets was built during this review.

**Fix:** place an ignore file in the actual build context or use a Dockerfile-specific ignore file, exclude all real environment files, and prefer explicit source COPY instructions. Inspect existing builds/caches and rotate credentials if they were exposed. Docker resolves `.dockerignore` at the [build-context root](https://docs.docker.com/build/concepts/context/).

### F3 — Medium: uploads have no aggregate memory or concurrency budget

**Location:** [multipart memory storage](../src/middleware/upload.ts#L3), [upload routes](../src/routes/document.routes.ts#L10).

Multer buffers up to six files per request in process memory, each up to `MAX_UPLOAD_MB`. With the default 10 MiB setting, a request can contain approximately 60 MiB of file payload; the allowed configuration maximum permits approximately 120 MiB. The account rate limit permits a burst of 20 requests and does not limit simultaneously buffered bytes across requests or accounts. Identity uploads also reach the multipart parser before the service rejects inappropriate transcript attachments.

**Impact:** verified applicants can put substantial memory pressure on the API, potentially terminating a memory-limited process. The exact deployment impact depends on proxy limits, container memory and concurrency controls, none of which are defined here. No exhaustion test was performed against the user's machine.

**Fix:** stream uploads to bounded temporary/quarantine storage, enforce an aggregate request size, and impose concurrent-upload and per-account storage quotas. Configure matching edge request limits and backpressure. File type and antivirus controls do not bound concurrent memory usage.

### F4 — Medium: the server does not enforce the documented absolute session lifetime

**Location:** [session touch](../src/config/session.ts#L33), [session configuration](../src/config/session.ts#L45).

`express-session` refreshes its in-memory cookie expiry when touching the session. The store copies that refreshed expiry to the database, even though `rolling:false` leaves the browser's original cookie expiry unchanged. `get()` only checks the database expiry. A client that keeps sending the SID manually can keep the server-side session alive beyond its original lifetime.

**Reproduced:** a synthetic 1.2-second session returned 200 at roughly 1.44, 1.90 and 2.36 seconds when requests were sent periodically. No replacement cookie was issued. The stored expiration moved beyond the original deadline.

**Impact:** browser cookie expiration is not a reliable absolute limit for a stolen cookie sent through a custom client.

**Fix:** persist an immutable absolute expiration when creating the session and enforce it on reads and writes. If idle expiry is also desired, cap it at the absolute deadline. Test both normal cookie expiration and manually replayed SIDs.

### F5 — Medium: PATCH operations apply creation defaults to omitted fields

**Location:** [catalogue updates](../src/services/admin.service.ts#L163), [schemas with defaults](../src/validators/admin.schema.ts#L4).

Update handlers derive PATCH schemas from creation schemas with `.partial()`. With the installed Zod version, defaults inside optional fields still apply. Updating a name or description can silently set `active:true`; institution updates can also reset `country`, `type` and `offersTvet`. Companies can have their country reset to KE.

**Reproduced:** a name-only update changed an inactive Ugandan UNIVERSITY with `offersTvet:true` into an active Kenyan OTHER institution with `offersTvet:false`. Equivalent schema checks confirmed reactivation for industries and careers and country/reactivation defaults for companies.

**Impact:** ordinary admin edits reactivate hidden catalogue entries and corrupt unrelated metadata. Empty PATCH bodies can also apply defaults.

**Fix:** use explicit update schemas without creation defaults and require at least one provided field. Assert that every omitted field remains unchanged.

### F6 — Medium: missed and expired assessments have no recovery lifecycle

**Location:** [active-booking guard](../src/services/scheduling.service.ts#L249), [cancellation guards](../src/services/scheduling.service.ts#L349), [start window](../src/services/assessment-target.service.ts#L455), [worker dispatch](../src/jobs/worker.ts#L29).

Bookings are not automatically transitioned to MISSED or EXPIRED when their windows end. A missed booking remains SCHEDULED, preventing another booking; the applicant is too late to cancel or start. An administrator can cancel an unstarted missed booking, but cancellation also rejects administrators once the target is IN_PROGRESS. Interaction start/resume/respond enforce the expired window, so an expired started attempt has no normal abandon/restart path.

**Reproduced:** a missed booking remained SCHEDULED; another booking returned `ACTIVE_BOOKING_EXISTS`, cancellation returned `CANCELLATION_WINDOW_CLOSED`, and start returned `ASSESSMENT_WINDOW_CLOSED`. After starting and then expiring an attempt, even admin cancellation returned `ASSESSMENT_IN_PROGRESS`.

**Impact:** an interruption or missed appointment can strand an applicant's current career target. Manually recording completion scores is not an appropriate recovery procedure for an unfinished assessment.

**Fix:** implement audited expiry/missed/abandon transitions, policy-based rebooking, and a controlled administrator recovery action for interrupted started attempts. Preserve evidence and target history rather than deleting records.

### F7 — Medium: valid assessments can exceed the response rate limit

**Location:** [40 responses/account/hour](../src/routes/assessment-session.routes.ts#L37), [scenario/follow-up bounds](../src/validators/assessment-interaction.schema.ts#L86).

Blueprints can contain 20 scenarios, each allowing three follow-ups. A valid assessment can therefore need 80 confirmed answers. The response endpoint permits only 40 requests per account in a fixed hour, and counts retries/errors before processing idempotency. Even the default two follow-ups can require 60 answers.

**Impact:** an otherwise valid session contained within one rate-limit window can receive 429 halfway through, potentially remaining blocked until its assessment window expires. Whether a particular assessment hits this depends on its configured scenarios, model follow-ups and timing; this is a static configuration contradiction rather than a completed 80-answer live reproduction.

**Fix:** derive session budgets from the frozen scenario/follow-up limits and allow a bounded retry margin. Keep a separate abuse/concurrency limit. Test the maximum supported session shape.

### F8 — Medium: infected-file deletion failures are never retried

**Location:** [scan worker early return](../src/jobs/document.worker.ts#L8), [post-verdict deletion](../src/jobs/document.worker.ts#L34), [dispatcher filter](../src/jobs/worker.ts#L39).

The worker commits INFECTED before deleting the object. If object deletion fails, its catch block changes only QUARANTINED/FAILED rows, leaving the record INFECTED. A retried job immediately returns, and the dispatcher also excludes INFECTED records.

**Reproduced:** after a controlled deletion outage, the record stayed INFECTED and a retry made no second deletion attempt.

**Impact:** infected blobs can remain in private storage indefinitely without a successful cleanup retry. Download/review checks still block access, so this is a cleanup and retention defect, not a demonstrated malware-serving bypass.

**Fix:** persist deletion-pending/deletion-failed state or enqueue a separate idempotent cleanup job. Retry until deletion succeeds and alert on prolonged failure.

### F9 — Medium: Google OAuth lacks a frontend return handoff

**Location:** [Google callback response](../src/controllers/auth.controller.ts#L180).

Successful sign-in returns JSON in the browser at the backend callback. New registration returns `registrationRequired` there. Neither response hands control back to a frontend route.

**Impact:** a normal browser redirect flow ends on a JSON page. The server authentication primitives can pass while the integrated frontend login/register experience remains unfinished. This is an integration gap, not a token-validation vulnerability.

**Fix:** agree the frontend callback/registration routes and implement a server-controlled, allowlisted return mechanism. Keep credentials/tokens out of redirect URLs. The frontend must use credentialed API requests and refresh CSRF state after session rotation. Real Google account authorization/code exchange is still required to verify the configured secret and Google Console settings end to end.

### F10 — Low: Docker advertises the old backend port

**Location:** [EXPOSE 3000](../Dockerfile#L20), [backend default 4000](../src/config/env.ts#L7).

The Dockerfile still advertises port 3000 after the backend moved to 4000. EXPOSE does not itself bind or publish a port, but mappings or hosting autodetection based on that metadata can target the wrong port.

**Fix:** align the image metadata and deployment mappings with port 4000, or explicitly document a deliberate PORT override.

## Authentication and route security feedback

| Area                        | Observed controls                                                                                                                               | Remaining qualification                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Password registration/login | Strict input schemas, Argon2id, dummy hash for unknown users, generic credential errors, server-selected APPLICANT role, IP/account limits      | No penetration or distributed load test; session findings F1/F4 remain                                                     |
| Email verification/recovery | Purpose-bound HMAC-protected OTPs, expiry, persisted attempt limits, resend cooldown, transactional consumption, reset invalidates sessions     | Real SMTP delivery and operational monitoring remain unverified                                                            |
| Google login/register/link  | State, nonce, S256 PKCE, signed ID-token checks, verified email, pending registration expiry, explicit authenticated linking, no merge by email | Frontend handoff F9; no real account/code exchange in this audit                                                           |
| Applicant API groups        | Authentication, verified email, APPLICANT checks and permission gates where defined                                                             | Negative HTTP matrix passed; existing integration tests cover ownership examples                                           |
| Admin API groups            | Current database roles/permissions, verified email, ADMIN role, recent MFA, validation, audits                                                  | All 46 rejected applicants and admins without MFA; real operator recovery/access review remains an operational requirement |
| Record access               | Applicant IDs come from the authenticated principal; document, booking, target, attempt, session and learning-plan lookups constrain ownership  | No broad IDOR/auth bypass found in reviewed code; this is not proof that every concurrency boundary is safe                |
| State-changing API requests | Synchronizer CSRF, explicit CORS/Origin allowlist, HTTP-only cookies, production Secure cookies                                                 | Cross-site frontend/API hosting needs a cookie deployment design; current SameSite=Lax expects same-site usage             |
| Public routes               | Auth bootstrap/verification endpoints, OAuth entry/callback, health, optional Swagger/OpenAPI; development login assets only in development     | Public auth endpoints have different protections by design; Swagger exposure is controlled by ENABLE_SWAGGER               |

## Functionality feedback

| Functionality                                   | Review and existing validation                                                                                                                                                 | Open work                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile/onboarding                              | Current fields projected explicitly, own-profile updates, identity-first onboarding                                                                                            | Deployment/support handling for incomplete/stale workflows                                                                                     |
| Industry/company/institution/career directories | Search, filters, bounded pagination, seed reconciliation and selection constraints tested                                                                                      | PATCH defect F5; accepted suggestions retain the chosen company ID in the audit event rather than a dedicated response relation                |
| Document upload/verification                    | Required category metadata/transcripts, signature/MIME checks, quarantine, ownership, integrity-checked attachment downloads, review transitions and evidence histories tested | Memory budget F3 and infected cleanup F8; real scanner/storage validation                                                                      |
| Targets/rubrics                                 | One active target, context validation, ownership, approved requirement snapshots and immutable prepared choices tested                                                         | Abandon/recovery lifecycle F6                                                                                                                  |
| Booking/rescheduling                            | Transactional locking, last-seat concurrency, idempotency, cancellation deadlines, rollback, capacity and non-overlap constraints tested                                       | Missed/expired recovery F6; booking email still contains outdated text claiming session launch is unavailable                                  |
| AI interview                                    | Approved scenario coverage, persistent graph checkpoints, controlled follow-ups, structured output validation, saved confirmed answers and replay handling tested              | Response budget F7; real provider behavior, cost/concurrency and model robustness remain deployment checks                                     |
| Speech                                          | Consent checks for transcription, bounded PCM WAV parsing, ownership, transient server audio handling and failure paths tested                                                 | Compatible TTS can be requested for owned historical sessions without an active-window check; review caching and ongoing provider-cost budgets |
| Results/learning plans                          | Finalization requires assessor permission/MFA, idempotent immutable results, weighted scoring, gaps and owner-scoped progress tested                                           | Assessors must evaluate evidence independently; structured AI output does not guarantee score correctness                                      |
| Email/jobs                                      | Encrypted durable outbox, bounded queue retries, payload removal after delivery, manual failed-job retry utility                                                               | No full real Redis/BullMQ/SMTP recovery run; failed scan cleanup F8. SMTP is deliberately at least once                                        |

## Overall application security and production checks

The code uses parameterized Prisma SQL and strict schemas, does not automatically fetch applicant-supplied verification URLs, returns sanitized errors/request IDs, and avoids sending private storage keys or encrypted credentials in ordinary document responses. Development pages render user text through text content rather than injecting it as HTML. Private files require authentication/ownership or authorized admin access; quarantine and digest checks fail closed. These are useful controls, not a substitute for resolving the findings.

Before a production release, verify the following against the actual deployment:

- Reverse-proxy HTTPS detection, exact trusted proxy hops, cookie behavior and the real frontend/API domains. A cross-site frontend/API combination will not work with the current fixed SameSite=Lax cookie solely by adding CORS entries.
- Private object ACLs, encryption support, least-privilege credentials, storage quotas, current malware signatures and network isolation for PostgreSQL, Redis and the scanner. Production configuration validates HTTPS for APP_URL but does not enforce transport policies for every provider endpoint.
- Worker health and queue age/failure alerts. `/health/ready` checks only PostgreSQL and Redis; it does not establish SMTP, scanner, object storage, AI, or worker readiness. Add dependency-specific operational checks where service degradation blocks workflows.
- Login/logout/failure monitoring and immutable external audit exports. Existing business/MFA audit events are useful, but explicit successful/failed password login and logout audit events are absent; HTTP status logs alone do not give account-level security history.
- Document, transcript, checkpoint, challenge and outbox retention; subject export/deletion and legal holds; key rotation, backup restores and incident response. The current retention script is a report, not an implemented deletion/access-rights workflow. No legal-compliance conclusion is made here.
- Disable or restrict Swagger if it is not intended to be public, pin/review runtime image digests, scan the built image, and run a penetration test against the deployed frontend and API.

## Recommended implementation order

1. Correct session revocation and absolute expiry (F1/F4), and fix Docker credential exclusion (F2).
2. Bound upload memory/concurrency (F3) and correct PATCH semantics (F5).
3. Implement assessment expiry/recovery and reconcile response budgets (F6/F7).
4. Make infected cleanup retryable (F8), complete frontend OAuth handoff (F9), and align Docker port metadata (F10).
5. Turn the reproductions into regression tests and validate external services and production deployment behavior before sign-off.

The passing suite and authorization matrix establish useful coverage of the reviewed code. They do not verify production infrastructure, a real Google sign-in, real third-party delivery, malicious-load resistance, or every possible race condition.
