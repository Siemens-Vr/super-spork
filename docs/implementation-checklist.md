# Implementation checklist

- [x] Foundation: Express 5, strict TypeScript, validated configuration, structured errors, PostgreSQL migrations, health probes.
- [x] Authentication: password registration, purpose-bound OTPs, recovery, persistent sessions, CSRF, Google OIDC, permission checks, admin bootstrap and MFA.
- [x] Onboarding: private profiles, identity-first uploads, quarantine and ClamAV, manual verification with preserved history.
- [x] Career: catalogues, moderated company suggestions, bounded preferences and versioned competency frameworks.
- [x] Scheduling: policy eligibility, generated UTC slots, capacity locks, idempotency, cancellation and rescheduling history.
- [x] Delivery: encrypted notification outbox, retrying workers, Docker infrastructure, Swagger/OpenAPI, meaningful automated checks.

Implementation stops at assessment scheduling. There is no interview or scoring engine.

Validation results and external deployment limits are recorded in [validation.md](validation.md).
