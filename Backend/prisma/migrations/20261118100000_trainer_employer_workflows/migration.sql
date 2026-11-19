-- CreateEnum
CREATE TYPE "TrainingProgress" AS ENUM ('IN_PROGRESS', 'NEEDS_ATTENTION', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrainingAttendance" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "MockInterviewOutcome" AS ENUM ('PASSED', 'FAILED');

-- AlterTable
ALTER TABLE "TrainerProfile" ADD COLUMN     "workingHours" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "TrainerSkill" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TrainingAssignment" ADD COLUMN     "performanceNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "progress" "TrainingProgress" NOT NULL DEFAULT 'IN_PROGRESS',
ADD COLUMN     "signedOffAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "sessionId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "verifiedBy" UUID NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendance" "TrainingAttendance",

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("sessionId","assignmentId")
);

-- CreateTable
CREATE TABLE "MockInterview" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "instructions" TEXT NOT NULL,
    "outcome" "MockInterviewOutcome",

    CONSTRAINT "MockInterview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateAccess" (
    "id" UUID NOT NULL,
    "employerId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedBy" UUID,
    "procurementReference" TEXT,

    CONSTRAINT "CandidateAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingEnrollment_assignmentId_idx" ON "TrainingEnrollment"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MockInterview_attemptId_key" ON "MockInterview"("attemptId");

-- CreateIndex
CREATE INDEX "MockInterview_outcome_id_idx" ON "MockInterview"("outcome", "id");

-- CreateIndex
CREATE INDEX "CandidateAccess_confirmedAt_id_idx" ON "CandidateAccess"("confirmedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateAccess_employerId_interviewId_key" ON "CandidateAccess"("employerId", "interviewId");

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockInterview" ADD CONSTRAINT "MockInterview_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAccess" ADD CONSTRAINT "CandidateAccess_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateAccess" ADD CONSTRAINT "CandidateAccess_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "MockInterview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT INTO "Role" (id, name) VALUES (gen_random_uuid(), 'EMPLOYER') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Permission" (id, name) VALUES (gen_random_uuid(), 'hiring.discover') ON CONFLICT (name) DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id FROM "Role" r CROSS JOIN "Permission" p
WHERE r.name = 'EMPLOYER' AND p.name = 'hiring.discover'
ON CONFLICT DO NOTHING;

ALTER TABLE "TrainingAssignment"
  ADD CONSTRAINT "TrainingAssignment_signoff_matches_progress"
  CHECK (("progress" = 'COMPLETED') = ("signedOffAt" IS NOT NULL));

ALTER TABLE "CandidateAccess"
  ADD CONSTRAINT "CandidateAccess_confirmation_complete"
  CHECK (("confirmedAt" IS NULL AND "confirmedBy" IS NULL AND "procurementReference" IS NULL)
      OR ("confirmedAt" IS NOT NULL AND "confirmedBy" IS NOT NULL AND "procurementReference" IS NOT NULL));
