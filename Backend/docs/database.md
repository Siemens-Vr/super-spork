# Database and migrations

Prisma 7.10.1 uses the `prisma-client` generator into `src/generated/prisma`, `PrismaPg` from `@prisma/adapter-pg`, and the datasource URL in `prisma.config.ts`. Runtime dates use PostgreSQL `timestamptz(3)` and serialize as UTC ISO strings. Entity IDs are UUIDs; Express session identifiers and keyed rate-limit buckets retain their provider-generated formats.

## Relationships

- `User` has one optional `ApplicantProfile`, many `AuthIdentity`, `AuthChallenge`, `Session`, roles through `UserRole`, and one optional `AdminMfaCredential`. `RolePermission` maps roles to granular `Permission` records. `AuthChallenge.purpose` separates email verification and password reset instead of duplicating tables.
- `Document` unifies private file mechanics for identity and academic records. Explicit categories keep their review states independent. It belongs to exactly one user, optionally links to `Institution`, and links to a predecessor through unique `replacesId`. `DocumentVerification`, `VerificationEvidence`, `VerificationStatusHistory` and `DocumentAnalysisJob` preserve review context. Private internal notes never enter applicant history responses.
- `Industry`, `Company`, `CompanyIndustry`, `JobRole`, `JobRoleIndustry` form the catalogue. `CareerPreference` has one primary target role, up to three ranked `IndustryPreference` and three ranked `CompanyPreference` rows. Rank checks and unique rank constraints enforce the three-choice maximum. `CompanySuggestion` is moderated; approval is recorded against an existing catalogue company in the audit trail.
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

Seed is idempotent. It creates APPLICANT/ADMIN permissions, engineering industries, three roles, competencies, two blueprints, one institution and a clearly fictional company. It creates no passwords, claims of company partnerships, bookings, or availability windows. Institutional owners must approve competency content before real assessments are launched.
