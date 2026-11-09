# VML NEXUS backend

REST API for Virtual Mechatronics Labs: applicant registration → private document onboarding → one-career assessment target → booking → assessor-recorded competency results → skill gaps and upskilling plans. Verification can proceed in parallel. A configurable AI interviewer now supports approved scenarios, persistent text/voice conversations and assessor-reviewed competency proposals. No production frontend or course delivery is connected.

See [assessment targets and upskilling](docs/assessment-targets.md) for the complete API workflow, rubric configuration, scoring rules and assessment target history. Each prepared assessment preserves its course, career, industries, companies and requirement versions. Completing it unlocks the next career target.

## Start locally

Requires Node.js **24 LTS**, npm, and Docker Compose. This project uses **Prisma 7.10.1** with the PostgreSQL `@prisma/adapter-pg` adapter, generated ESM client, and `prisma.config.ts`. It does not mix Prisma 6 datasource configuration with Prisma 7.

```bash
npm ci
cp .env.example .env
# Set SESSION_SECRET and OTP_PEPPER independently using: openssl rand -hex 48
# Set DATA_ENCRYPTION_KEY using: openssl rand -hex 32
# .env.example intentionally contains an invalid encryption-key placeholder.
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
# In another terminal with the same environment:
npm run worker
```

The seed includes 313 Kenyan institutions with searchable aliases and institution types. To update only this directory, run `npm run db:seed:institutions`. Existing institution IDs and inactive entries are preserved. See [directory source and import notes](prisma/data/README.md).

It also includes the 27 agreed engineering industries, each with a description, in `prisma/data/engineering-industries.json`. Run `npm run db:seed:industries` to add only these industries. The command is safe to repeat: existing IDs, descriptions, inactive status and relationships are preserved. Earlier catalogue entries remain in existing databases; fresh databases receive the new 27-entry catalogue. The main seed uses the new industries for newly created companies and demonstration careers. No database migration is needed for this catalogue update.

The company seed adds 40 employers across Kenya (KE), Uganda (UG), Tanzania (TZ), and Rwanda (RW), covering all 27 engineering industries. Run `npm run db:seed:companies` to install only this catalogue and its industry links; `npm run db:seed` includes it too. Each entry has a description, website, country and industry mappings, with source URLs in `prisma/data/east-african-companies.json`. Existing company IDs, admin edits, inactive status and additional links are preserved. No schema migration is required.

In Swagger, use **GET /api/v1/companies** with `search`, `industryIds`, `page` and `limit` (maximum 100). For example, search `kiira` or `Kenya Airways`; pass selected industry UUIDs to show matching employers. Applicants can use returned company IDs in their assessment target choices. This is a curated employer directory, including public utilities and research bodies, rather than a complete East African business register. It does not seed company-specific assessment requirements.

ClamAV needs time to download signatures and initialize. Until scanning succeeds, documents remain quarantined. The worker is required for scans and email delivery. All Compose ports bind to loopback; its credentials are development-only.

The Compose database is available at `127.0.0.1:55432` (container port `5432`). Use the matching `DATABASE_URL` from `.env.example`; `localhost:5432` may reach a separately installed PostgreSQL server and reject the Compose credentials. After changing an existing `.env`, restart the backend and worker.

Local object storage uses the [PGSTY Silo MinIO fork](https://github.com/pgsty/silo) and its matching client, pinned to `RELEASE.2026-10-26T00-00-00Z`. The upstream `minio/minio` and `minio/mc` images are no longer publicly pullable. Silo supports the existing S3 endpoint, `MINIO_*` credentials, and storage volume. If an older checkout fails with `pull access denied for minio/mc`, use the updated Compose file, run `docker compose pull`, then `docker compose up -d`.

- Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)
- OpenAPI JSON: [http://localhost:3000/api/v1/openapi.json](http://localhost:3000/api/v1/openapi.json)
- Mailpit local email inbox: [http://localhost:8025](http://localhost:8025)
- Private storage console: [http://localhost:9001](http://localhost:9001)
- Probes: `/health/live` and `/health/ready` (PostgreSQL and Redis).

Swagger's **Try it out** obtains CSRF tokens automatically. Cookies stay in the browser. Log in through `/auth/login`; admins must enroll and verify MFA before using admin routes. Never paste session cookies, passwords, identity files, OTPs, or MFA secrets into issue trackers.

## Provision an administrator

Seed data never creates an admin or default password. An authorized infrastructure operator runs:

```bash
read -r -s -p 'New administrator passphrase: ' NEXUS_ADMIN_PASSWORD
printf '%s' "$NEXUS_ADMIN_PASSWORD" | ADMIN_EMAIL=admin@your-institution.example ADMIN_NAME='Authorized Administrator' npm run admin:bootstrap
unset NEXUS_ADMIN_PASSWORD
```

The bootstrap script refuses a second administrator unless the operator explicitly supplies `--additional-admin`. The operator is responsible for confirming authorization and email ownership outside the application. Sign in, call `POST /auth/mfa/setup`, add the returned provisioning URI to an authenticator, securely save the ten recovery codes, then call `POST /auth/mfa/verify`. Both successful login and MFA rotate the session and CSRF token. Subsequent admin access requires recent MFA (30 minutes by default). There is no public admin registration or privilege-escalation endpoint.

## API capabilities

All routes are below `/api/v1`. Operations are documented in [docs/openapi.yaml](docs/openapi.yaml), including searchable `/institutions` for upload dropdowns. See [document upload requirements](docs/api.md) for institution, transcript and expiry fields by category; upload titles come from filenames.

| Area              | Routes                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication    | `/auth/register`, `/verify-email`, `/resend-verification`, `/login`, `/logout`, `/logout-all`, `/me`, `/sessions`, `/sessions/:id`, `/forgot-password`, `/reset-password`, `/reauthenticate`, `/csrf` (all under `/auth`)                                                                                                                        |
| Google and MFA    | `/auth/google`, `/auth/google/callback`, `/auth/google/complete`, `/auth/google/link`, `/auth/mfa/setup`, `/auth/mfa/verify`                                                                                                                                                                                                                     |
| Applicant         | `/applicants/me`, `/applicants/me/onboarding`                                                                                                                                                                                                                                                                                                    |
| Private documents | `/identity/documents`, `/identity/status`, `/identity/documents/:id/replace`, `/documents`, `/documents/:id`, `/documents/:id/verification`, `/documents/:id/download`, `/documents/:id/replace`, `/documents/:id/evidence`                                                                                                                      |
| Catalogue         | `/industries`, `/companies`, `/companies/suggestions`, `/careers`, `/careers/:id`, `/careers/:id/competencies`                                                                                                                                                                                                                                   |
| Assessment        | `/assessments/targets`, target details/prepare, `/assessments/attempts/:id`, attempt start, learning plans/progress, `/assessments/eligibility`, `/assessments/blueprints/:id`, `/assessments/available-slots`, `/assessments/bookings`, `/assessments/bookings/:id`, `/assessments/bookings/:id/cancel`, `/assessments/bookings/:id/reschedule` |
| Administration    | `/admin/applicants`, applicant details/status, `/admin/documents` with details/download/reviews/evidence; industries, companies, careers, institutions, competencies, frameworks, blueprints; company suggestions/review; availability; bookings/details/cancel; audit logs                                                                      |

Consult Swagger for HTTP methods, input schemas, permissions and status codes. Applicant routes require verified email. Private document and booking lookups enforce ownership even with a known UUID. Admin access requires ADMIN **and** granular permissions **and** recent MFA.

## Registration-to-booking example

The detailed executable shell journey is in [docs/journey.md](docs/journey.md). Begin with:

```bash
curl -sS -c /tmp/nexus.cookies http://localhost:3000/api/v1/auth/csrf
# Copy data.csrfToken from the response into NEXUS_CSRF.
export NEXUS_CSRF='the-returned-token'
curl -sS -b /tmp/nexus.cookies -c /tmp/nexus.cookies \
  -H "X-CSRF-Token: $NEXUS_CSRF" -H 'Content-Type: application/json' \
  -d '{"legalName":"Example Applicant","email":"applicant@example.test","phone":"0712345678","password":"a long example passphrase","passwordConfirmation":"a long example passphrase","consentVersion":"2026-11-01"}' \
  http://localhost:3000/api/v1/auth/register
```

Registration returns `202` with a generic message. Obtain the code from Mailpit, verify, log in, complete the profile, upload identity, select a career, and book an actual configured slot. No availability is fabricated by the seed; an admin must publish a real availability window first.

## Build and checks

```bash
npm run docs:generate
npm run typecheck
npm run lint
npm run build
npm run test:unit
# Create a separate empty database named nexus_test first:
DATABASE_URL=postgresql://nexus:nexus@127.0.0.1:55432/nexus_test npm run db:migrate
TEST_DATABASE_URL=postgresql://nexus:nexus@127.0.0.1:55432/nexus_test npm test
npm audit --omit=dev
```

Integration tests **truncate only an explicitly supplied database named `nexus_test`**. Never point this at real data. Without `TEST_DATABASE_URL`, integration tests skip and unit/HTTP security tests still run. PostgreSQL behavior is real; Google, private storage and scanning are mocked in integration tests. No real Google credentials or SMTP deliveries are required. CI runs migrations, all tests, lint, compilation and production dependency audit.

```bash
npm run build
npm start
npm run worker:production
# Or build the image; configure real infrastructure and HTTPS separately:
docker build -t vml-nexus-backend .
```

Run migrations once as an authorized deployment step, not simultaneously in every API replica. Keep generated Prisma sources out of Git; `db:generate` is required before compilation. Keep `docs/` beside the running application. Production requires HTTPS, fresh secrets, restricted infrastructure credentials, private encrypted object storage, working SMTP and ClamAV, backups, monitoring and an institution-approved privacy policy.

## Documentation and current limits

- [Architecture](docs/architecture.md), [database](docs/database.md), [authentication](docs/authentication.md)
- [Workflows](docs/workflows.md), [API and examples](docs/api.md), [future AI contracts](docs/ai-integration.md)
- [Security decisions and operating checklist](docs/security.md), [validation report](docs/validation.md)

Google requires a configured OAuth client and exact redirect URI. SMTP and S3 require credentials outside local Compose. This milestone does not determine legal compliance automatically. Retention and deletion need institutional approval; the provided retention report identifies candidates and never silently deletes sensitive records or historical evidence. The full external-service stack and live Google authentication must be validated in the target deployment before production release.

## Assessment entry and voice development tests

The backend supports owned booking preflight, confirmed session start, approved scenarios, a LangGraph conversation with PostgreSQL checkpoints, final transcript correction, speech adapters, reconnect/resume and assessor-reviewed AI proposals. See [the implementation audit and configuration](docs/assessment-interaction-audit.md).

After migrations, Prisma generation and seeding, start the API and open [the development assessment test page](http://localhost:3000/dev/assessments). Sign in with a verified applicant account and select a scheduled booking. The page and its media controls exist only in development; production uses the documented APIs from its own frontend. Camera preview remains local and video is never recorded. Browser speech recognition may use the browser vendor; no server audio is retained.

Set `AI_PROVIDER=compatible` with `AI_BASE_URL`, `AI_MODEL` and a server-side `AI_API_KEY` to enable the real interviewer. Browser STT/TTS are the defaults; compatible server speech adapters are optional. AI output is provisional until an authorised assessor reviews it. The seeded Mechatronics scenarios and broad rubric are development content requiring institutional review before real assessment decisions.

For local Ollama, use `AI_BASE_URL=http://127.0.0.1:11434/v1`, `AI_API_KEY=ollama` (a local placeholder), `AI_MODEL=qwen3.5:9b`, `AI_REASONING_EFFORT=none`, `AI_MAX_OUTPUT_TOKENS=768` and `AI_KEEP_ALIVE=30m`. Keep Ollama running and restart the API after changing `.env`. Run `npm run ai:check` to measure a real synthetic assessment turn without creating an applicant result.
