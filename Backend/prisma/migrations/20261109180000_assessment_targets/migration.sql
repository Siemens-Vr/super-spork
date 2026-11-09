-- CreateEnum
CREATE TYPE "AssessmentTargetStatus" AS ENUM ('DRAFT', 'PREPARED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RequirementScope" AS ENUM ('CORE', 'INDUSTRY', 'COMPANY', 'COURSE');

-- CreateEnum
CREATE TYPE "LearningStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "AssessmentBooking" ADD COLUMN     "targetId" UUID;

-- AlterTable
ALTER TABLE "CompetencyFramework" ADD COLUMN     "companyId" UUID,
ADD COLUMN     "courseName" TEXT,
ADD COLUMN     "industryId" UUID,
ADD COLUMN     "scope" "RequirementScope" NOT NULL DEFAULT 'CORE';

-- AlterTable
ALTER TABLE "FrameworkCompetency" ADD COLUMN     "learningObjective" TEXT,
ADD COLUMN     "learningResources" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requiredScore" INTEGER NOT NULL DEFAULT 70;

-- CreateTable
CREATE TABLE "AssessmentTarget" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "jobRoleId" UUID NOT NULL,
    "status" "AssessmentTargetStatus" NOT NULL DEFAULT 'DRAFT',
    "lockedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTargetIndustry" (
    "targetId" UUID NOT NULL,
    "industryId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "AssessmentTargetIndustry_pkey" PRIMARY KEY ("targetId","industryId")
);

-- CreateTable
CREATE TABLE "AssessmentTargetCompany" (
    "targetId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "AssessmentTargetCompany_pkey" PRIMARY KEY ("targetId","companyId")
);

-- CreateTable
CREATE TABLE "AssessmentTargetQualification" (
    "targetId" UUID NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "AssessmentTargetQualification_pkey" PRIMARY KEY ("targetId","documentId")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "blueprintId" UUID NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "assessorId" UUID,
    "completionKey" TEXT,
    "completionHash" TEXT,
    "overallScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentRequirement" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requiredScore" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "sources" JSONB NOT NULL,
    "learningObjective" TEXT NOT NULL,
    "learningResources" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "AssessmentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentCompetencyResult" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "gap" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "AssessmentCompetencyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPlan" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "status" "LearningStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LearningPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPlanItem" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "priority" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "LearningStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LearningPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentTarget_applicantId_createdAt_idx" ON "AssessmentTarget"("applicantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTargetIndustry_targetId_rank_key" ON "AssessmentTargetIndustry"("targetId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentTargetCompany_targetId_rank_key" ON "AssessmentTargetCompany"("targetId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_targetId_key" ON "AssessmentAttempt"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequirement_attemptId_competencyId_key" ON "AssessmentRequirement"("attemptId", "competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentCompetencyResult_requirementId_key" ON "AssessmentCompetencyResult"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPlan_attemptId_key" ON "LearningPlan"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPlanItem_resultId_key" ON "LearningPlanItem"("resultId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningPlanItem_planId_priority_key" ON "LearningPlanItem"("planId", "priority");

-- CreateIndex
CREATE INDEX "AssessmentBooking_targetId_idx" ON "AssessmentBooking"("targetId");

-- AddForeignKey
ALTER TABLE "CompetencyFramework" ADD CONSTRAINT "CompetencyFramework_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetencyFramework" ADD CONSTRAINT "CompetencyFramework_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBooking" ADD CONSTRAINT "AssessmentBooking_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AssessmentTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTarget" ADD CONSTRAINT "AssessmentTarget_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTarget" ADD CONSTRAINT "AssessmentTarget_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetIndustry" ADD CONSTRAINT "AssessmentTargetIndustry_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AssessmentTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetIndustry" ADD CONSTRAINT "AssessmentTargetIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetCompany" ADD CONSTRAINT "AssessmentTargetCompany_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AssessmentTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetCompany" ADD CONSTRAINT "AssessmentTargetCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetQualification" ADD CONSTRAINT "AssessmentTargetQualification_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AssessmentTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTargetQualification" ADD CONSTRAINT "AssessmentTargetQualification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "AssessmentTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "AssessmentBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assessorId_fkey" FOREIGN KEY ("assessorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequirement" ADD CONSTRAINT "AssessmentRequirement_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequirement" ADD CONSTRAINT "AssessmentRequirement_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCompetencyResult" ADD CONSTRAINT "AssessmentCompetencyResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentCompetencyResult" ADD CONSTRAINT "AssessmentCompetencyResult_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "AssessmentRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPlanItem" ADD CONSTRAINT "LearningPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "LearningPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningPlanItem" ADD CONSTRAINT "LearningPlanItem_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AssessmentCompetencyResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One career at a time, even when requests race or bypass the API.
CREATE UNIQUE INDEX "one_active_assessment_target_per_applicant" ON "AssessmentTarget"("applicantId") WHERE status <> 'COMPLETED';
ALTER TABLE "AssessmentTargetIndustry" ADD CONSTRAINT "target_industry_rank" CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE "AssessmentTargetCompany" ADD CONSTRAINT "target_company_rank" CHECK (rank BETWEEN 1 AND 3);
ALTER TABLE "CompetencyFramework" ADD CONSTRAINT "framework_scope_context" CHECK (
 (scope = 'CORE' AND "industryId" IS NULL AND "companyId" IS NULL AND "courseName" IS NULL) OR
 (scope = 'INDUSTRY' AND "industryId" IS NOT NULL AND "companyId" IS NULL AND "courseName" IS NULL) OR
 (scope = 'COMPANY' AND "companyId" IS NOT NULL AND "industryId" IS NULL AND "courseName" IS NULL) OR
 (scope = 'COURSE' AND "courseName" IS NOT NULL AND length(trim("courseName")) >= 2 AND "industryId" IS NULL AND "companyId" IS NULL)
);
ALTER TABLE "FrameworkCompetency" ADD CONSTRAINT "framework_required_score" CHECK ("requiredScore" BETWEEN 1 AND 100);
ALTER TABLE "AssessmentRequirement" ADD CONSTRAINT "requirement_bounds" CHECK ("requiredScore" BETWEEN 1 AND 100 AND weight > 0);
ALTER TABLE "AssessmentCompetencyResult" ADD CONSTRAINT "result_bounds" CHECK (score BETWEEN 0 AND 100 AND gap BETWEEN 0 AND 100 AND length(trim(evidence)) >= 10);
ALTER TABLE "AssessmentTarget" ADD CONSTRAINT "target_timestamps" CHECK (
 (status = 'DRAFT' AND "lockedAt" IS NULL AND "completedAt" IS NULL) OR
 (status IN ('PREPARED','IN_PROGRESS') AND "lockedAt" IS NOT NULL AND "completedAt" IS NULL) OR
 (status = 'COMPLETED' AND "lockedAt" IS NOT NULL AND "completedAt" IS NOT NULL)
);
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "attempt_completion" CHECK (
 ("completedAt" IS NULL AND "overallScore" IS NULL AND "assessorId" IS NULL AND "completionKey" IS NULL AND "completionHash" IS NULL) OR
 ("completedAt" IS NOT NULL AND "startedAt" IS NOT NULL AND "completedAt" >= "startedAt" AND "assessorId" IS NOT NULL AND "completionKey" IS NOT NULL AND "completionHash" IS NOT NULL AND "overallScore" BETWEEN 0 AND 100)
);
CREATE FUNCTION protect_assessment_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status <> 'DRAFT' AND (NEW."jobRoleId" <> OLD."jobRoleId" OR NEW."applicantId" <> OLD."applicantId" OR NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt") THEN
   RAISE EXCEPTION 'Prepared assessment inputs are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.status <> OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='PREPARED') OR (OLD.status='PREPARED' AND NEW.status='IN_PROGRESS') OR (OLD.status='IN_PROGRESS' AND NEW.status='COMPLETED')) THEN
   RAISE EXCEPTION 'Invalid assessment target transition' USING ERRCODE='23514';
 END IF;
 IF OLD.status='COMPLETED' AND NEW IS DISTINCT FROM OLD THEN
   RAISE EXCEPTION 'Completed assessment target is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "protect_assessment_target" BEFORE UPDATE ON "AssessmentTarget" FOR EACH ROW EXECUTE FUNCTION protect_assessment_target();
CREATE FUNCTION protect_target_selection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_status "AssessmentTargetStatus";
BEGIN
 SELECT status INTO target_status FROM "AssessmentTarget" WHERE id = CASE WHEN TG_OP='DELETE' THEN OLD."targetId" ELSE NEW."targetId" END FOR UPDATE;
 IF target_status <> 'DRAFT' THEN RAISE EXCEPTION 'Prepared assessment choices are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND NEW."targetId" <> OLD."targetId" THEN RAISE EXCEPTION 'Cannot move target selections' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "protect_target_industries" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentTargetIndustry" FOR EACH ROW EXECUTE FUNCTION protect_target_selection();
CREATE TRIGGER "protect_target_companies" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentTargetCompany" FOR EACH ROW EXECUTE FUNCTION protect_target_selection();
CREATE TRIGGER "protect_target_qualifications" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentTargetQualification" FOR EACH ROW EXECUTE FUNCTION protect_target_selection();
CREATE FUNCTION protect_assessment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."contextSnapshot" IS DISTINCT FROM OLD."contextSnapshot" OR NEW."targetId" <> OLD."targetId" OR NEW."blueprintId" <> OLD."blueprintId" OR (OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt") OR OLD."completedAt" IS NOT NULL THEN
   RAISE EXCEPTION 'Assessment snapshots and completed results are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW."completedAt" IS NOT NULL AND (SELECT count(*) FROM "AssessmentRequirement" WHERE "attemptId"=NEW.id) <> (SELECT count(*) FROM "AssessmentCompetencyResult" WHERE "attemptId"=NEW.id) THEN
   RAISE EXCEPTION 'Every requirement needs a result' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "protect_assessment_attempt" BEFORE UPDATE ON "AssessmentAttempt" FOR EACH ROW EXECUTE FUNCTION protect_assessment_attempt();
CREATE FUNCTION protect_assessment_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_status "AssessmentTargetStatus";
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Frozen rubric rows are immutable' USING ERRCODE='23514'; END IF;
 SELECT t.status INTO target_status FROM "AssessmentTarget" t JOIN "AssessmentAttempt" a ON a."targetId"=t.id WHERE a.id=NEW."attemptId";
 IF target_status <> 'DRAFT' THEN RAISE EXCEPTION 'Cannot add to a prepared rubric' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "protect_assessment_requirement" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentRequirement" FOR EACH ROW EXECUTE FUNCTION protect_assessment_requirement();
CREATE FUNCTION enforce_assessment_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE required_score integer; requirement_attempt uuid; attempt_completed timestamptz; target_status "AssessmentTargetStatus";
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Assessment results are immutable' USING ERRCODE='23514'; END IF;
 SELECT "requiredScore", "attemptId" INTO required_score, requirement_attempt FROM "AssessmentRequirement" WHERE id=NEW."requirementId";
 SELECT a."completedAt", t.status INTO attempt_completed, target_status FROM "AssessmentAttempt" a JOIN "AssessmentTarget" t ON t.id=a."targetId" WHERE a.id=NEW."attemptId";
 IF requirement_attempt <> NEW."attemptId" OR attempt_completed IS NOT NULL OR target_status <> 'IN_PROGRESS' OR NEW.gap <> greatest(required_score - NEW.score, 0) THEN
   RAISE EXCEPTION 'Invalid competency result or assessment state' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "assessment_result_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentCompetencyResult" FOR EACH ROW EXECUTE FUNCTION enforce_assessment_result();
CREATE FUNCTION enforce_booking_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; target_role uuid; blueprint_role uuid; prepared_blueprint uuid; target_status "AssessmentTargetStatus";
BEGIN
 IF NEW."targetId" IS NULL THEN RETURN NEW; END IF;
 SELECT "applicantId", "jobRoleId", status INTO owner_id, target_role, target_status FROM "AssessmentTarget" WHERE id=NEW."targetId";
 SELECT "jobRoleId" INTO blueprint_role FROM "AssessmentBlueprint" WHERE id=NEW."blueprintId";
 SELECT "blueprintId" INTO prepared_blueprint FROM "AssessmentAttempt" WHERE "targetId"=NEW."targetId";
 IF owner_id <> NEW."applicantId" OR target_role <> blueprint_role OR prepared_blueprint IS DISTINCT FROM NEW."blueprintId" OR (NEW.status='SCHEDULED' AND target_status='COMPLETED') THEN
   RAISE EXCEPTION 'Booking must match its prepared target and applicant' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "booking_target_integrity" BEFORE INSERT OR UPDATE ON "AssessmentBooking" FOR EACH ROW EXECUTE FUNCTION enforce_booking_target();
CREATE FUNCTION enforce_learning_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_attempt uuid; result_attempt uuid; result_gap integer;
BEGIN
 SELECT "attemptId" INTO plan_attempt FROM "LearningPlan" WHERE id=NEW."planId";
 SELECT "attemptId", gap INTO result_attempt, result_gap FROM "AssessmentCompetencyResult" WHERE id=NEW."resultId";
 IF plan_attempt <> result_attempt OR result_gap <= 0 THEN RAISE EXCEPTION 'Learning item must address a gap in its own assessment' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW."planId" <> OLD."planId" OR NEW."resultId" <> OLD."resultId" OR NEW.objective <> OLD.objective OR NEW.resources IS DISTINCT FROM OLD.resources) THEN
   RAISE EXCEPTION 'Learning recommendations are immutable; only progress may change' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "learning_item_integrity" BEFORE INSERT OR UPDATE ON "LearningPlanItem" FOR EACH ROW EXECUTE FUNCTION enforce_learning_item();

-- Existing administrators receive the new granular review permission; applicants do not.
INSERT INTO "Permission" (id, name) VALUES (gen_random_uuid(), 'assessments.review') ON CONFLICT (name) DO NOTHING;
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT r.id, p.id FROM "Role" r CROSS JOIN "Permission" p WHERE r.name='ADMIN' AND p.name='assessments.review' ON CONFLICT DO NOTHING;
