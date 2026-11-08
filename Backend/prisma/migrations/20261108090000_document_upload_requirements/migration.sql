ALTER TABLE "Document" ADD COLUMN "institutionName" TEXT,
ADD COLUMN "qualificationId" UUID;
CREATE INDEX "Document_qualificationId_idx" ON "Document"("qualificationId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_qualificationId_fkey"
FOREIGN KEY ("qualificationId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
