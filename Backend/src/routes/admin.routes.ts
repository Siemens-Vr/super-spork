import { abandonTarget } from '../services/assessment-lifecycle.service.js';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import { authenticate, verified, admin, authorize } from '../middleware/authenticate.js';
import { pagination } from '../validators/career.schema.js';
import { uuid } from '../validators/auth.schema.js';
import { reviewSchema, evidenceSchema } from '../validators/document.schema.js';
import * as v from '../validators/admin.schema.js';
import { availabilitySchema, reasonSchema } from '../validators/assessment.schema.js';
import { validate } from '../middleware/validate.js';
import { reviewDocument, publicDocument } from '../services/document.service.js';
import * as docs from '../controllers/document.controller.js';
import * as catalogue from '../services/admin.service.js';
import * as scheduling from '../services/scheduling.service.js';
import * as assessmentTargets from '../services/assessment-target.service.js';
import { completeAttemptSchema } from '../validators/assessment-target.schema.js';
import { idempotencyKey } from '../validators/assessment.schema.js';
import { audit } from '../utils/audit.js';
import { requireCondition } from '../errors/app-error.js';
import { applicantProfileSelect } from '../utils/applicant-profile.js';
export const adminRouter = Router();
adminRouter.use(authenticate, verified, admin);
adminRouter.post(
  '/assessment-targets/:id/abandon',
  authorize('assessments.manage'),
  validate(reasonSchema),
  async (req, res) => {
    res.json({
      data: await abandonTarget(
        req.principal!.id,
        uuid.parse(req.params.id),
        req.body.reason,
        true,
      ),
    });
  },
);
adminRouter.get('/assessment-attempts/:id', authorize('assessments.review'), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = await assessmentTargets.getAttempt(req.principal!.id, id, true);
  await audit(prisma, req.principal!.id, 'admin.assessment_viewed', id);
  res.json({ data });
});
adminRouter.post(
  '/assessment-attempts/:id/complete',
  authorize('assessments.review'),
  validate(completeAttemptSchema),
  async (req, res) => {
    res.json({
      data: await assessmentTargets.completeAttempt(
        req.principal!.id,
        uuid.parse(req.params.id),
        idempotencyKey.parse(req.get('idempotency-key')),
        completeAttemptSchema.parse(req.body),
      ),
    });
  },
);
adminRouter.get('/applicants', authorize('users.manage'), async (req, res) => {
  const p = pagination.parse(req.query);
  const status = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional().parse(req.query.status);
  const where = {
    roles: { some: { role: { name: 'APPLICANT' } } },
    ...(status ? { status } : {}),
    ...(p.search
      ? {
          OR: [
            { email: { contains: p.search, mode: 'insensitive' as const } },
            { legalName: { contains: p.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        legalName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
      },
      take: p.limit,
      skip: (p.page - 1) * p.limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ data, meta: { page: p.page, limit: p.limit, total } });
});
adminRouter.get('/applicants/:id', authorize('users.manage'), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = await prisma.user.findFirst({
    where: { id, roles: { some: { role: { name: 'APPLICANT' } } } },
    select: {
      id: true,
      legalName: true,
      email: true,
      phone: true,
      status: true,
      profile: { select: applicantProfileSelect },
      documents: true,
      assessmentTargets: {
        select: { id: true, jobRoleId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  requireCondition(data, 404, 'NOT_FOUND', 'Applicant not found');
  await audit(prisma, req.principal!.id, 'admin.applicant_viewed', id);
  res.json({ data: { ...data, documents: data.documents.map(publicDocument) } });
});
adminRouter.patch(
  '/applicants/:id/status',
  authorize('users.manage'),
  validate(v.accountStatusSchema),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    await prisma.$transaction(async (tx) => {
      await userLock(tx, id);
      requireCondition(
        await tx.userRole.findFirst({ where: { userId: id, role: { name: 'APPLICANT' } } }),
        404,
        'NOT_FOUND',
        'Applicant not found',
      );
      await tx.user.update({
        where: { id },
        data: { status: req.body.status, sessionVersion: { increment: 1 } },
      });
      await tx.session.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date(), data: {} },
      });
      await audit(tx, req.principal!.id, 'admin.account_status_changed', id, {
        status: req.body.status,
        reason: req.body.reason,
      });
    });
    res.json({ data: { id, status: req.body.status } });
  },
);
adminRouter.get('/documents', authorize('documents.review'), async (req, res) => {
  const p = pagination.parse(req.query);
  const status = z
    .enum([
      'UPLOADED',
      'UNDER_REVIEW',
      'ADDITIONAL_EVIDENCE_REQUIRED',
      'AUTHENTICATED',
      'REJECTED',
      'DISPUTED',
    ])
    .optional()
    .parse(req.query.status);
  const applicantId = uuid.optional().parse(req.query.applicantId);
  const identity = z.enum(['true', 'false']).optional().parse(req.query.identity);
  const rows = await prisma.document.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(applicantId ? { applicantId } : {}),
      ...(identity
        ? {
            category:
              identity === 'true'
                ? { in: ['NATIONAL_ID' as const, 'PASSPORT' as const] }
                : { notIn: ['NATIONAL_ID' as const, 'PASSPORT' as const] },
          }
        : {}),
    },
    take: p.limit,
    skip: (p.page - 1) * p.limit,
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    data: rows.map((d) => ({ ...publicDocument(d), applicantId: d.applicantId })),
    meta: { page: p.page, limit: p.limit },
  });
});
adminRouter.get('/documents/:id', authorize('documents.review'), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const d = await prisma.document.findUnique({
    where: { id },
    include: { reviews: true, evidence: true, history: true },
  });
  requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
  await audit(prisma, req.principal!.id, 'admin.document_viewed', id);
  res.json({
    data: {
      ...publicDocument(d),
      applicantId: d.applicantId,
      reviews: d.reviews,
      evidence: d.evidence,
      history: d.history,
    },
  });
});
adminRouter.get('/documents/:id/download', authorize('documents.review'), docs.download(true));
adminRouter.post(
  '/documents/:id/reviews',
  authorize('documents.verify'),
  validate(reviewSchema),
  async (req, res) => {
    res
      .status(201)
      .json({ data: await reviewDocument(uuid.parse(req.params.id), req.principal!.id, req.body) });
  },
);
adminRouter.post(
  '/documents/:id/evidence',
  authorize('documents.review'),
  validate(evidenceSchema),
  docs.evidence(true),
);
const kinds = [
  'industries',
  'companies',
  'careers',
  'institutions',
  'competencies',
  'frameworks',
  'blueprints',
] as const;
for (const kind of kinds) {
  const permission =
    kind === 'industries'
      ? 'industries.manage'
      : kind === 'companies'
        ? 'companies.manage'
        : kind === 'institutions'
          ? 'documents.review'
          : kind === 'blueprints'
            ? 'assessments.manage'
            : 'careers.manage';
  adminRouter.get(`/${kind}`, authorize(permission), async (req, res) => {
    const p = pagination.parse(req.query);
    res.json({
      data: await catalogue.listCatalogue(kind, (p.page - 1) * p.limit, p.limit),
      meta: { page: p.page, limit: p.limit },
    });
  });
  adminRouter.post(`/${kind}`, authorize(permission), async (req, res) => {
    res
      .status(201)
      .json({ data: await catalogue.createCatalogue(kind, req.principal!.id, req.body) });
  });
  adminRouter.patch(`/${kind}/:id`, authorize(permission), async (req, res) => {
    res.json({
      data: await catalogue.updateCatalogue(
        kind,
        uuid.parse(req.params.id),
        req.principal!.id,
        req.body,
      ),
    });
  });
}
adminRouter.get('/company-suggestions', authorize('companies.manage'), async (req, res) => {
  const p = pagination.parse(req.query);
  res.json({
    data: await prisma.companySuggestion.findMany({
      take: p.limit,
      skip: (p.page - 1) * p.limit,
      orderBy: { createdAt: 'desc' },
    }),
  });
});
adminRouter.post(
  '/company-suggestions/:id/review',
  authorize('companies.manage'),
  validate(v.suggestionReviewSchema),
  async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = v.suggestionReviewSchema.parse(req.body);
    const data = await prisma.$transaction(async (tx) => {
      if (input.companyId)
        requireCondition(
          await tx.company.findUnique({ where: { id: input.companyId } }),
          422,
          'COMPANY_INVALID',
          'Company not found',
        );
      const r = await tx.companySuggestion.update({
        where: { id },
        data: { status: input.status, decisionReason: input.reason },
      });
      await audit(tx, req.principal!.id, 'company.suggestion_reviewed', id, {
        status: input.status,
        companyId: input.companyId ?? null,
      });
      return r;
    });
    res.json({ data });
  },
);
adminRouter.get('/availability', authorize('assessments.manage'), async (req, res) => {
  const p = pagination.parse(req.query);
  res.json({
    data: await prisma.assessmentAvailability.findMany({
      take: p.limit,
      skip: (p.page - 1) * p.limit,
      orderBy: { startsAt: 'asc' },
    }),
  });
});
adminRouter.post(
  '/availability',
  authorize('assessments.manage'),
  validate(availabilitySchema),
  async (req, res) => {
    res
      .status(201)
      .json({ data: await scheduling.createAvailability(req.principal!.id, req.body) });
  },
);
adminRouter.patch(
  '/availability/:id',
  authorize('assessments.manage'),
  validate(v.availabilityPatchSchema),
  async (req, res) => {
    res.json({
      data: await scheduling.updateAvailability(
        req.principal!.id,
        uuid.parse(req.params.id),
        req.body,
      ),
    });
  },
);
adminRouter.get('/bookings', authorize('assessments.manage'), async (req, res) => {
  const p = pagination.parse(req.query);
  const filters = z
    .object({
      status: z
        .enum(['SCHEDULED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED', 'EXPIRED', 'MISSED'])
        .optional(),
      from: z.iso.datetime({ offset: true }).optional(),
      to: z.iso.datetime({ offset: true }).optional(),
      applicantId: z.uuid().optional(),
    })
    .parse(req.query);
  const rows = await prisma.assessmentBooking.findMany({
    where: {
      status: filters.status,
      applicantId: filters.applicantId,
      ...(filters.from || filters.to
        ? {
            slot: {
              startsAt: {
                gte: filters.from ? new Date(filters.from) : undefined,
                lte: filters.to ? new Date(filters.to) : undefined,
              },
            },
          }
        : {}),
    },
    include: {
      target: { select: { attempt: { select: { id: true } } } },
      blueprint: { include: { jobRole: true } },
      slot: { include: { availability: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
    take: p.limit,
    skip: (p.page - 1) * p.limit,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: rows.map(scheduling.confirmation), meta: { page: p.page, limit: p.limit } });
});
adminRouter.get('/bookings/:id', authorize('assessments.manage'), async (req, res) => {
  res.json({
    data: scheduling.confirmation(
      await scheduling.booking(req.principal!.id, uuid.parse(req.params.id), true),
    ),
  });
});
adminRouter.post(
  '/bookings/:id/cancel',
  authorize('assessments.manage'),
  validate(reasonSchema),
  async (req, res) => {
    res.json({
      data: await scheduling.cancelBooking(
        req.principal!.id,
        uuid.parse(req.params.id),
        req.body.reason,
        true,
      ),
    });
  },
);
adminRouter.get('/audit-logs', authorize('audit.read'), async (req, res) => {
  const p = pagination.parse(req.query);
  const resourceId = z.string().max(200).optional().parse(req.query.resourceId);
  res.json({
    data: await prisma.auditLog.findMany({
      where: { resourceId },
      take: p.limit,
      skip: (p.page - 1) * p.limit,
      orderBy: { createdAt: 'desc' },
    }),
    meta: { page: p.page, limit: p.limit },
  });
});
