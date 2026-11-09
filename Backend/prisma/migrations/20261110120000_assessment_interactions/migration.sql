-- AlterTable
ALTER TABLE "AssessmentBlueprint" ADD COLUMN     "interactionPolicy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "AssessmentScenario" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "evaluationCriteria" TEXT NOT NULL,
    "competencyIds" UUID[],
    "maxFollowups" INTEGER NOT NULL DEFAULT 2,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlueprintScenario" (
    "blueprintId" UUID NOT NULL,
    "scenarioId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "BlueprintScenario_pkey" PRIMARY KEY ("blueprintId","scenarioId")
);

-- CreateTable
CREATE TABLE "AssessmentAccommodation" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "waiveCamera" BOOLEAN NOT NULL DEFAULT false,
    "waiveMicrophone" BOOLEAN NOT NULL DEFAULT false,
    "allowText" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "approvedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentAccommodation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentInteractionSession" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "policy" JSONB NOT NULL,
    "preflight" JSONB NOT NULL,
    "scenarios" JSONB NOT NULL,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "pendingResponseId" UUID,
    "evaluation" JSONB,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentInteractionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentConversationMessage" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "scenarioIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResponse" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "promptId" UUID NOT NULL,
    "origin" TEXT NOT NULL,
    "confirmedText" TEXT NOT NULL,
    "transcriptionId" UUID,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentTranscription" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "language" TEXT NOT NULL,
    "originalText" TEXT,
    "durationMs" INTEGER,
    "byteLength" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentTranscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptCorrection" (
    "id" UUID NOT NULL,
    "transcriptionId" UUID NOT NULL,
    "originalText" TEXT NOT NULL,
    "confirmedText" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSpeech" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentSpeech_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSessionEvent" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentGraphCheckpoint" (
    "sessionId" UUID NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT '',
    "checkpointId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "metadataType" TEXT NOT NULL,
    "metadata" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentGraphCheckpoint_pkey" PRIMARY KEY ("sessionId","namespace","checkpointId")
);

-- CreateTable
CREATE TABLE "AssessmentGraphWrite" (
    "sessionId" UUID NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT '',
    "checkpointId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskPath" TEXT NOT NULL DEFAULT '',
    "idx" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "AssessmentGraphWrite_pkey" PRIMARY KEY ("sessionId","namespace","checkpointId","taskId","idx")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentScenario_code_version_key" ON "AssessmentScenario"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BlueprintScenario_blueprintId_position_key" ON "BlueprintScenario"("blueprintId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAccommodation_attemptId_key" ON "AssessmentAccommodation"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentInteractionSession_attemptId_key" ON "AssessmentInteractionSession"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentInteractionSession_bookingId_key" ON "AssessmentInteractionSession"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentConversationMessage_sessionId_sequence_key" ON "AssessmentConversationMessage"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_transcriptionId_key" ON "AssessmentResponse"("transcriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResponse_sessionId_idempotencyKey_key" ON "AssessmentResponse"("sessionId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "BlueprintScenario" ADD CONSTRAINT "BlueprintScenario_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "AssessmentBlueprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintScenario" ADD CONSTRAINT "BlueprintScenario_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "AssessmentScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAccommodation" ADD CONSTRAINT "AssessmentAccommodation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentInteractionSession" ADD CONSTRAINT "AssessmentInteractionSession_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentInteractionSession" ADD CONSTRAINT "AssessmentInteractionSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "AssessmentBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentConversationMessage" ADD CONSTRAINT "AssessmentConversationMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "AssessmentResponse_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "AssessmentTranscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentTranscription" ADD CONSTRAINT "AssessmentTranscription_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptCorrection" ADD CONSTRAINT "TranscriptCorrection_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "AssessmentTranscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSpeech" ADD CONSTRAINT "AssessmentSpeech_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSpeech" ADD CONSTRAINT "AssessmentSpeech_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssessmentConversationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSessionEvent" ADD CONSTRAINT "AssessmentSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentGraphCheckpoint" ADD CONSTRAINT "AssessmentGraphCheckpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentGraphWrite" ADD CONSTRAINT "AssessmentGraphWrite_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentInteractionSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bound the controlled workflow and keep mode/status values valid across direct writes.
ALTER TABLE "AssessmentScenario" ADD CONSTRAINT "scenario_bounds" CHECK (version > 0 AND "maxFollowups" BETWEEN 0 AND 3 AND cardinality("competencyIds") BETWEEN 1 AND 30);
ALTER TABLE "AssessmentInteractionSession" ADD CONSTRAINT "session_mode" CHECK (mode IN ('TEXT','VOICE'));
ALTER TABLE "AssessmentInteractionSession" ADD CONSTRAINT "session_status" CHECK (status IN ('ACTIVE','INTERRUPTED','AWAITING_REVIEW','COMPLETED'));
ALTER TABLE "AssessmentResponse" ADD CONSTRAINT "response_origin" CHECK (origin IN ('TEXT','VOICE'));
ALTER TABLE "AssessmentConversationMessage" ADD CONSTRAINT "conversation_role" CHECK (role IN ('AI','APPLICANT'));
ALTER TABLE "AssessmentTranscription" ADD CONSTRAINT "transcription_status" CHECK (status IN ('PENDING','COMPLETED','FAILED'));
