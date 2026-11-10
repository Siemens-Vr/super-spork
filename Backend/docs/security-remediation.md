# Security remediation — 10 November 2026

This implements the ten findings in the [application audit](application-security-audit.md). Historical audit evidence describes the defects before these changes.

| Finding                  | Implementation                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: session resurrection | Atomic store writes refuse revoked SIDs. Logout, rotation, individual revocation, password reset, status changes and logout-all retain revoked rows rather than deleting active identifiers.                                                                                                                                                                |
| F2: build credentials    | Backend-specific `.dockerignore` excludes secrets and local artifacts; Dockerfile copies only explicit source/configuration directories.                                                                                                                                                                                                                    |
| F3: upload resources     | Documents and audio stream into private temporary files. Total request bytes, global concurrency, per-account concurrency and retained document storage are bounded. Documents are read/transferred one file at a time. Temporary files are cleaned after completion/errors/disconnects.                                                                    |
| F4: absolute expiry      | Sessions have a database-backed immutable absolute deadline. Store reads/writes reject expired sessions; touch never extends the deadline. Cleanup retains expired rows for an additional hour; stale payload deadlines prevent later recreation.                                                                                                           |
| F5: PATCH defaults       | Dedicated strict, nonempty update schemas apply only supplied fields and have no creation defaults.                                                                                                                                                                                                                                                         |
| F6: assessment recovery  | Expired unstarted bookings become MISSED and can be rebooked for the same prepared target. Expired started bookings become EXPIRED and their targets ABANDONED. Answers/checkpoints/history remain intact. Submitted assessments awaiting review are preserved. Audited recovery endpoints allow eligible applicant abandonment and administrator recovery. |
| F7: response budgets     | New answers have a frozen per-session budget equal to the sum of one initial answer plus approved follow-ups per scenario. Identical retries do not consume another answer. A separate account abuse limit permits 600 requests/hour, supporting 80 answers and bounded retries; session leases still prevent concurrent inference.                         |
| F8: infected cleanup     | INFECTED is committed with cleanupPending before deletion. Failed deletion remains discoverable and retryable without rescanning. Successful deletion records storageDeletedAt and releases quota usage.                                                                                                                                                    |
| F9: browser OAuth return | HTML callbacks redirect to fixed frontend routes. JSON clients retain JSON responses. Redirect URLs contain only status/error codes. Request-provided return URLs are ignored.                                                                                                                                                                              |
| F10: image port          | Docker advertises port 4000, matching the backend defaults.                                                                                                                                                                                                                                                                                                 |

## Rollout

Deploy the two new migrations in order, then regenerate Prisma and restart the API and worker. The database enum addition and its constraint changes are separate migrations so PostgreSQL can commit the new enum value before using it.

```bash
npm run db:migrate
npm run db:generate
npm run build
npm start
# In the worker process:
npm run worker:production
```

The migrations preserve existing users, sessions and assessment evidence. Existing session expiry becomes its absolute deadline. Existing INFECTED documents are queued for idempotent cleanup. Do not remove old migration files or reset populated databases.

New local settings in `.env.example`:

```dotenv
FRONTEND_URL=http://localhost:3000
MAX_UPLOAD_TOTAL_MB=30
MAX_CONCURRENT_UPLOADS=4
MAX_ACCOUNT_UPLOAD_MB=500
```

The frontend origin must use HTTP or HTTPS, with no credentials, path, query or fragment. Production requires HTTPS. Configure its origin in CORS_ORIGINS as well. The API remains on port 4000 and the Google Console redirect URI remains `http://localhost:4000/api/v1/auth/google/callback` locally.

Uploads permit at most two concurrent requests per account, within the global cap. The aggregate request limit applies across file attachments; per-file limits still apply. The document quota counts retained originals and replacements until their objects are actually deleted. Set reverse-proxy body limits consistently, allowing multipart overhead, and provision a bounded temporary filesystem. No real document is deleted merely to meet a quota.

## Frontend OAuth contract

A top-level browser navigation starts at `GET /api/v1/auth/google`. Google returns to the backend callback. For clients accepting HTML, the backend issues a 303 redirect:

| Outcome              | Frontend destination                           |
| -------------------- | ---------------------------------------------- |
| Signed in            | `/auth/google/callback?status=authenticated`   |
| Google linked        | `/auth/google/callback?status=linked`          |
| New Google applicant | `/register/google?status=registrationRequired` |
| Failure/cancellation | `/login?error=<stable error code>`             |

The frontend developer must handle these routes. On success, fetch `/api/v1/auth/me` with `credentials:'include'` and obtain a fresh CSRF token. On Google registration, collect phone and current consentVersion, obtain CSRF state, then POST `/api/v1/auth/google/complete` with credentials included and X-CSRF-Token. The completion endpoint returns JSON with authenticated state and the fresh CSRF token. Neither OAuth codes, tokens nor CSRF secrets are sent to frontend redirect URLs.

API/Swagger clients requesting JSON still receive the existing JSON callback contract. SameSite=Lax cookies require a same-site deployment; arbitrary cross-site frontend/API hosting needs a separate cookie policy review.

## Recovery endpoints

- `POST /api/v1/assessments/targets/:id/abandon`: authenticated verified applicant with assessment permission; JSON `{ "reason": "..." }`. Own unstarted targets can be abandoned subject to their booked cancellation deadline. Started live or submitted assessments require administrator recovery.
- `POST /api/v1/admin/assessment-targets/:id/abandon`: ADMIN, verified email, assessments.manage, recent MFA and CSRF; same reason body. Recovers interrupted/started work without manufacturing completion scores. Completed results remain immutable.

Expiration runs in the worker and is also reconciled when starting/reading interaction sessions and creating targets/bookings. A missed unstarted booking leaves its prepared target available for rebooking. An expired started target is terminal; create a new target to reassess. Abandoned targets cannot be modified or completed, and their evidence remains available to authorized owners/reviewers.

## Validation

Regression coverage includes late saves after revocation/rotation, absolute expiry, omission-preserving PATCH, aggregate upload size/quota/concurrency, infected cleanup retries, missed rebooking, expired and admin-recovered assessments, 80-answer sessions with idempotent retries, preserving submissions awaiting review, frontend-origin validation, and browser OAuth redirects. The existing PostgreSQL-backed workflow suite also runs against the changed implementation.

**Final verification:** all 166 tests passed across 11 files; TypeScript typecheck, ESLint and production build passed. Both migrations were applied to the existing isolated test schema and the entire nine-migration chain also succeeded on a fresh empty database. The schema drift check reported no difference. A full Docker image build was attempted but the host denied access to `/var/run/docker.sock`; the image build remains unverified. No production/dev database was migrated and no deployment or real Google account sign-in was performed by this change.
