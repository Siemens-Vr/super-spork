# Database and migrations

Prisma 7.10.1 uses the `prisma-client` generator into `src/generated/prisma`, `PrismaPg` from `@prisma/adapter-pg`, and the datasource URL in `prisma.config.ts`. Runtime dates use PostgreSQL `timestamptz(3)` and serialize as UTC ISO strings. Entity IDs are UUIDs; Express session identifiers and keyed rate-limit buckets retain their provider-generated formats.

## Relationships

- `User` has one optional `ApplicantProfile`, many `AuthIdentity`, `AuthChallenge`, `Session`, roles through `UserRole`, and one optional `AdminMfaCredential`. `RolePermission` maps roles to granular `Permission` records. `AuthChallenge.purpose` separates email verification and password reset instead of duplicating tables.
- `Document` unifies private file mechanics for identity and academic records. Explicit categories keep their review states independent. It belongs to exactly one user, optionally links to `Institution`, and links to a predecessor through unique `replacesId`. `DocumentVerification`, `VerificationEvidence`, `VerificationStatusHistory` and `DocumentAnalysisJob` preserve review context. Private internal notes never enter applicant history responses.
- `Industry`, `Company`, `CompanyIndustry`, `JobRole`, `JobRoleIndustry` form the catalogue. `AssessmentTarget` has one career, up to three ranked `AssessmentTargetIndustry` and three ranked `AssessmentTargetCompany` rows, and selected qualifications. One active target per applicant is enforced by a partial unique index. Rank checks and unique rank constraints enforce the three-choice maximum. `CompanySuggestion` is moderated; approval is recorded against an existing catalogue company in the audit trail.
- `Competency`, `CompetencyFramework`, `FrameworkCompetency` hold approved versioned competency definitions. Framework weights total 100 at creation. Approved competencies cannot be edited; frameworks can be approved, and changes require a new version. `AssessmentBlueprint` pins a framework and version. Its content is immutable; activation may change.
- `AssessmentAvailability` owns concrete `AssessmentSlot` records. `AssessmentBooking` pins blueprint, slot, seat and applicant. Unique applicant/idempotency-key protects retries; partial unique indexes prevent concurrent seat reuse and multiple active bookings. `AssessmentBookingEvent` and predecessor links preserve cancellation/rescheduling history.
- `AuditLog` records privileged and security-sensitive changes. `NotificationOutbox` contains encrypted notification payloads until successful delivery, then clears them. `RateLimitBucket` uses an atomic PostgreSQL upsert and hashed identifiers to enforce limits across replicas.

There are 36 Prisma models. Foreign keys generally restrict historical record deletion. Sessions and preference members use targeted cascading deletes because they are transient or intentionally replaced.

## Migrations

`20261108090000_document_upload_requirements` adds nullable `institutionName` and `qualificationId` columns. Selected institution names are captured at upload; typed names stay private to the document. Transcript documents reference their qualification through `qualificationId` and retain the existing quarantine, ownership and review protections. Existing records remain unchanged and readable; new category requirements apply to new uploads and replacements.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npx prisma migrate status
```

`20261104120000_initial/migration.sql` contains generated schema DDL plus explicit checks, booking partial indexes, a slot/seat integrity trigger and a `btree_gist` exclusion constraint. The migration role needs permission to create `btree_gist`; pre-provision the extension if the managed database restricts that permission. Do not use `db push`, `migrate reset` or destructive development commands on populated databases.

New schema changes should use reviewed forward migrations and include data backfill/rollback planning when needed. The application role should not own tables or have migration/DDL privileges. Restrict audit/history updates at the database role level in deployment. Back up PostgreSQL and object storage consistently and test restores. Data-encryption keys need encrypted backups and versioned rotation planning; losing the key makes MFA credentials, credential numbers and pending email payloads unreadable.

Seed is idempotent. It creates APPLICANT/ADMIN permissions, 27 engineering industries, three demonstration careers, competencies, three development blueprints, 313 institutions and 40 real employers linked to the engineering industries. A missing blueprint is created only when its seeded framework is approved and has CORE scope; existing blueprint settings and framework approval decisions are preserved. Assessment targets and attempts are created by applicant actions, and results are recorded by authorised assessors; neither is fabricated by the seed. It creates no passwords, claims of company partnerships, bookings, or availability windows. Institutional owners must approve competency content before real assessments are launched.

Assessment interaction adds one `AssessmentInteractionSession` per prepared attempt and booking, ordered conversation messages, confirmed responses, transient-audio transcription metadata, transcript corrections, speech request metadata and interruption events. Versioned `AssessmentScenario` records are assigned to blueprints in order; sessions snapshot approved definitions and frozen competency IDs. `AssessmentGraphCheckpoint` and `AssessmentGraphWrite` store LangGraph state/pending writes without raw audio or video. `AssessmentAccommodation` records an administrator's reasoned device exception before session start. AI evaluation proposals stay on the session until an authorised assessor publishes results through existing completion rules. See [assessment interaction audit](assessment-interaction-audit.md).
