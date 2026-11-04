-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'BACHELOR', 'MASTER', 'PHD', 'DIPLOMA', 'TRANSCRIPT', 'SHORT_COURSE', 'INDUSTRY_CERTIFICATION', 'PROFESSIONAL_REGISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'ADDITIONAL_EVIDENCE_REQUIRED', 'AUTHENTICATED', 'REJECTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('MANUAL', 'INSTITUTION_CONFIRMATION', 'OFFICIAL_VERIFICATION', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUARANTINED', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED', 'EXPIRED', 'MISSED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "ApplicantProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'KE',
    "region" TEXT,
    "educationLevel" TEXT,
    "institution" TEXT,
    "discipline" TEXT,
    "professionalStatus" TEXT,
    "graduationYear" INTEGER,
    "summary" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApplicantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sid" TEXT NOT NULL,
    "userId" UUID,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "verifier" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMfaCredential" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "recoveryHashes" TEXT[],
    "enabledAt" TIMESTAMPTZ(3),
    "lastCounter" BIGINT NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminMfaCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'KE',
    "website" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "institutionId" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "encryptedCredentialNumber" TEXT,
    "verificationUrl" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'QUARANTINED',
    "status" "VerificationStatus" NOT NULL DEFAULT 'UPLOADED',
    "replacesId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVerification" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "outcome" "VerificationStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "internalNotes" TEXT,
    "evidenceReference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvidence" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationStatusHistory" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "fromStatus" "VerificationStatus",
    "toStatus" "VerificationStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAnalysisJob" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "serviceVersion" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "findings" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'KE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIndustry" (
    "companyId" UUID NOT NULL,
    "industryId" UUID NOT NULL,

    CONSTRAINT "CompanyIndustry_pkey" PRIMARY KEY ("companyId","industryId")
);

-- CreateTable
CREATE TABLE "CompanySuggestion" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRole" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRoleIndustry" (
    "jobRoleId" UUID NOT NULL,
    "industryId" UUID NOT NULL,

    CONSTRAINT "JobRoleIndustry_pkey" PRIMARY KEY ("jobRoleId","industryId")
);

-- CreateTable
CREATE TABLE "CareerPreference" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "primaryRoleId" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CareerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndustryPreference" (
    "preferenceId" UUID NOT NULL,
    "industryId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "IndustryPreference_pkey" PRIMARY KEY ("preferenceId","industryId")
);

-- CreateTable
CREATE TABLE "CompanyPreference" (
    "preferenceId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "CompanyPreference_pkey" PRIMARY KEY ("preferenceId","companyId")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetencyFramework" (
    "id" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetencyFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkCompetency" (
    "frameworkId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "FrameworkCompetency_pkey" PRIMARY KEY ("frameworkId","competencyId")
);

-- CreateTable
CREATE TABLE "AssessmentBlueprint" (
    "id" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "frameworkId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "requiresAuthenticatedIdentity" BOOLEAN NOT NULL DEFAULT false,
    "requiresAuthenticatedAcademic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAvailability" (
    "id" UUID NOT NULL,
    "blueprintId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxHorizonDays" INTEGER NOT NULL DEFAULT 90,
    "cancellationNoticeMinutes" INTEGER NOT NULL DEFAULT 60,
    "rescheduleLimit" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSlot" (
    "id" UUID NOT NULL,
    "availabilityId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentBooking" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "blueprintId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "seat" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "idempotencyKey" TEXT NOT NULL,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "rescheduledFromId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentBookingEvent" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentBookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "encryptedPayload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_name_key" ON "Permission"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicantProfile_userId_key" ON "ApplicantProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_purpose_createdAt_idx" ON "AuthChallenge"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMfaCredential_userId_key" ON "AdminMfaCredential"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceId_idx" ON "AuditLog"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_name_key" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_replacesId_key" ON "Document"("replacesId");

-- CreateIndex
CREATE INDEX "Document_applicantId_category_idx" ON "Document"("applicantId", "category");

-- CreateIndex
CREATE INDEX "Document_scanStatus_status_idx" ON "Document"("scanStatus", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_name_key" ON "Industry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "JobRole_title_key" ON "JobRole"("title");

-- CreateIndex
CREATE UNIQUE INDEX "CareerPreference_applicantId_key" ON "CareerPreference"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "IndustryPreference_preferenceId_rank_key" ON "IndustryPreference"("preferenceId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPreference_preferenceId_rank_key" ON "CompanyPreference"("preferenceId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_code_key" ON "Competency"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyFramework_jobRoleId_version_key" ON "CompetencyFramework"("jobRoleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentBlueprint_jobRoleId_version_key" ON "AssessmentBlueprint"("jobRoleId", "version");

-- CreateIndex
CREATE INDEX "AssessmentSlot_startsAt_idx" ON "AssessmentSlot"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSlot_availabilityId_startsAt_key" ON "AssessmentSlot"("availabilityId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentBooking_rescheduledFromId_key" ON "AssessmentBooking"("rescheduledFromId");

-- CreateIndex
CREATE INDEX "AssessmentBooking_slotId_status_idx" ON "AssessmentBooking"("slotId", "status");

-- CreateIndex
CREATE INDEX "AssessmentBooking_applicantId_createdAt_idx" ON "AssessmentBooking"("applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentBooking_applicantId_idempotencyKey_key" ON "AssessmentBooking"("applicantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_createdAt_idx" ON "NotificationOutbox"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicantProfile" ADD CONSTRAINT "ApplicantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMfaCredential" ADD CONSTRAINT "AdminMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerification" ADD CONSTRAINT "DocumentVerification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVerification" ADD CONSTRAINT "DocumentVerification_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvidence" ADD CONSTRAINT "VerificationEvidence_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationStatusHistory" ADD CONSTRAINT "VerificationStatusHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnalysisJob" ADD CONSTRAINT "DocumentAnalysisJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySuggestion" ADD CONSTRAINT "CompanySuggestion_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRoleIndustry" ADD CONSTRAINT "JobRoleIndustry_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRoleIndustry" ADD CONSTRAINT "JobRoleIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerPreference" ADD CONSTRAINT "CareerPreference_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareerPreference" ADD CONSTRAINT "CareerPreference_primaryRoleId_fkey" FOREIGN KEY ("primaryRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryPreference" ADD CONSTRAINT "IndustryPreference_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "CareerPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndustryPreference" ADD CONSTRAINT "IndustryPreference_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPreference" ADD CONSTRAINT "CompanyPreference_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "CareerPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPreference" ADD CONSTRAINT "CompanyPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyFramework" ADD CONSTRAINT "CompetencyFramework_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkCompetency" ADD CONSTRAINT "FrameworkCompetency_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "CompetencyFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkCompetency" ADD CONSTRAINT "FrameworkCompetency_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBlueprint" ADD CONSTRAINT "AssessmentBlueprint_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBlueprint" ADD CONSTRAINT "AssessmentBlueprint_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "CompetencyFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAvailability" ADD CONSTRAINT "AssessmentAvailability_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "AssessmentBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSlot" ADD CONSTRAINT "AssessmentSlot_availabilityId_fkey" FOREIGN KEY ("availabilityId") REFERENCES "AssessmentAvailability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "AssessmentBooking_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "AssessmentBooking_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "AssessmentBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "AssessmentBooking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AssessmentSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "AssessmentBooking_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "AssessmentBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBookingEvent" ADD CONSTRAINT "AssessmentBookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "AssessmentBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additional invariants not expressible in Prisma schema syntax.
ALTER TABLE "IndustryPreference" ADD CONSTRAINT "industry_preference_rank" CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE "CompanyPreference" ADD CONSTRAINT "company_preference_rank" CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE "FrameworkCompetency" ADD CONSTRAINT "positive_weight" CHECK (weight BETWEEN 1 AND 100);
ALTER TABLE "AssessmentBlueprint" ADD CONSTRAINT "positive_duration" CHECK ("durationMinutes" BETWEEN 15 AND 240);
ALTER TABLE "AssessmentAvailability" ADD CONSTRAINT "availability_bounds" CHECK ("endsAt">"startsAt" AND capacity BETWEEN 1 AND 100 AND "minNoticeMinutes">=0 AND "maxHorizonDays">0 AND "cancellationNoticeMinutes">=0 AND "rescheduleLimit">=0);
ALTER TABLE "AssessmentSlot" ADD CONSTRAINT "slot_bounds" CHECK ("endsAt">"startsAt");
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "positive_seat" CHECK (seat>0);
CREATE UNIQUE INDEX "one_scheduled_booking_per_applicant" ON "AssessmentBooking"("applicantId") WHERE status='SCHEDULED';
CREATE UNIQUE INDEX "one_scheduled_booking_per_seat" ON "AssessmentBooking"("slotId",seat) WHERE status='SCHEDULED';
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "AssessmentAvailability" ADD CONSTRAINT "nonoverlapping_blueprint_windows" EXCLUDE USING gist ("blueprintId" WITH =,tstzrange("startsAt","endsAt",'[)') WITH &&) WHERE (active);
CREATE FUNCTION enforce_booking_slot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE slot_blueprint uuid; slot_capacity integer;
BEGIN
 SELECT a."blueprintId", a.capacity INTO slot_blueprint, slot_capacity FROM "AssessmentSlot" s JOIN "AssessmentAvailability" a ON a.id=s."availabilityId" WHERE s.id=NEW."slotId";
 IF NEW."blueprintId" <> slot_blueprint OR NEW.seat > slot_capacity THEN RAISE EXCEPTION 'Invalid booking slot or capacity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "booking_slot_integrity" BEFORE INSERT OR UPDATE ON "AssessmentBooking" FOR EACH ROW EXECUTE FUNCTION enforce_booking_slot();
