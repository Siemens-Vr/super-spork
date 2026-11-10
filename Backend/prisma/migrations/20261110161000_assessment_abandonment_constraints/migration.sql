-- The enum addition is committed by the preceding migration before it is used here.
DROP INDEX "one_active_assessment_target_per_applicant";
CREATE UNIQUE INDEX "one_active_assessment_target_per_applicant" ON "AssessmentTarget"("applicantId") WHERE status IN ('DRAFT','PREPARED','IN_PROGRESS');
ALTER TABLE "AssessmentTarget" DROP CONSTRAINT "target_timestamps";
ALTER TABLE "AssessmentTarget" ADD CONSTRAINT "target_timestamps" CHECK (
 (status = 'DRAFT' AND "lockedAt" IS NULL AND "completedAt" IS NULL) OR
 (status IN ('PREPARED','IN_PROGRESS') AND "lockedAt" IS NOT NULL AND "completedAt" IS NULL) OR
 (status = 'COMPLETED' AND "lockedAt" IS NOT NULL AND "completedAt" IS NOT NULL) OR
 (status = 'ABANDONED' AND "completedAt" IS NULL)
);
CREATE OR REPLACE FUNCTION protect_assessment_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'DRAFT' AND (NEW."jobRoleId" <> OLD."jobRoleId" OR NEW."applicantId" <> OLD."applicantId" OR NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt") THEN
   RAISE EXCEPTION 'Prepared assessment inputs are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.status <> OLD.status AND NOT (
   (OLD.status='DRAFT' AND NEW.status='PREPARED') OR
   (OLD.status='PREPARED' AND NEW.status='IN_PROGRESS') OR
   (OLD.status='IN_PROGRESS' AND NEW.status='COMPLETED') OR
   (OLD.status IN ('DRAFT','PREPARED','IN_PROGRESS') AND NEW.status='ABANDONED')
 ) THEN RAISE EXCEPTION 'Invalid assessment target transition' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('COMPLETED','ABANDONED') AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Terminal assessment target is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
