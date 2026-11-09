BEGIN;

-- Carry forward unconverted choices as editable targets; completed/current targets stay authoritative.
INSERT INTO "AssessmentTarget" (id, "applicantId", "jobRoleId", status, "createdAt", "updatedAt")
SELECT p.id, p."applicantId", p."primaryRoleId", 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "CareerPreference" p
WHERE NOT EXISTS (SELECT 1 FROM "AssessmentTarget" t WHERE t."applicantId"=p."applicantId");
INSERT INTO "AssessmentTargetIndustry" ("targetId", "industryId", rank)
SELECT i."preferenceId", i."industryId", i.rank FROM "IndustryPreference" i
JOIN "AssessmentTarget" t ON t.id=i."preferenceId" AND t.status='DRAFT';
INSERT INTO "AssessmentTargetCompany" ("targetId", "companyId", rank)
SELECT c."preferenceId", c."companyId", c.rank FROM "CompanyPreference" c
JOIN "AssessmentTarget" t ON t.id=c."preferenceId" AND t.status='DRAFT';

-- DropForeignKey
ALTER TABLE "CareerPreference" DROP CONSTRAINT "CareerPreference_applicantId_fkey";

-- DropForeignKey
ALTER TABLE "CareerPreference" DROP CONSTRAINT "CareerPreference_primaryRoleId_fkey";

-- DropForeignKey
ALTER TABLE "CompanyPreference" DROP CONSTRAINT "CompanyPreference_companyId_fkey";

-- DropForeignKey
ALTER TABLE "CompanyPreference" DROP CONSTRAINT "CompanyPreference_preferenceId_fkey";

-- DropForeignKey
ALTER TABLE "IndustryPreference" DROP CONSTRAINT "IndustryPreference_industryId_fkey";

-- DropForeignKey
ALTER TABLE "IndustryPreference" DROP CONSTRAINT "IndustryPreference_preferenceId_fkey";

-- DropTable
DROP TABLE "CareerPreference";

-- DropTable
DROP TABLE "CompanyPreference";

-- DropTable
DROP TABLE "IndustryPreference";

COMMIT;
