CREATE TABLE "TrainerSkill" (
 "trainerId" UUID NOT NULL REFERENCES "TrainerProfile"("userId") ON DELETE RESTRICT,
 "competencyId" UUID NOT NULL REFERENCES "Competency"(id) ON DELETE RESTRICT,
 PRIMARY KEY ("trainerId","competencyId")
);
CREATE TABLE "TrainingAssignment" (
 id UUID PRIMARY KEY, "learningItemId" UUID NOT NULL UNIQUE REFERENCES "LearningPlanItem"(id) ON DELETE RESTRICT,
 "trainerId" UUID NOT NULL, "competencyId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("trainerId","competencyId") REFERENCES "TrainerSkill"("trainerId","competencyId") ON DELETE RESTRICT
);
CREATE INDEX "TrainingAssignment_trainerId_competencyId_idx" ON "TrainingAssignment"("trainerId","competencyId");
CREATE TABLE "TrainingSession" (
 id UUID PRIMARY KEY, "trainerId" UUID NOT NULL, "competencyId" UUID NOT NULL,
 title TEXT NOT NULL, "startsAt" TIMESTAMPTZ(3) NOT NULL, "endsAt" TIMESTAMPTZ(3) NOT NULL,
 location TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 500),
 "cancelledAt" TIMESTAMPTZ(3), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("trainerId","competencyId") REFERENCES "TrainerSkill"("trainerId","competencyId") ON DELETE RESTRICT,
 CHECK ("endsAt">"startsAt"),
 EXCLUDE USING gist ("trainerId" WITH =, tstzrange("startsAt","endsAt",'[)') WITH &&) WHERE ("cancelledAt" IS NULL)
);
CREATE INDEX "TrainingSession_trainerId_startsAt_idx" ON "TrainingSession"("trainerId","startsAt");
