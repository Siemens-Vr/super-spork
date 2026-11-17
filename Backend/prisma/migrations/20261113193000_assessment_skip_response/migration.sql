ALTER TABLE "AssessmentResponse" DROP CONSTRAINT "response_origin";
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "response_origin"
CHECK (origin IN ('TEXT', 'VOICE', 'SKIP'));
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "response_skip_payload"
CHECK (origin <> 'SKIP' OR ("confirmedText" = 'I don’t know / Skip this scenario.' AND "transcriptionId" IS NULL));
