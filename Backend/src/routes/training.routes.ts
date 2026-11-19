import { Router } from 'express';
import { z } from 'zod';
import { authenticate, verified, admin, authorize } from '../middleware/authenticate.js';
import { requireCondition } from '../errors/app-error.js';
import * as s from '../services/training.service.js';
export const trainingAdminRouter = Router();
trainingAdminRouter.use(authenticate, verified, admin, authorize('trainers.manage'));
trainingAdminRouter.get('/', async (req, res) => {
  const q = z
    .object({
      search: z.string().trim().max(100).default(''),
      page: z.coerce.number().int().min(1).max(100000).default(1),
    })
    .parse(req.query);
  res.json({ data: await s.trainingAdminData(q.search, q.page) });
});
trainingAdminRouter.post('/skills', async (req, res) => {
  await s.addTeachingSkill(req.principal!.id, s.skillSchema.parse(req.body));
  res.status(204).end();
});
trainingAdminRouter.post('/assignments', async (req, res) => {
  await s.assignTrainee(req.principal!.id, s.assignmentSchema.parse(req.body));
  res.status(204).end();
});
export const trainingRouter = Router();
trainingRouter.use(
  authenticate,
  verified,
  authorize('trainer.profile.read.self'),
  (req, _res, next) => {
    requireCondition(
      req.principal!.roles.includes('TRAINER'),
      403,
      'TRAINER_REQUIRED',
      'Trainer access required',
    );
    next();
  },
);
trainingRouter.get('/', async (req, res) => {
  res.json({ data: await s.trainerTraining(req.principal!.id) });
});
trainingRouter.post('/sessions', async (req, res) => {
  res.status(201).json({
    data: await s.saveTrainingSession(req.principal!.id, s.sessionSchema.parse(req.body)),
  });
});
trainingRouter.patch('/sessions/:id', async (req, res) => {
  res.json({
    data: await s.saveTrainingSession(
      req.principal!.id,
      s.sessionSchema.parse(req.body),
      z.uuid().parse(req.params.id),
    ),
  });
});
trainingRouter.post('/sessions/:id/cancel', async (req, res) => {
  await s.cancelTrainingSession(req.principal!.id, z.uuid().parse(req.params.id));
  res.status(204).end();
});

trainingAdminRouter.post('/enrollments', async (req, res) => {
  await s.verifyEnrollment(req.principal!.id, s.enrollmentSchema.parse(req.body));
  res.status(204).end();
});
trainingRouter.get('/working-hours', async (req, res) => {
  res.json({ data: await s.trainerHours(req.principal!.id) });
});
trainingRouter.put('/working-hours', async (req, res) => {
  await s.setTrainerHours(req.principal!.id, s.workingHours.parse(req.body));
  res.status(204).end();
});
trainingRouter.put('/skills/:id', async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
  await s.setTeachingSkill(req.principal!.id, z.uuid().parse(req.params.id), enabled);
  res.status(204).end();
});
trainingRouter.patch('/assignments/:id', async (req, res) => {
  await s.recordProgress(
    req.principal!.id,
    z.uuid().parse(req.params.id),
    s.progressSchema.parse(req.body),
  );
  res.status(204).end();
});
trainingRouter.put('/sessions/:sessionId/attendance/:assignmentId', async (req, res) => {
  await s.recordAttendance(
    req.principal!.id,
    z.uuid().parse(req.params.sessionId),
    z.uuid().parse(req.params.assignmentId),
    s.attendanceSchema.parse(req.body).attendance,
  );
  res.status(204).end();
});
