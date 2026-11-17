-- CreateEnum
CREATE TYPE "TrainerStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TrainerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "TrainerInvitation" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "TrainerInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "acceptedById" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "biography" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'KE',
    "region" TEXT NOT NULL DEFAULT '',
    "yearsExperience" INTEGER NOT NULL DEFAULT 0,
    "expertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TrainerStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrainerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerQualification" (
    "cleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "storageDeletedAt" TIMESTAMPTZ(3),
    "id" UUID NOT NULL,
    "trainerProfileId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'QUARANTINED',
    "withdrawnAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerReview" (
    "id" UUID NOT NULL,
    "trainerProfileId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "fromStatus" "TrainerStatus" NOT NULL,
    "outcome" "TrainerStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainerInvitation_tokenHash_key" ON "TrainerInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TrainerInvitation_email_status_idx" ON "TrainerInvitation"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerProfile_userId_key" ON "TrainerProfile"("userId");

-- CreateIndex
CREATE INDEX "TrainerProfile_status_updatedAt_idx" ON "TrainerProfile"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerQualification_storageKey_key" ON "TrainerQualification"("storageKey");

-- CreateIndex
CREATE INDEX "TrainerQualification_trainerProfileId_withdrawnAt_idx" ON "TrainerQualification"("trainerProfileId", "withdrawnAt");

-- CreateIndex
CREATE INDEX "TrainerQualification_scanStatus_idx" ON "TrainerQualification"("scanStatus");

-- CreateIndex
CREATE INDEX "TrainerReview_trainerProfileId_createdAt_idx" ON "TrainerReview"("trainerProfileId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrainerInvitation" ADD CONSTRAINT "TrainerInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerInvitation" ADD CONSTRAINT "TrainerInvitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "TrainerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerQualification" ADD CONSTRAINT "TrainerQualification_trainerProfileId_fkey" FOREIGN KEY ("trainerProfileId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerReview" ADD CONSTRAINT "TrainerReview_trainerProfileId_fkey" FOREIGN KEY ("trainerProfileId") REFERENCES "TrainerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerReview" ADD CONSTRAINT "TrainerReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One live invitation per email; resends revoke old links transactionally.
CREATE UNIQUE INDEX "one_pending_trainer_invitation" ON "TrainerInvitation"(email) WHERE status='PENDING';
ALTER TABLE "TrainerProfile" ADD CONSTRAINT "trainer_experience_bounds" CHECK ("yearsExperience" BETWEEN 0 AND 60 AND cardinality(expertise)<=10 AND version>=0);
ALTER TABLE "TrainerQualification" ADD CONSTRAINT "trainer_qualification_bounds" CHECK (size>0 AND category IN ('DEGREE','DIPLOMA','CERTIFICATION','REGISTRATION','OTHER') AND ("expiresAt" IS NULL OR "expiresAt">"issuedAt"));
INSERT INTO "Role" (id,name) VALUES (gen_random_uuid(),'TRAINER') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Permission" (id,name) VALUES (gen_random_uuid(),'trainer.profile.read.self'),(gen_random_uuid(),'trainer.profile.update.self'),(gen_random_uuid(),'trainer.qualifications.manage.self'),(gen_random_uuid(),'trainers.manage') ON CONFLICT (name) DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r CROSS JOIN "Permission" p WHERE r.name='TRAINER' AND p.name IN ('trainer.profile.read.self','trainer.profile.update.self','trainer.qualifications.manage.self') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId","permissionId") SELECT r.id,p.id FROM "Role" r CROSS JOIN "Permission" p WHERE r.name='ADMIN' AND p.name='trainers.manage' ON CONFLICT DO NOTHING;
