import { Router } from 'express';
import { resolve } from 'node:path';
import { authenticate, verified, applicant, authorize } from '../middleware/authenticate.js';
export const developmentAssessmentRouter = Router();
const root = resolve('src/web/assessment-dev');
developmentAssessmentRouter.get('/dev/assessment-login', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(resolve(root, 'login.html'));
});
developmentAssessmentRouter.get('/dev/assessment-login.mjs', (_req, res) =>
  res.sendFile(resolve(root, 'login.mjs')),
);
developmentAssessmentRouter.use(
  ['/dev/assessments', '/dev/assessment-assets', '/applicant/assessments/:bookingId/take'],
  (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.session.userId) {
      res.redirect('/dev/assessment-login');
      return;
    }
    next();
  },
  authenticate,
  verified,
  applicant,
  authorize('assessments.schedule.self'),
);
developmentAssessmentRouter.get('/dev/assessments', (_req, res) =>
  res.sendFile(resolve(root, 'index.html')),
);
developmentAssessmentRouter.get('/applicant/assessments/:bookingId/take', (_req, res) =>
  res.sendFile(resolve(root, 'index.html')),
);
developmentAssessmentRouter.get('/dev/assessment-assets/app.mjs', (_req, res) =>
  res.sendFile(resolve(root, 'app.mjs')),
);
developmentAssessmentRouter.get('/dev/assessment-assets/style.css', (_req, res) =>
  res.sendFile(resolve(root, 'style.css')),
);
