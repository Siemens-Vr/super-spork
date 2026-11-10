ALTER TABLE "Session" ADD COLUMN "absoluteExpiresAt" TIMESTAMPTZ(3), ADD COLUMN "revokedAt" TIMESTAMPTZ(3);
UPDATE "Session" SET "absoluteExpiresAt" = "expiresAt";
ALTER TABLE "Session" ALTER COLUMN "absoluteExpiresAt" SET NOT NULL, ALTER COLUMN "absoluteExpiresAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Document" ADD COLUMN "cleanupPending" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "storageDeletedAt" TIMESTAMPTZ(3);
UPDATE "Document" SET "cleanupPending" = true WHERE "scanStatus" = 'INFECTED';
CREATE INDEX "Document_cleanupPending_idx" ON "Document"("cleanupPending");
ALTER TYPE "AssessmentTargetStatus" ADD VALUE 'ABANDONED';
ALTER TABLE "AssessmentInteractionSession" DROP CONSTRAINT "session_status";
ALTER TABLE "AssessmentInteractionSession" ADD CONSTRAINT "session_status" CHECK (status IN ('ACTIVE','INTERRUPTED','AWAITING_REVIEW','COMPLETED','EXPIRED','ABANDONED'));
