# Route security inventory — 10 November 2026

123 explicit router operations were enumerated from the loaded Express routers, including development routes. This inventories registered gates; ownership, validation and functional behavior were reviewed separately in the audit report. Permission names are in the linked route source.

All state-changing `/api/v1` operations additionally require a synchronizer CSRF token and pass the explicit Origin allowlist. Global CORS, Helmet, request IDs and error handling apply. A permission gate checks current permissions from the database and requires recent MFA for ADMIN users.

The application also registers public `GET /health/live`, `GET /health/ready`, and (when `ENABLE_SWAGGER=true`) `GET /api/v1/openapi.json` and Swagger resources under `/docs`. Health readiness depends on PostgreSQL and Redis. The development routes below are mounted only when `NODE_ENV=development`. Express also provides implicit HEAD/OPTIONS behavior; these are not counted as explicit operations.

The first admin router also applies authentication, verified email and ADMIN checks before requests fall through to the interaction admin router. No production frontend routes are present.

| Method | Path                                                    | Registered gates                                                      | Implementation                                       |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/v1/auth/csrf`                                     | Public                                                                | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/register`                                 | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/login`                                    | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/verify-email`                             | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/resend-verification`                      | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/forgot-password`                          | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/reset-password`                           | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| GET    | `/api/v1/auth/google`                                   | rate limit                                                            | [source](../src/routes/auth.routes.ts)               |
| GET    | `/api/v1/auth/google/callback`                          | OAuth state/nonce/PKCE + session-bound flow                           | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/google/complete`                          | session-bound verified Google identity, phone/consent validation      | [source](../src/routes/auth.routes.ts)               |
| GET    | `/api/v1/auth/me`                                       | authenticate                                                          | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/logout`                                   | authenticate                                                          | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/logout-all`                               | authenticate                                                          | [source](../src/routes/auth.routes.ts)               |
| GET    | `/api/v1/auth/sessions`                                 | authenticate                                                          | [source](../src/routes/auth.routes.ts)               |
| DELETE | `/api/v1/auth/sessions/:id`                             | authenticate                                                          | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/reauthenticate`                           | authenticate, rate limit                                              | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/google/link`                              | authenticate, recent authentication                                   | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/mfa/setup`                                | authenticate, admin, recent authentication                            | [source](../src/routes/auth.routes.ts)               |
| POST   | `/api/v1/auth/mfa/verify`                               | authenticate, admin, rate limit                                       | [source](../src/routes/auth.routes.ts)               |
| GET    | `/api/v1/applicants/me`                                 | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/applicant.routes.ts)          |
| PATCH  | `/api/v1/applicants/me`                                 | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/applicant.routes.ts)          |
| GET    | `/api/v1/applicants/me/onboarding`                      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/applicant.routes.ts)          |
| POST   | `/api/v1/identity/documents`                            | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/identity/documents`                            | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/identity/status`                               | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| POST   | `/api/v1/identity/documents/:id/replace`                | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/document.routes.ts)           |
| POST   | `/api/v1/documents`                                     | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/documents`                                     | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/documents/:id`                                 | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| PATCH  | `/api/v1/documents/:id`                                 | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/documents/:id/verification`                    | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/documents/:id/download`                        | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| POST   | `/api/v1/documents/:id/replace`                         | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/document.routes.ts)           |
| POST   | `/api/v1/documents/:id/evidence`                        | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/document.routes.ts)           |
| GET    | `/api/v1/assessments/targets`                           | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/targets`                           | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/targets/:id`                       | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| PUT    | `/api/v1/assessments/targets/:id`                       | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/targets/:id/prepare`               | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/attempts/:id`                      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/attempts/:id/start`                | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/learning-plans/:id`                | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| PATCH  | `/api/v1/assessments/learning-plans/:id/items/:itemId`  | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/eligibility`                       | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/blueprints/:id`                    | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/available-slots`                   | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/bookings`                          | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/bookings`                          | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/bookings/:id`                      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/bookings/:id/cancel`               | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/bookings/:id/reschedule`           | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/assessments/:bookingId/preflight`              | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment.routes.ts)         |
| POST   | `/api/v1/assessments/:bookingId/start`                  | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment.routes.ts)         |
| GET    | `/api/v1/admin/assessment-attempts/:id`                 | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/assessment-attempts/:id/complete`        | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/applicants`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/applicants/:id`                          | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/applicants/:id/status`                   | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/documents`                               | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/documents/:id`                           | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/documents/:id/download`                  | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/documents/:id/reviews`                   | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/documents/:id/evidence`                  | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/industries`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/industries`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/industries/:id`                          | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/companies`                               | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/companies`                               | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/companies/:id`                           | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/careers`                                 | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/careers`                                 | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/careers/:id`                             | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/institutions`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/institutions`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/institutions/:id`                        | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/competencies`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/competencies`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/competencies/:id`                        | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/frameworks`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/frameworks`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/frameworks/:id`                          | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/blueprints`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/blueprints`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/blueprints/:id`                          | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/company-suggestions`                     | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/company-suggestions/:id/review`          | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/availability`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/availability`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| PATCH  | `/api/v1/admin/availability/:id`                        | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/bookings`                                | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/bookings/:id`                            | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| POST   | `/api/v1/admin/bookings/:id/cancel`                     | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/audit-logs`                              | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/admin.routes.ts)              |
| GET    | `/api/v1/admin/scenarios`                               | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/admin/scenarios`                               | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| PUT    | `/api/v1/admin/blueprints/:id/scenarios`                | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| PUT    | `/api/v1/admin/assessment-attempts/:id/accommodation`   | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/admin/assessment-sessions/:id`                 | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/admin/assessment-sessions/:id/approve-results` | authenticate, verified, admin, permission + admin MFA                 | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/assessment-sessions/:id`                       | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/assessment-sessions/:id/current-scenario`      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/assessment-sessions/:id/progress`              | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/assessment-sessions/:id/responses`             | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/assessment-sessions/:id/resume`                | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/assessment-sessions/:id/events`                | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/assessment-sessions/:id/audio/transcribe`      | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment-session.routes.ts) |
| POST   | `/api/v1/assessment-sessions/:id/speech/synthesize`     | authenticate, verified, applicant, permission + admin MFA, rate limit | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/assessment-sessions/:id/results`               | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-session.routes.ts) |
| GET    | `/api/v1/institutions`                                  | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/api/v1/industries`                                    | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/api/v1/companies`                                     | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| POST   | `/api/v1/companies/suggestions`                         | authenticate, verified, applicant, rate limit                         | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/api/v1/careers`                                       | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/api/v1/careers/:id`                                   | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/api/v1/careers/:id/competencies`                      | authenticate, verified                                                | [source](../src/routes/catalogue.routes.ts)          |
| GET    | `/dev/assessment-login`                                 | Public                                                                | [source](../src/routes/assessment-dev.routes.ts)     |
| GET    | `/dev/assessment-login.mjs`                             | Public                                                                | [source](../src/routes/assessment-dev.routes.ts)     |
| GET    | `/dev/assessments`                                      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-dev.routes.ts)     |
| GET    | `/applicant/assessments/:bookingId/take`                | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-dev.routes.ts)     |
| GET    | `/dev/assessment-assets/app.mjs`                        | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-dev.routes.ts)     |
| GET    | `/dev/assessment-assets/style.css`                      | authenticate, verified, applicant, permission + admin MFA             | [source](../src/routes/assessment-dev.routes.ts)     |

| POST | `/api/v1/assessments/targets/:id/abandon` | authenticate, verified, applicant, permission + admin MFA, owner, cancellation policy | [source](../src/routes/assessment.routes.ts) |
| POST | `/api/v1/admin/assessment-targets/:id/abandon` | authenticate, verified, admin, assessments.manage + recent MFA | [source](../src/routes/admin.routes.ts) |
