import { Router, type RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { authenticate, verified, admin, authorize } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/security.js';
import { upload } from '../middleware/upload.js';
import { z } from 'zod';
import { email, uuid } from '../validators/auth.schema.js';
import { pagination } from '../validators/career.schema.js';
import * as v from '../validators/trainer.schema.js';
import * as s from '../services/trainer.service.js';
import { rotateSession } from '../services/auth.service.js';
import { requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
export const trainerRouter = Router();
trainerRouter.use(authenticate, verified);
// Possessing a link is insufficient: it must match the signed-in verified email.
trainerRouter.post(
  '/invitations/accept',
  rateLimit('trainer-accept', 10, 900, true),
  validate(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()),
  async (req, res) => {
    await s.acceptTrainerInvitation(req.principal!.id, req.body.token);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.principal!.id } });
    await rotateSession(req, user, req.session.mfaAt);
    res.json({ data: { ...(await s.trainerDetail(user.id)), csrfToken: req.session.csrf } });
  },
);
trainerRouter.use((req, _res, next) => {
  requireCondition(
    req.principal?.roles.includes('TRAINER'),
    403,
    'TRAINER_ACCESS_REQUIRED',
    'Accept a trainer invitation before opening this workspace',
  );
  next();
});
trainerRouter.get('/me', authorize('trainer.profile.read.self'), async (req, res) => {
  res.json({ data: await s.trainerDetail(req.principal!.id) });
});
trainerRouter.patch(
  '/me',
  authorize('trainer.profile.update.self'),
  validate(v.trainerProfileSchema),
  async (req, res) => {
    await s.updateTrainerProfile(req.principal!.id, req.body);
    res.json({ data: await s.trainerDetail(req.principal!.id) });
  },
);
trainerRouter.post(
  '/me/submit',
  authorize('trainer.profile.update.self'),
  validate(v.trainerVersionSchema),
  async (req, res) => {
    await s.submitTrainerProfile(req.principal!.id, req.body.version);
    res.json({ data: await s.trainerDetail(req.principal!.id) });
  },
);
trainerRouter.post(
  '/me/qualifications',
  authorize('trainer.qualifications.manage.self'),
  rateLimit('trainer-upload', 20, 3600, true),
  upload,
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    requireCondition(
      !files?.transcripts?.length,
      422,
      'UNEXPECTED_FILE',
      'Attach one qualification file',
    );
    await s.uploadTrainerQualification(
      req.principal!.id,
      v.trainerQualificationSchema.parse(req.body),
      files?.file?.[0],
    );
    res.status(201).json({ data: await s.trainerDetail(req.principal!.id) });
  },
);
trainerRouter.delete(
  '/me/qualifications/:id',
  authorize('trainer.qualifications.manage.self'),
  validate(v.trainerVersionSchema),
  async (req, res) => {
    await s.withdrawTrainerQualification(
      req.principal!.id,
      uuid.parse(req.params.id),
      req.body.version,
    );
    res.json({ data: await s.trainerDetail(req.principal!.id) });
  },
);
function download(asAdmin: boolean): RequestHandler {
  return async (req, res) => {
    const id = uuid.parse(req.params.id);
    const file = await s.downloadTrainerQualification(req.principal!.id, id, asAdmin);
    res
      .set({
        'Content-Type': file.mimeType,
        'Content-Disposition': `attachment; filename="trainer-qualification-${id}.${file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : 'jpg'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(file.buffer);
  };
}
trainerRouter.get(
  '/me/qualifications/:id/download',
  authorize('trainer.profile.read.self'),
  download(false),
);
export const trainerAdminRouter = Router();
trainerAdminRouter.use((req, _res, next) => {
  if (!/^\/(?:trainers|trainer-invitations|trainer-qualifications)(?:\/|$)/.test(req.path))
    return next('router');
  next();
});
trainerAdminRouter.use(authenticate, verified, admin, authorize('trainers.manage'));
trainerAdminRouter.get('/trainer-invitations', async (req, res) => {
  const p = pagination.parse(req.query);
  const where = p.search ? { email: { contains: p.search, mode: 'insensitive' as const } } : {};
  const [data, total] = await Promise.all([
    prisma.trainerInvitation.findMany({
      where,
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: p.limit,
      skip: (p.page - 1) * p.limit,
    }),
    prisma.trainerInvitation.count({ where }),
  ]);
  res.json({ data, meta: { page: p.page, limit: p.limit, total } });
});
trainerAdminRouter.post(
  '/trainer-invitations',
  rateLimit('trainer-invite', 20, 3600, true),
  validate(z.object({ email }).strict()),
  async (req, res) => {
    res.status(201).json({ data: await s.inviteTrainer(req.principal!.id, req.body.email) });
  },
);
trainerAdminRouter.post('/trainer-invitations/:id/revoke', async (req, res) => {
  const id = uuid.parse(req.params.id);
  await prisma.$transaction(async (tx) => {
    const result = await tx.trainerInvitation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    requireCondition(
      result.count,
      409,
      'INVITATION_NOT_PENDING',
      'Only a pending invitation can be revoked',
    );
    await audit(tx, req.principal!.id, 'trainer.invitation_revoked', id);
  });
  res.json({ data: { id, status: 'REVOKED' } });
});
trainerAdminRouter.get('/trainers', async (req, res) => {
  res.json(await s.listTrainers(v.trainerListSchema.parse(req.query)));
});
trainerAdminRouter.get('/trainers/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = await s.trainerDetail(id);
  await audit(prisma, req.principal!.id, 'trainer.profile_viewed', data.id);
  res.json({ data });
});
trainerAdminRouter.post(
  '/trainers/:id/reviews',
  validate(v.trainerReviewSchema),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    await s.reviewTrainer(req.principal!.id, id, req.body);
    res.status(201).json({ data: await s.trainerDetail(id) });
  },
);
trainerAdminRouter.get('/trainer-qualifications/:id/download', download(true));
