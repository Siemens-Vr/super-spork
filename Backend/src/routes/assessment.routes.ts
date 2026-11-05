import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import * as s from '../services/scheduling.service.js';
import { authenticate, verified, applicant, authorize } from '../middleware/authenticate.js';
import {
  bookingSchema,
  idempotencyKey,
  reasonSchema,
  rescheduleSchema,
  slotQuery,
} from '../validators/assessment.schema.js';
import { pagination } from '../validators/career.schema.js';
import { uuid } from '../validators/auth.schema.js';
import { validate } from '../middleware/validate.js';
import { requireCondition } from '../errors/app-error.js';
export const assessmentRouter = Router();
assessmentRouter.use(authenticate, verified, applicant, authorize('assessments.schedule.self'));
assessmentRouter.get('/eligibility', async (req, res) => {
  res.json({ data: await s.eligibility(req.principal!.id) });
});
assessmentRouter.get('/blueprints/:id', async (req, res) => {
  const data = await prisma.assessmentBlueprint.findFirst({
    where: { id: uuid.parse(req.params.id), active: true, framework: { approved: true } },
    include: {
      jobRole: true,
      framework: { include: { competencies: { include: { competency: true } } } },
    },
  });
  requireCondition(data, 404, 'NOT_FOUND', 'Blueprint not found');
  res.json({ data });
});
assessmentRouter.get('/available-slots', async (req, res) => {
  const q = slotQuery.parse(req.query);
  res.json({ data: await s.availableSlots(req.principal!.id, q.blueprintId, q.from, q.to) });
});
assessmentRouter.post('/bookings', validate(bookingSchema), async (req, res) => {
  const b = await s.createBooking(
    req.principal!.id,
    req.body.slotId,
    idempotencyKey.parse(req.get('idempotency-key')),
  );
  res.status(201).json({ data: s.confirmation(b) });
});
assessmentRouter.get('/bookings', async (req, res) => {
  const p = pagination.parse(req.query);
  const rows = await prisma.assessmentBooking.findMany({
    where: { applicantId: req.principal!.id },
    include: {
      blueprint: { include: { jobRole: true } },
      slot: { include: { availability: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
    take: p.limit,
    skip: (p.page - 1) * p.limit,
  });
  res.json({ data: rows.map(s.confirmation), meta: { page: p.page, limit: p.limit } });
});
assessmentRouter.get('/bookings/:id', async (req, res) => {
  res.json({ data: s.confirmation(await s.booking(req.principal!.id, uuid.parse(req.params.id))) });
});
assessmentRouter.post('/bookings/:id/cancel', validate(reasonSchema), async (req, res) => {
  res.json({
    data: await s.cancelBooking(req.principal!.id, uuid.parse(req.params.id), req.body.reason),
  });
});
assessmentRouter.post('/bookings/:id/reschedule', validate(rescheduleSchema), async (req, res) => {
  const b = await s.createBooking(
    req.principal!.id,
    req.body.slotId,
    idempotencyKey.parse(req.get('idempotency-key')),
    uuid.parse(req.params.id),
    req.body.reason,
  );
  res.status(201).json({ data: s.confirmation(b) });
});
