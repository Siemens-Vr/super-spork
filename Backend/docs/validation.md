# Validation report — 4 November 2026

The implementation was validated with Node.js 24.21.0 and PostgreSQL 16.15. Prisma CLI, client and adapter are pinned to 7.10.1. Development and integration testing used separate new local databases; no existing populated database was migrated or reset.

| Check                                                       | Result                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Strict TypeScript typecheck                                 | Passed                                                                     |
| ESLint                                                      | Passed                                                                     |
| Production TypeScript build                                 | Passed                                                                     |
| Vitest / Supertest                                          | 62 tests passed across four files                                          |
| Initial migration applied to development database           | Passed                                                                     |
| Initial migration applied to isolated `nexus_test` database | Passed                                                                     |
| Prisma migration status                                     | Up to date                                                                 |
| Prisma schema drift check                                   | No difference detected                                                     |
| Prisma schema validation                                    | Passed                                                                     |
| Docker Compose configuration                                | Valid                                                                      |
| Full npm dependency audit, including development tools      | 0 vulnerabilities                                                          |
| Production-only dependency audit                            | 0 vulnerabilities                                                          |
| Swagger / OpenAPI                                           | Swagger HTML and OpenAPI 3.1 served successfully; 88 operations documented |

The test suite exercises actual PostgreSQL transactions and constraints. Its external provider boundaries are isolated: S3 storage, malware verdicts, Google provider responses and SMTP delivery are mocked. Tests cover registration/duplicates/input validation, normalized Kenyan phone numbers, OTP expiry/replay/attempts/resend, login/session rotation/revocation, recovery restrictions, explicit Google linking, Google registration/collision handling, admin MFA and recovery/replay protections, permission checks, identity-first uploads, file signatures/sizes, quarantine/infected/failed scans, ownership, encrypted credentials, independent academic review, evidence/history/replacements, bounded preferences, competency lookup, eligibility policies, slots/timezones, actual persisted booking confirmations/outbox intent, concurrent last-seat requests, simultaneous applicant bookings, idempotency, cancellation, atomic rescheduling/rollback/limits, availability controls and independent database constraints.

Email tests verify encrypted outbox payloads survive SMTP failure, become retryable, and are erased after successful delivery. Stable Message-ID and SENT-state checks avoid unnecessary duplicate work; exactly-once delivery across SMTP/crash boundaries is not claimed.

The PostgreSQL driver emits a pg 8 deprecation notice during concurrent transaction tests. It does not fail checks; the dependency is constrained below pg 9. Recheck Prisma adapter/driver behavior before a future pg 9 upgrade.

## Not validated live

- Google requires an institutional OAuth client, secret, consent configuration and exact callback URI.
- Real SMTP delivery/provider restrictions, S3 encryption/policies, Redis/BullMQ outage recovery and real ClamAV signatures/daemon scans need deployment validation.
- Docker Compose was schema-validated; images were not built/pulled or run as a full infrastructure stack during this implementation.
- The production image, TLS/reverse-proxy cookie behavior, backup restores, key rotation and operational alerting need deployment checks.
- Institutional privacy/legal decisions, approved deletion/appeal procedures and final competency rubrics remain institution-owned release requirements.

The backend now records assessment starts and authorised assessor results, computes skill gaps and produces learning plans. The interaction service now launches booked assessments, uses a configured AI provider and saves provisional evaluations for authorised assessor review. It makes no OCR authenticity claim. See [assessment targets](assessment-targets.md) and [the interaction validation record](assessment-interaction-audit.md#validation-record). Automated deletion is intentionally not enabled without an approved institutional policy; a configurable report-only retention tool is included.

Reproduce with the README commands and an explicitly named `nexus_test` database. Integration tests skip without `TEST_DATABASE_URL` and refuse other database names.
