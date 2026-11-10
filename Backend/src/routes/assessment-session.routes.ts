import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { audioUpload } from '../middleware/upload.js';
import { authenticate, verified, applicant, authorize, admin } from '../middleware/authenticate.js';
import { rateLimit } from '../middleware/security.js';
import { uuid } from '../validators/auth.schema.js';
import { idempotencyKey } from '../validators/assessment.schema.js';
import { pagination } from '../validators/career.schema.js';
import * as schemas from '../validators/assessment-interaction.schema.js';
import * as sessions from '../services/assessment-interaction.service.js';
import { prisma } from '../config/prisma.js';
import { audit } from '../utils/audit.js';
import { requireCondition } from '../errors/app-error.js';
export const assessmentSessionRouter = Router();
assessmentSessionRouter.use(
  authenticate,
  verified,
  applicant,
  authorize('assessments.schedule.self'),
);
assessmentSessionRouter.get('/:id', async (req, res) =>
  res.json({ data: await sessions.getSession(req.principal!.id, uuid.parse(req.params.id)) }),
);
assessmentSessionRouter.get('/:id/current-scenario', async (req, res) => {
  const s = await sessions.getSession(req.principal!.id, uuid.parse(req.params.id));
  res.json({
    data: {
      progress: s.progress,
      prompt: s.currentPromptId ? s.messages.find((m) => m.id === s.currentPromptId) : null,
    },
  });
});
assessmentSessionRouter.get('/:id/progress', async (req, res) => {
  const s = await sessions.getSession(req.principal!.id, uuid.parse(req.params.id));
  res.json({ data: { status: s.status, ...s.progress, hasPendingResponse: s.hasPendingResponse } });
});
assessmentSessionRouter.post(
  '/:id/responses',
  rateLimit('assessment-response-abuse', 600, 3600, true),
  async (req, res) => {
    res.json({
      data: await sessions.respond(
        req.principal!.id,
        uuid.parse(req.params.id),
        idempotencyKey.parse(req.get('Idempotency-Key')),
        schemas.confirmedResponseSchema.parse(req.body),
      ),
    });
  },
);
assessmentSessionRouter.post(
  '/:id/resume',
  rateLimit('assessment-resume', 30, 3600, true),
  async (req, res) =>
    res.json({ data: await sessions.resumeSession(req.principal!.id, uuid.parse(req.params.id)) }),
);
assessmentSessionRouter.post(
  '/:id/events',
  rateLimit('assessment-event', 60, 3600, true),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    await sessions.ownedSession(req.principal!.id, id);
    const body = schemas.sessionEventSchema.parse(req.body);
    await prisma.assessmentSessionEvent.create({
      data: { sessionId: id, kind: body.kind, details: body },
    });
    res.json({ data: { message: 'Event recorded' } });
  },
);
assessmentSessionRouter.post(
  '/:id/audio/transcribe',
  rateLimit('assessment-transcription', 30, 3600, true),
  async (req, _res, next) => {
    await sessions.ownedSession(req.principal!.id, uuid.parse(req.params.id));
    next();
  },
  (req, res, next) => (req.is('multipart/form-data') ? audioUpload(req, res, next) : next()),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (req.is('multipart/form-data')) {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const file = files?.audio?.[0];
      requireCondition(file, 422, 'AUDIO_REQUIRED', 'Upload one audio field');
      res.json({
        data: await sessions.transcribeAudio(req.principal!.id, id, await readFile(file.path)),
      });
    } else
      res.json({
        data: await sessions.browserTranscription(
          req.principal!.id,
          id,
          schemas.browserTranscriptSchema.parse(req.body),
        ),
      });
  },
);
assessmentSessionRouter.post(
  '/:id/speech/synthesize',
  rateLimit('assessment-speech', 60, 3600, true),
  async (req, res) => {
    const body = schemas.speechRequestSchema.parse(req.body),
      output = await sessions.synthesize(
        req.principal!.id,
        uuid.parse(req.params.id),
        body.messageId,
      );
    if (output.provider === 'browser') res.json({ data: output });
    else {
      res.type('audio/wav');
      res.set('Cache-Control', 'no-store');
      res.send(output.audio);
    }
  },
);
assessmentSessionRouter.get('/:id/results', async (req, res) =>
  res.json({ data: await sessions.results(req.principal!.id, uuid.parse(req.params.id)) }),
);
export const assessmentInteractionAdminRouter = Router();
assessmentInteractionAdminRouter.use(authenticate, verified, admin);
assessmentInteractionAdminRouter.get(
  '/scenarios',
  authorize('assessments.manage'),
  async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    res.json({
      data: await prisma.assessmentScenario.findMany({
        take: limit,
        skip: (page - 1) * limit,
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
      }),
    });
  },
);
assessmentInteractionAdminRouter.post(
  '/scenarios',
  authorize('assessments.manage'),
  async (req, res) => {
    const input = schemas.scenarioSchema.parse(req.body);
    requireCondition(
      (await prisma.competency.count({ where: { id: { in: input.competencyIds } } })) ===
        input.competencyIds.length,
      422,
      'COMPETENCY_INVALID',
      'Select existing competencies',
    );
    const data = await prisma.$transaction(async (tx) => {
      const s = await tx.assessmentScenario.create({ data: input });
      await audit(tx, req.principal!.id, 'assessment.scenario_created', s.id, {
        approved: input.approved,
      });
      return s;
    });
    res.status(201).json({ data });
  },
);
assessmentInteractionAdminRouter.put(
  '/blueprints/:id/scenarios',
  authorize('assessments.manage'),
  async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = schemas.scenarioAssignmentSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      const blueprint = await tx.assessmentBlueprint.findUnique({ where: { id } });
      requireCondition(blueprint, 404, 'NOT_FOUND', 'Blueprint not found');
      requireCondition(
        (await tx.assessmentScenario.count({
          where: { id: { in: input.scenarioIds }, approved: true },
        })) === input.scenarioIds.length,
        422,
        'SCENARIO_INVALID',
        'Assign only approved scenarios',
      );
      await tx.blueprintScenario.deleteMany({ where: { blueprintId: id } });
      await tx.blueprintScenario.createMany({
        data: input.scenarioIds.map((scenarioId, position) => ({
          blueprintId: id,
          scenarioId,
          position,
        })),
      });
      await audit(tx, req.principal!.id, 'assessment.scenarios_assigned', id);
    });
    res.json({
      data: { message: 'Approved scenarios assigned; existing session snapshots remain unchanged' },
    });
  },
);
assessmentInteractionAdminRouter.put(
  '/assessment-attempts/:id/accommodation',
  authorize('assessments.manage'),
  async (req, res) => {
    const attemptId = uuid.parse(req.params.id),
      input = schemas.accommodationSchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      requireCondition(
        await tx.assessmentAttempt.count({ where: { id: attemptId } }),
        404,
        'NOT_FOUND',
        'Assessment attempt not found',
      );
      requireCondition(
        !(await tx.assessmentInteractionSession.count({ where: { attemptId } })),
        409,
        'SESSION_POLICY_LOCKED',
        'Approve accommodations before the interaction session starts',
      );
      const row = await tx.assessmentAccommodation.upsert({
        where: { attemptId },
        create: { attemptId, ...input, approvedById: req.principal!.id },
        update: { ...input, approvedById: req.principal!.id },
      });
      await audit(tx, req.principal!.id, 'assessment.accommodation_approved', attemptId);
      return row;
    });
    res.json({ data });
  },
);
assessmentInteractionAdminRouter.get(
  '/assessment-sessions/:id',
  authorize('assessments.review'),
  async (req, res) => {
    const id = uuid.parse(req.params.id),
      data = await sessions.getSession(req.principal!.id, id, true);
    await audit(prisma, req.principal!.id, 'assessment.session_reviewed', id);
    res.json({ data });
  },
);
assessmentInteractionAdminRouter.post(
  '/assessment-sessions/:id/approve-results',
  authorize('assessments.review'),
  async (req, res) =>
    res.json({
      data: await sessions.approveResults(
        req.principal!.id,
        uuid.parse(req.params.id),
        idempotencyKey.parse(req.get('Idempotency-Key')),
      ),
    }),
);
