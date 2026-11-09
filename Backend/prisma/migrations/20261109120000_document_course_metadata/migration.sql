-- Existing uploads retain their original metadata. New submissions validate names in the API.
ALTER TABLE "Document" ADD COLUMN "courseName" TEXT,
ADD COLUMN "certificationName" TEXT;
