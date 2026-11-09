CREATE TYPE "InstitutionType" AS ENUM ('UNIVERSITY', 'COLLEGE', 'TRAINING_INSTITUTE', 'OTHER');
ALTER TABLE "Institution" ADD COLUMN "type" "InstitutionType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "offersTvet" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sourceUrl" TEXT;
CREATE INDEX "Institution_type_active_idx" ON "Institution"("type", "active");
CREATE TABLE "InstitutionAlias" (
    "id" UUID NOT NULL,
    "institutionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "InstitutionAlias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstitutionAlias_institutionId_name_key" ON "InstitutionAlias"("institutionId", "name");
ALTER TABLE "InstitutionAlias" ADD CONSTRAINT "InstitutionAlias_institutionId_fkey"
FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
