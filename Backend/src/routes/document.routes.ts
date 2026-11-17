import { Router } from 'express';
import * as c from '../controllers/document.controller.js';
import { authenticate, verified, applicant, authorize } from '../middleware/authenticate.js';
import { upload } from '../middleware/upload.js';
import { rateLimit } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import { evidenceSchema } from '../validators/document.schema.js';
import { z } from 'zod';
import {
  reviewNotifications,
  readReviewNotifications,
} from '../services/document-notifications.service.js';
export const documentRouter = Router();
documentRouter.use(authenticate, verified, applicant);
documentRouter.post(
  '/',
  authorize('documents.upload.self'),
  rateLimit('upload', 20, 3600, true),
  upload,
  c.upload(false),
);
documentRouter.get('/', authorize('documents.read.self'), c.list());
documentRouter.get('/requirements', authorize('documents.read.self'), c.requirements);

documentRouter.get('/notifications', authorize('documents.read.self'), async (req, res) => {
  res.json({ data: await reviewNotifications(req.principal!.id) });
});
documentRouter.post('/notifications/read', authorize('documents.read.self'), async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(50) }).parse(req.body);
  await readReviewNotifications(req.principal!.id, ids);
  res.status(204).end();
});
documentRouter.get('/:id', authorize('documents.read.self'), c.get);
documentRouter.patch('/:id', authorize('documents.upload.self'), c.patch);
documentRouter.get('/:id/verification', authorize('documents.read.self'), c.history);
documentRouter.get('/:id/download', authorize('documents.read.self'), c.download());
documentRouter.post(
  '/:id/replace',
  authorize('documents.upload.self'),
  rateLimit('upload', 20, 3600, true),
  upload,
  c.upload(false, true),
);
documentRouter.post(
  '/:id/evidence',
  authorize('documents.upload.self'),
  validate(evidenceSchema),
  c.evidence(),
);
export const identityRouter = Router();
identityRouter.use(authenticate, verified, applicant);
identityRouter.post(
  '/documents',
  authorize('documents.upload.self'),
  rateLimit('upload', 20, 3600, true),
  upload,
  c.upload(true),
);
identityRouter.get('/documents', authorize('documents.read.self'), c.list(true));
identityRouter.get('/status', authorize('documents.read.self'), c.list(true));
identityRouter.post(
  '/documents/:id/replace',
  authorize('documents.upload.self'),
  rateLimit('upload', 20, 3600, true),
  upload,
  c.upload(true, true),
);
