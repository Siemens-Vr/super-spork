import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { startAttempt, getAttempt, completeAttempt } from './assessment-target.service.js';
import {
  assessmentGraph,
  graphConfig,
  type Workflow,
} from '../integrations/assessment-interview/graph.js';
import { interviewer } from '../integrations/assessment-interview/provider.js';
import { speechProviders, validateWav } from '../integrations/speech/providers.js';
import { env } from '../config/env.js';
import {
  interactionPolicySchema,
  frozenScenarioSchema,
  type sessionStartSchema,
  type confirmedResponseSchema,
  type browserTranscriptSchema,
} from '../validators/assessment-interaction.schema.js';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const includeBooking = {
  blueprint: { include: { framework: true } },
  slot: true,
  target: { include: { attempt: { include: { requirements: true, accommodation: true } } } },
} as const;
export async function ownedBooking(applicantId: string, id: string) {
  const booking = await prisma.assessmentBooking.findFirst({
    where: { id, applicantId },
    include: includeBooking,
  });
  requireCondition(booking, 404, 'NOT_FOUND', 'Assessment booking not found');
  requireCondition(
    booking.target?.attempt,
    409,
    'ATTEMPT_NOT_PREPARED',
    'Prepare your assessment target before taking the assessment',
  );
  return booking;
}
function requireWindow(booking: { status: string; slot: { startsAt: Date; endsAt: Date } }) {
  requireCondition(
    booking.status === 'SCHEDULED',
    409,
    'BOOKING_NOT_SCHEDULED',
    'Use a scheduled assessment booking',
  );
  requireCondition(
    booking.slot.startsAt <= new Date() && booking.slot.endsAt > new Date(),
    409,
    'ASSESSMENT_WINDOW_CLOSED',
    'Start and respond during your scheduled assessment window',
  );
}
function effectivePolicy(booking: Awaited<ReturnType<typeof ownedBooking>>) {
  const attempt = booking.target!.attempt!;
  const snapshot = attempt.contextSnapshot as { blueprint?: { interactionPolicy?: unknown } };
  const policy = interactionPolicySchema.parse(
    snapshot.blueprint?.interactionPolicy ?? booking.blueprint.interactionPolicy,
  );
  const accommodation = attempt.accommodation;
  return {
    ...policy,
    cameraRequired: policy.cameraRequired && !accommodation?.waiveCamera,
    microphoneRequired: policy.microphoneRequired && !accommodation?.waiveMicrophone,
    allowText: policy.allowText || !!accommodation?.allowText,
    accommodationId: accommodation?.id ?? null,
  };
}
export async function preflight(applicantId: string, bookingId: string) {
  const b = await ownedBooking(applicantId, bookingId),
    policy = effectivePolicy(b);
  const session = await prisma.assessmentInteractionSession.findUnique({
    where: { attemptId: b.target!.attempt!.id },
    select: { id: true, status: true },
  });
  return {
    bookingId: b.id,
    attemptId: b.target!.attempt!.id,
    session,
    startsAt: b.slot.startsAt,
    endsAt: b.slot.endsAt,
    timezone: 'Africa/Nairobi',
    canStart:
      b.status === 'SCHEDULED' && b.slot.startsAt <= new Date() && b.slot.endsAt > new Date(),
    policy,
    aiReady: interviewer.ready(),
    speech: speechProviders.configuration(),
    browserReadinessIsSelfReported: true,
    privacy: {
      camera: 'Local preview only. No video is recorded or transmitted.',
      audio:
        'Audio processing requires separate confirmation. Server audio uploads are transient and are not stored. Browser speech recognition may send audio to the browser vendor.',
      transcripts:
        'Confirmed answers, original transcriptions and corrections are saved as assessment evidence.',
      permissions:
        'Camera and microphone permissions do not authorize video recording. No facial recognition, gaze tracking or emotion detection is used.',
    },
  };
}
export async function ownedSession(applicantId: string, id: string, asAdmin = false) {
  const session = await prisma.assessmentInteractionSession.findFirst({
    where: { id, ...(!asAdmin ? { booking: { applicantId } } : {}) },
    include: {
      booking: { include: { slot: true } },
      attempt: { include: { requirements: true, target: true } },
      messages: { orderBy: { sequence: 'asc' } },
    },
  });
  requireCondition(session, 404, 'NOT_FOUND', 'Assessment session not found');
  return session;
}
export async function getSession(applicantId: string, id: string, asAdmin = false) {
  const s = await ownedSession(applicantId, id, asAdmin);
  const scenarios = z.array(frozenScenarioSchema).parse(s.scenarios);
  const checkpoint = await assessmentGraph.getState(graphConfig(id));
  const w = checkpoint.values.workflow as Workflow | undefined;
  return {
    id: s.id,
    bookingId: s.bookingId,
    attemptId: s.attemptId,
    status: s.attempt.completedAt ? 'COMPLETED' : s.status,
    mode: s.mode,
    language: s.language,
    policy: s.policy,
    preflight: s.preflight,
    messages: s.messages,
    progress: {
      totalScenarios: scenarios.length,
      completedScenarios: w?.cursor ?? 0,
      currentScenario: w && !w.finished ? w.cursor + 1 : null,
    },
    currentPromptId:
      s.status === 'AWAITING_REVIEW' || s.attempt.completedAt
        ? null
        : (s.messages.at(-1)?.id ?? null),
    hasPendingResponse: !!s.pendingResponseId,
    endsAt: s.booking.slot.endsAt,
    speech: speechProviders.configuration(),
    ...(asAdmin ? { evaluation: s.evaluation } : {}),
  };
}
export async function startSession(
  applicantId: string,
  bookingId: string,
  input: z.infer<typeof sessionStartSchema>,
) {
  const b = await ownedBooking(applicantId, bookingId);
  const existing = await prisma.assessmentInteractionSession.findUnique({
    where: { attemptId: b.target!.attempt!.id },
  });
  if (existing) {
    requireCondition(
      existing.bookingId === bookingId,
      409,
      'SESSION_BOOKING_MISMATCH',
      'Resume the booking that started this assessment',
    );
    const view = await getSession(applicantId, existing.id);
    return existing.status === 'INTERRUPTED' || !view.messages.length
      ? resumeSession(applicantId, existing.id)
      : view;
  }
  requireWindow(b);
  requireCondition(
    b.blueprint.active && b.blueprint.framework.approved && b.blueprint.framework.scope === 'CORE',
    409,
    'BLUEPRINT_UNAVAILABLE',
    'An active blueprint with an approved core framework is required',
  );
  requireCondition(
    interviewer.ready(),
    503,
    'AI_PROVIDER_UNAVAILABLE',
    'The AI interviewer is not configured',
  );
  const policy = effectivePolicy(b);
  requireCondition(
    !policy.cameraRequired || input.devices.camera === 'READY',
    422,
    'CAMERA_REQUIRED',
    policy.cameraPurpose ?? policy.accommodationInstructions,
  );
  requireCondition(
    !policy.microphoneRequired || input.devices.microphone === 'READY',
    422,
    'MICROPHONE_REQUIRED',
    policy.accommodationInstructions,
  );
  requireCondition(
    input.mode !== 'TEXT' || policy.allowText,
    422,
    'TEXT_MODE_NOT_PERMITTED',
    policy.accommodationInstructions,
  );
  requireCondition(
    input.mode !== 'VOICE' ||
      (input.audioProcessingConsent &&
        input.devices.microphone === 'READY' &&
        input.devices.speakerConfirmed),
    422,
    'VOICE_PREFLIGHT_REQUIRED',
    'Confirm audio processing, microphone readiness and audible speaker playback, or choose text mode',
  );
  const bank = await prisma.blueprintScenario.findMany({
    where: { blueprintId: b.blueprintId, scenario: { approved: true } },
    include: { scenario: true },
    orderBy: { position: 'asc' },
  });
  const scenarios = bank.map((link) => frozenScenarioSchema.parse(link.scenario));
  const requirements = b.target!.attempt!.requirements;
  requireCondition(
    scenarios.length > 0 &&
      requirements.every((r) => scenarios.some((s) => s.competencyIds.includes(r.competencyId))),
    409,
    'APPROVED_SCENARIOS_REQUIRED',
    'An administrator must assign approved scenarios covering every frozen competency before this assessment can start',
  );
  await startAttempt(applicantId, b.target!.attempt!.id);
  const session = await prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    const duplicate = await tx.assessmentInteractionSession.findUnique({
      where: { attemptId: b.target!.attempt!.id },
    });
    if (duplicate) return duplicate;
    const current = await tx.assessmentBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { slot: true },
    });
    requireWindow(current);
    const session = await tx.assessmentInteractionSession.create({
      data: {
        attemptId: b.target!.attempt!.id,
        bookingId,
        mode: input.mode,
        language: policy.language,
        policy: json(policy),
        preflight: json({
          ...input,
          completedAt: new Date().toISOString(),
          browserReadinessIsSelfReported: true,
          recordVideo: false,
          retainRawAudio: false,
        }),
        scenarios: json(scenarios),
      },
    });
    await audit(tx, applicantId, 'assessment.session_initialized', session.id, {
      bookingId,
      mode: input.mode,
    });
    await tx.assessmentSessionEvent.create({
      data: {
        sessionId: session.id,
        kind: 'PREFLIGHT_CONFIRMED',
        details: json({ mode: input.mode, videoRecordingConsent: false }),
      },
    });
    return session;
  });
  return runSession(applicantId, session.id);
}
async function runSession(applicantId: string, id: string) {
  const token = randomUUID();
  const lease = await prisma.assessmentInteractionSession.updateMany({
    where: { id, OR: [{ leaseToken: null }, { leaseExpiresAt: { lt: new Date() } }] },
    data: { leaseToken: token, leaseExpiresAt: new Date(Date.now() + env.AI_TIMEOUT_MS + 30000) },
  });
  requireCondition(
    lease.count === 1,
    409,
    'SESSION_BUSY',
    'Your previous turn is still processing; wait, then resume',
  );
  try {
    const s = await ownedSession(applicantId, id);
    requireWindow(s.booking);
    const config = graphConfig(id);
    const checkpoint = await assessmentGraph.getState(config);
    let w = checkpoint.values.workflow as Workflow | undefined;
    const pending = s.pendingResponseId
      ? await prisma.assessmentResponse.findUniqueOrThrow({ where: { id: s.pendingResponseId } })
      : null;
    if (!w) {
      const snapshot = s.attempt.contextSnapshot as {
        career?: unknown;
        industries?: unknown;
        companies?: unknown;
        education?: unknown;
      };
      const initial: Workflow = {
        scenarios: z.array(frozenScenarioSchema).parse(s.scenarios),
        requirements: s.attempt.requirements.map((r) => ({
          id: r.id,
          competencyId: r.competencyId,
          name: r.name,
          description: r.description,
          requiredScore: r.requiredScore,
          weight: r.weight,
        })),
        context: {
          career: snapshot.career,
          industries: snapshot.industries,
          companies: snapshot.companies,
          education: snapshot.education,
        },
        cursor: 0,
        followups: 0,
        messages: [],
        response: null,
        processed: [],
        evaluation: [],
        output: null,
        finished: false,
      };
      w = (await assessmentGraph.invoke({ workflow: initial }, config)).workflow;
    }
    if (checkpoint.next.length && !pending)
      w = (await assessmentGraph.invoke(null, config)).workflow;
    if (pending && !w.processed.includes(pending.id)) {
      w = (
        await assessmentGraph.invoke(
          w.response?.id === pending.id && checkpoint.next.length
            ? null
            : { workflow: { ...w, response: { id: pending.id, text: pending.confirmedText } } },
          config,
        )
      ).workflow;
    }
    const workflow = w;
    const evaluation = workflow.finished
      ? workflow.requirements.map((r) => {
          const scores = workflow.evaluation.filter((e) => e.competencyId === r.competencyId);
          requireCondition(
            scores.length,
            503,
            'EVALUATION_INCOMPLETE',
            'The AI evaluation did not cover all competencies',
          );
          const score = Math.round(scores.reduce((n, e) => n + e.score, 0) / scores.length);
          return {
            requirementId: r.id,
            score,
            evidence: scores
              .map((e) => e.evidence)
              .join('\n')
              .slice(0, 4000),
            gap: Math.max(0, r.requiredScore - score),
            name: r.name,
            requiredScore: r.requiredScore,
            weight: r.weight,
          };
        })
      : null;
    await prisma.$transaction(async (tx) => {
      const owned = await tx.assessmentInteractionSession.updateMany({
        where: { id, leaseToken: token },
        data: {
          status: workflow.finished ? 'AWAITING_REVIEW' : 'ACTIVE',
          pendingResponseId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(evaluation ? { evaluation: json(evaluation), completedAt: new Date() } : {}),
        },
      });
      requireCondition(
        owned.count === 1,
        409,
        'SESSION_BUSY',
        'This session was resumed elsewhere',
      );
      await tx.assessmentConversationMessage.createMany({
        data: workflow.messages.map((m, sequence) => ({ ...m, sessionId: id, sequence })),
        skipDuplicates: true,
      });
      await tx.assessmentResponse.updateMany({
        where: { sessionId: id, id: { in: workflow.processed }, processedAt: null },
        data: { processedAt: new Date() },
      });
      if (workflow.finished) await audit(tx, applicantId, 'assessment.ai_evaluation_proposed', id);
    });
    return getSession(applicantId, id);
  } catch (error) {
    await prisma.assessmentInteractionSession.updateMany({
      where: { id, leaseToken: token },
      data: { leaseToken: null, leaseExpiresAt: null, status: 'INTERRUPTED' },
    });
    await prisma.assessmentSessionEvent.create({
      data: {
        sessionId: id,
        kind: 'INTERRUPTED',
        details: json({ code: error instanceof AppError ? error.code : 'INTERVIEW_FAILED' }),
      },
    });
    throw error;
  }
}
export async function respond(
  applicantId: string,
  id: string,
  key: string,
  input: z.infer<typeof confirmedResponseSchema>,
) {
  const s = await ownedSession(applicantId, id);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const previous = await prisma.assessmentResponse.findUnique({
    where: { sessionId_idempotencyKey: { sessionId: id, idempotencyKey: key } },
  });
  if (previous) {
    requireCondition(
      previous.payloadHash === hash,
      409,
      'IDEMPOTENCY_CONFLICT',
      'Reuse the key only with the same confirmed response',
    );
    return previous.processedAt ? getSession(applicantId, id) : runSession(applicantId, id);
  }
  requireWindow(s.booking);
  requireCondition(
    !s.attempt.completedAt && !['AWAITING_REVIEW', 'COMPLETED'].includes(s.status),
    409,
    'SESSION_FINISHED',
    'This assessment conversation is complete',
  );
  const policy = interactionPolicySchema.parse(
    Object.fromEntries(
      Object.entries(s.policy as object).filter(([key]) => key !== 'accommodationId'),
    ),
  );
  requireCondition(
    input.origin !== 'TEXT' || policy.allowText,
    422,
    'TEXT_MODE_NOT_PERMITTED',
    'Request a text accommodation before responding',
  );
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AssessmentInteractionSession" WHERE id=${id}::uuid FOR UPDATE`;
    const current = await tx.assessmentInteractionSession.findUniqueOrThrow({
      where: { id },
      include: { messages: { orderBy: { sequence: 'desc' }, take: 1 } },
    });
    const retry = await tx.assessmentResponse.findUnique({
      where: { sessionId_idempotencyKey: { sessionId: id, idempotencyKey: key } },
    });
    if (retry) {
      requireCondition(
        retry.payloadHash === hash,
        409,
        'IDEMPOTENCY_CONFLICT',
        'Use the original response for this key',
      );
      return;
    }
    requireCondition(
      !current.pendingResponseId && !current.leaseToken,
      409,
      'SESSION_BUSY',
      'Resume or wait for the pending response before sending another answer',
    );
    requireCondition(
      current.messages[0]?.id === input.promptId && current.messages[0].role === 'AI',
      409,
      'PROMPT_CHANGED',
      'Reload the current prompt before submitting',
    );
    if (input.transcriptionId) {
      const transcript = await tx.assessmentTranscription.findFirst({
        where: { id: input.transcriptionId, sessionId: id, status: 'COMPLETED', response: null },
      });
      requireCondition(
        transcript?.originalText,
        422,
        'TRANSCRIPT_INVALID',
        'Use an unused final transcription from this session',
      );
      if (transcript.originalText !== input.text)
        await tx.transcriptCorrection.create({
          data: {
            transcriptionId: transcript.id,
            originalText: transcript.originalText,
            confirmedText: input.text,
          },
        });
    }
    const response = await tx.assessmentResponse.create({
      data: {
        sessionId: id,
        idempotencyKey: key,
        payloadHash: hash,
        promptId: input.promptId,
        origin: input.origin,
        confirmedText: input.text,
        transcriptionId: input.transcriptionId,
      },
    });
    await tx.assessmentInteractionSession.update({
      where: { id },
      data: { pendingResponseId: response.id },
    });
    await audit(tx, applicantId, 'assessment.response_confirmed', response.id, {
      origin: input.origin,
      transcriptCorrected: !!input.transcriptionId,
    });
  });
  return runSession(applicantId, id);
}
export async function resumeSession(applicantId: string, id: string) {
  const s = await ownedSession(applicantId, id);
  if (s.attempt.completedAt || s.status === 'AWAITING_REVIEW') return getSession(applicantId, id);
  requireWindow(s.booking);
  await prisma.assessmentSessionEvent.create({ data: { sessionId: id, kind: 'RESUMED' } });
  return runSession(applicantId, id);
}
async function requireAudioConsent(applicantId: string, id: string) {
  const s = await ownedSession(applicantId, id);
  requireWindow(s.booking);
  requireCondition(
    !s.attempt.completedAt && !['AWAITING_REVIEW', 'COMPLETED'].includes(s.status),
    409,
    'SESSION_FINISHED',
    'The assessment conversation is complete',
  );
  requireCondition(
    (s.preflight as { audioProcessingConsent?: boolean }).audioProcessingConsent,
    403,
    'AUDIO_CONSENT_REQUIRED',
    'Confirm audio processing before using voice input',
  );
  return s;
}
export async function browserTranscription(
  applicantId: string,
  id: string,
  input: z.infer<typeof browserTranscriptSchema>,
) {
  const s = await requireAudioConsent(applicantId, id);
  requireCondition(
    env.STT_PROVIDER === 'browser',
    503,
    'BROWSER_STT_DISABLED',
    'Use the configured server transcription adapter or text input',
  );
  requireCondition(
    input.language === s.language,
    422,
    'LANGUAGE_MISMATCH',
    'Use the assessment speech language',
  );
  return prisma.assessmentTranscription.create({
    data: {
      sessionId: id,
      status: 'COMPLETED',
      provider: 'browser',
      language: s.language,
      originalText: input.text,
    },
  });
}
export async function transcribeAudio(applicantId: string, id: string, buffer: Buffer) {
  let transcriptionId: string | undefined;
  try {
    const s = await requireAudioConsent(applicantId, id),
      durationMs = validateWav(buffer);
    const transcription = await prisma.assessmentTranscription.create({
      data: {
        sessionId: id,
        status: 'PENDING',
        provider: env.STT_PROVIDER,
        model: env.STT_MODEL,
        language: s.language,
        durationMs,
        byteLength: buffer.length,
      },
    });
    transcriptionId = transcription.id;
    const text = await speechProviders.transcribe(buffer, s.language);
    return await prisma.assessmentTranscription.update({
      where: { id: transcription.id },
      data: { status: 'COMPLETED', originalText: text },
    });
  } catch (error) {
    if (transcriptionId)
      await prisma.assessmentTranscription.update({
        where: { id: transcriptionId },
        data: { status: 'FAILED' },
      });
    throw error;
  } finally {
    buffer.fill(0);
  }
}
export async function synthesize(applicantId: string, id: string, messageId: string) {
  const s = await ownedSession(applicantId, id);
  const message = s.messages.find((m) => m.id === messageId && m.role === 'AI');
  requireCondition(message, 404, 'NOT_FOUND', 'Assessment prompt not found');
  const record = await prisma.assessmentSpeech.create({
    data: { sessionId: id, messageId, provider: env.TTS_PROVIDER, status: 'PENDING' },
  });
  try {
    if (env.TTS_PROVIDER === 'browser') {
      await prisma.assessmentSpeech.update({ where: { id: record.id }, data: { status: 'READY' } });
      return { provider: 'browser' as const, text: message.text, language: s.language };
    }
    const audio = await speechProviders.synthesize(message.text);
    await prisma.assessmentSpeech.update({ where: { id: record.id }, data: { status: 'READY' } });
    return { provider: 'compatible' as const, audio };
  } catch (error) {
    await prisma.assessmentSpeech.update({ where: { id: record.id }, data: { status: 'FAILED' } });
    throw error;
  }
}
export async function results(applicantId: string, id: string) {
  const s = await ownedSession(applicantId, id);
  if (s.attempt.completedAt)
    return {
      provisional: false,
      reviewRequired: false,
      attempt: await getAttempt(applicantId, s.attemptId),
    };
  requireCondition(
    s.evaluation,
    409,
    'RESULTS_NOT_READY',
    'Finish all scenarios before viewing the provisional report',
  );
  return {
    provisional: true,
    reviewRequired: true,
    competencies: s.evaluation,
    message:
      'AI-proposed scores require an authorised assessor review. Final skill gaps and learning plans are published after approval.',
  };
}
export async function approveResults(actorId: string, id: string, key: string) {
  const s = await ownedSession(actorId, id, true);
  requireCondition(
    s.evaluation,
    409,
    'RESULTS_NOT_READY',
    'There is no completed AI evaluation to review',
  );
  const proposed = z
    .array(
      z.object({
        requirementId: z.uuid(),
        score: z.number().int().min(0).max(100),
        evidence: z.string().min(10).max(4000),
      }),
    )
    .parse(s.evaluation);
  const attempt = await completeAttempt(actorId, s.attemptId, key, { results: proposed });
  await prisma.assessmentInteractionSession.update({
    where: { id },
    data: { status: 'COMPLETED' },
  });
  return attempt;
}
