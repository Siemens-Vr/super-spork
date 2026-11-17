ALTER TABLE "AssessmentBlueprint" DROP CONSTRAINT "positive_duration";
ALTER TABLE "AssessmentBlueprint" ADD CONSTRAINT "positive_duration"
  CHECK ("durationMinutes" BETWEEN 10 AND 240);
