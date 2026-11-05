import { Router } from 'express';
import * as s from '../services/applicant.service.js';
import { authenticate, verified, applicant, authorize } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { profileSchema } from '../validators/applicant.schema.js';
import { careerSchema } from '../validators/career.schema.js';
export const applicantRouter = Router();
applicantRouter.use(authenticate, verified, applicant);
applicantRouter.get('/me', authorize('profile.read.self'), async (req, res) => {
  res.json({ data: await s.profile(req.principal!.id) });
});
applicantRouter.patch(
  '/me',
  authorize('profile.update.self'),
  validate(profileSchema),
  async (req, res) => {
    res.json({ data: await s.updateProfile(req.principal!.id, req.body) });
  },
);
applicantRouter.get('/me/onboarding', authorize('profile.read.self'), async (req, res) => {
  res.json({ data: await s.onboarding(req.principal!.id) });
});
applicantRouter.get('/me/career-preferences', authorize('profile.read.self'), async (req, res) => {
  res.json({ data: await s.getPreferences(req.principal!.id) });
});
applicantRouter.put(
  '/me/career-preferences',
  authorize('profile.update.self'),
  validate(careerSchema),
  async (req, res) => {
    res.json({ data: await s.updatePreferences(req.principal!.id, req.body) });
  },
);
