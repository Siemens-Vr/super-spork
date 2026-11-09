# Implementation status

The phase-one backend is implemented at the repository root. It includes email/password and configurable Google authentication, email verification/recovery, persistent secure sessions and CSRF, role/permission enforcement, mandatory admin MFA, private applicant profiles, identity-first quarantined uploads, protected downloads, independent audited verification/evidence and replacements, engineering catalogues, moderated company suggestions, bounded preferences, approved versioned competency definitions, availability and capacity controls, idempotent transactional booking, cancellation/rescheduling history, encrypted notification outbox and worker adapters.

The backend includes one-career assessment targets, frozen context and rubrics, a booked-session start lifecycle, authorised assessor-recorded results, deterministic skill gaps and linked learning plans. A configured AI interviewer now uses approved scenarios, durable LangGraph checkpoints and assessor-reviewed competency proposals. Employer portals and course delivery remain outside this implementation. See [assessment targets](assessment-targets.md) and [the interaction audit](assessment-interaction-audit.md).

## Data and API

Prisma models and forward migrations are in `prisma/`, including the additive assessment-target migration. Additional SQL enforces ranked preference limits, slot bounds, active booking/seat uniqueness, availability exclusion and blueprint/seat integrity. Seed data is idempotent and contains no admin password, claim of company partnership or fabricated availability/booking.

98 REST operations are documented with schemas in `docs/openapi.yaml`; `docs/api.md` and the README map the endpoint families. Swagger UI is available at `/docs`, and JSON at `/api/v1/openapi.json`.

## Checks and provider requirements

Strict typecheck, ESLint, production build, the automated test suite, migration deployment/status/drift, Prisma validation, Compose configuration and dependency audits passed. See `docs/validation.md` for exact scope and limits. PostgreSQL concurrency tests use a real isolated database. Google, SMTP, storage and malware scanning are mocked in tests; live deployment configuration and credentials are still required.

Configure Google client ID/secret, production SMTP, private encrypted S3-compatible storage, Redis and ClamAV. Institutional approval is still needed for privacy notices, retention/deletion, operator MFA recovery and actual competency rubric use. The report-only retention tool does not delete historical sensitive records.

## Start and try the journey

Follow `README.md`: configure `.env`, start Compose infrastructure, install dependencies, generate Prisma, deploy migrations, seed catalogue, start API and worker. Use the authorized admin bootstrap and MFA enrollment process to create real availability. `docs/journey.md` provides complete curl commands from registration to a persisted assessment booking.

## Created files

All files below were created for this implementation. Generated build output, generated Prisma code, local secrets and dependencies are excluded from this list and Git.

- `.dockerignore`
- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.prettierignore`
- `.prettierrc.json`
- `Dockerfile`
- `README.md`
- `docker-compose.yml`
- `docs/ai-integration.md`
- `docs/api.md`
- `docs/architecture.md`
- `docs/authentication.md`
- `docs/database.md`
- `docs/implementation-checklist.md`
- `docs/journey.md`
- `docs/openapi.yaml`
- `docs/security.md`
- `docs/validation.md`
- `docs/workflows.md`
- `eslint.config.js`
- `package-lock.json`
- `package.json`
- `prisma.config.ts`
- `prisma/migrations/20261104120000_initial/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `scripts/bootstrap-admin.ts`
- `scripts/generate-openapi.ts`
- `scripts/retention-report.ts`
- `scripts/retry-jobs.ts`
- `src/app.ts`
- `src/config/env.ts`
- `src/config/logger.ts`
- `src/config/prisma.ts`
- `src/config/redis.ts`
- `src/config/session.ts`
- `src/config/storage.ts`
- `src/controllers/auth.controller.ts`
- `src/controllers/document.controller.ts`
- `src/errors/app-error.ts`
- `src/integrations/ai-assessment/contracts.ts`
- `src/integrations/document-analysis/contracts.ts`
- `src/integrations/google/client.ts`
- `src/integrations/storage/clamav.ts`
- `src/jobs/document.worker.ts`
- `src/jobs/email.worker.ts`
- `src/jobs/queues.ts`
- `src/jobs/worker.ts`
- `src/middleware/authenticate.ts`
- `src/middleware/errorHandler.ts`
- `src/middleware/security.ts`
- `src/middleware/upload.ts`
- `src/middleware/validate.ts`
- `src/routes/admin.routes.ts`
- `src/routes/applicant.routes.ts`
- `src/routes/assessment.routes.ts`
- `src/routes/auth.routes.ts`
- `src/routes/catalogue.routes.ts`
- `src/routes/document.routes.ts`
- `src/server.ts`
- `src/services/admin.service.ts`
- `src/services/applicant.service.ts`
- `src/services/auth.service.ts`
- `src/services/document.service.ts`
- `src/services/email.service.ts`
- `src/services/scheduling.service.ts`
- `src/types/express.d.ts`
- `src/utils/audit.ts`
- `src/utils/crypto.ts`
- `src/validators/admin.schema.ts`
- `src/validators/applicant.schema.ts`
- `src/validators/assessment.schema.ts`
- `src/validators/auth.schema.ts`
- `src/validators/career.schema.ts`
- `src/validators/document.schema.ts`
- `tests/integration/email.test.ts`
- `tests/integration/workflow.test.ts`
- `tests/security/http.test.ts`
- `tests/unit/validation.test.ts`
- `tsconfig.build.json`
- `tsconfig.json`
- `vitest.config.ts`
- `docs/implementation-status.md`
