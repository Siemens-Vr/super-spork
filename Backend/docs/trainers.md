# Trainer onboarding milestone

This adds invitation-based trainer onboarding to the existing User/session/permission system, with a connected trainer portal and administrator review screens. It implements professional profiles and private qualification evidence. Courses, teaching assignments, learner access, cohorts, attendance, payments and training delivery remain separate future work.

## Deploy and start

```bash
# From Backend, against your intended deployment database:
npm run db:generate
npm run db:migrate
# Seed is optional for existing deployments; the migration installs TRAINER and its permissions.
npm run db:seed
npm run dev
# Separate terminal, same environment:
npm run worker
# From Frontend:
npm run dev:admin
npm run dev:trainer
```

`20261116130000_trainer_onboarding` adds four tables and two enums without changing existing applicant records. It installs `TRAINER`, its three onboarding permissions and `trainers.manage` for existing ADMIN roles. `seed.ts` also maintains these mappings for fresh or test databases. New administrator roles created outside that process need explicit permission assignment by an authorized operator.

Set `TRAINER_URL=http://localhost:3003` for development and allow that origin in `CORS_ORIGINS`. Production requires a trusted HTTPS origin without credentials, path, query or fragment. Update `Frontend/lib/config.js` `trainerUrl` to match deployment. The API and portals must use compatible same-site cookie hosting. Do not put provider keys in frontend configuration.

## Invitation and shared login

An administrator with recent MFA and `trainers.manage` invites an email. Only a keyed token verifier is persisted. The complete link exists in the encrypted notification outbox until SMTP delivery and is never returned by the invite or list APIs. New invitations revoke previous pending links for that email; pending invites can be revoked. Links expire in seven days.

The invitee uses the shared login/signup and verifies the exact invited email. Public signup still creates APPLICANT accounts only. They accept through the trainer portal; the token arrives as a URL fragment, is immediately removed from the address bar, stays only in memory and is posted in the request body. Signed-out recipients can sign in in a separate tab and retry the session check. Reloading the invitation page requires reopening the link from email; it is not saved in localStorage/sessionStorage or a redirect URL.

Acceptance locks the account/invitation, consumes the single-use token, creates a draft profile and assigns only TRAINER onboarding permissions. It increments the session version, revokes old sessions and rotates the accepting session/CSRF token. Existing APPLICANT/ADMIN roles are retained. Shared login supports multiple-workspace selection. Restricted accounts, mismatched emails, unverified emails, expired links and replay attempts are rejected.

## Profile, qualifications and state

Profiles contain headline, biography, country, region, years of experience and up to ten distinct expertise areas. They never expose or accept password hashes, roles, storage keys or administrative account fields. Qualifications capture type, title, issuer, issue/expiry dates and one private file. Trainers do not upload applicant identity documents as a prerequisite.

Files use the existing private S3 adapter, bounded streaming multipart parser, signature/MIME checks, SHA-256 integrity checks, storage quota and the same ClamAV/BullMQ worker infrastructure. `TrainerQualification` is separate from applicant documents; its evidence cannot accidentally satisfy applicant assessment eligibility. Files begin QUARANTINED; infected or failed files cannot be downloaded or submitted for approval. Infected objects are deleted with retryable cleanup state. Withdrawals retain historical evidence and review snapshots.

Every profile/qualification mutation and scan-result change increments a version. Writable requests must submit the version they read; stale writes return `409 TRAINER_VERSION_CONFLICT`. Upload limits are one PDF/JPEG/PNG, up to `MAX_UPLOAD_MB` (10 MB default), twenty current qualifications and `MAX_ACCOUNT_UPLOAD_MB` of retained trainer files.

| Status            | Allowed next action                                                 |
| ----------------- | ------------------------------------------------------------------- |
| DRAFT             | Trainer edits, uploads/withdrawals and submits                      |
| SUBMITTED         | Admin approves, requests changes or rejects                         |
| CHANGES_REQUESTED | Trainer edits and resubmits                                         |
| REJECTED          | Trainer revises and resubmits; admin may explicitly request changes |
| APPROVED          | Profile locked; admin suspends or requests changes                  |
| SUSPENDED         | Profile locked; admin reapproves with evidence or requests changes  |

Submission and approval require a complete profile, at least one current qualification, and all current evidence clean and unexpired. Approval requires a human reason and independent evidence reference. A clean malware scan does not prove authenticity. Administrators cannot approve/review their own trainer profile. Each decision preserves its from/to state, reason, reviewer, time and exact profile/qualification metadata snapshot. Notifications and audit entries are committed together with the decision.

## REST API

All paths below are under `/api/v1`; state changes require cookie authentication and CSRF. Swagger at `/docs` contains request and response schemas.

| Method   | Path                                         | Access                                                               |
| -------- | -------------------------------------------- | -------------------------------------------------------------------- |
| POST     | `/trainers/invitations/accept`               | Signed-in, active account with matching verified email               |
| GET      | `/trainers/me`                               | TRAINER + `trainer.profile.read.self`                                |
| PATCH    | `/trainers/me`                               | TRAINER + `trainer.profile.update.self`, editable status/version     |
| POST     | `/trainers/me/submit`                        | TRAINER + `trainer.profile.update.self`, completeness/version checks |
| POST     | `/trainers/me/qualifications`                | TRAINER + `trainer.qualifications.manage.self`, multipart/version    |
| DELETE   | `/trainers/me/qualifications/:id`            | Same permission, owner and editable status/version                   |
| GET      | `/trainers/me/qualifications/:id/download`   | TRAINER + `trainer.profile.read.self`, owner and clean scan          |
| GET/POST | `/admin/trainer-invitations`                 | ADMIN + recent MFA + `trainers.manage`                               |
| POST     | `/admin/trainer-invitations/:id/revoke`      | Same administrator gate                                              |
| GET      | `/admin/trainers`                            | Same gate; name/email search, status and pagination                  |
| GET      | `/admin/trainers/:id`                        | Same gate; `id` is the trainer User UUID                             |
| POST     | `/admin/trainers/:id/reviews`                | Same gate, allowed transition, version and no self-review            |
| GET      | `/admin/trainer-qualifications/:id/download` | Same gate and clean evidence                                         |

Trainer roles receive no applicant review, assessor or learner access permissions. Approval itself does not assign additional permissions. Future teaching features must explicitly check APPROVED status, active account, the relevant permission and assignment ownership. No trainer-facing learner data endpoint exists in this milestone.

## Validation and limits

The new migration is tested on a separate PostgreSQL `nexus_test` database. Integration tests exercise actual invitation/session transactions, ownership, profile/scan versions, invalid/replayed/expired invites, role separation, scan/quarantine failures, file signatures/sizes, stale writes, submission policies and audited approval/suspension snapshots. S3, scanner verdicts and SMTP boundaries are mocked; actual Google, object storage, ClamAV and SMTP delivery still require configured services. An email job being queued is not proof it was delivered.

Frontend tests exercise shared workspace routing, private-state cleanup, stale responses, multipart requests, unknown mutation outcomes, account changes and escaped rendering. Local static-server tests verify dedicated trainer assets, allowed page routes and rejection of source/API paths. The backend and frontend run through existing checks; see the implementation's final validation notes for results.

### Validation recorded 16 November 2026

- Backend: 211 tests passed across 13 files, including the 15 trainer integration tests; strict TypeScript, ESLint and production build passed.
- Frontend: 173 tests passed (130 applicant, 28 admin and 15 trainer), plus syntax checks, TypeScript and all three portal builds.
- All 13 migrations applied successfully to a fresh isolated test database. Prisma schema comparison reported no difference.
- Swagger regeneration succeeded with 136 operations total, including 14 trainer operations.
- Mobile and desktop dashboard layout checked with synthetic visual-QA data. An inherited hidden mobile sidebar was corrected. Static-server tests verified trainer/profile/qualification/invitation route serving; authenticated browser submission with live SMTP/storage/scanning was not performed.
- No existing populated development/production database was modified. Run the migration in the deployment environment before opening the new portal. The test database used mocked S3/scanner provider boundaries and an encrypted test email outbox; no real invitation emails were sent.

The full test run still emits the existing pg 8 concurrent-query deprecation warning; tests pass. Re-evaluate the Prisma adapter before upgrading to pg 9. No new runtime dependencies were introduced.

Accounts holding both ADMIN and TRAINER keep the existing recent-MFA requirement. The trainer portal hands them to the administrator security check and clears cached trainer data when MFA expires.
