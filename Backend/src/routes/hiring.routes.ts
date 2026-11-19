import { Router } from 'express';
import { z } from 'zod';
import { admin, authenticate, authorize, verified } from '../middleware/authenticate.js';
import { requireCondition } from '../errors/app-error.js';
import { email as accountEmail } from '../validators/auth.schema.js';
import * as hiring from '../services/hiring.service.js';

export const employerRouter = Router();
employerRouter.use(
  authenticate,
  verified,
  (req, _res, next) => {
    requireCondition(
      req.principal!.roles.includes('EMPLOYER'),
      403,
      'FORBIDDEN',
      'Employer access required',
    );
    next();
  },
  authorize('hiring.discover'),
);

employerRouter.get('/roles', async (req, res) => {
  const search = z.string().trim().max(100).default('').parse(req.query.search);
  res.json({ data: await hiring.findRoles(search) });
});
employerRouter.get('/candidates', async (req, res) => {
  const { roleId, page } = hiring.paging.extend({ roleId: z.uuid() }).parse(req.query);
  res.json({ data: await hiring.shortlist(roleId, page) });
});
employerRouter.get('/requests', async (req, res) => {
  res.json({
    data: await hiring.employerRequests(req.principal!.id, hiring.paging.parse(req.query).page),
  });
});
employerRouter.post('/requests', async (req, res) => {
  const { reference } = z.object({ reference: z.uuid() }).strict().parse(req.body);
  await hiring.requestCandidate(req.principal!.id, reference);
  res.status(204).end();
});
employerRouter.get('/requests/:id/details', async (req, res) => {
  res.json({
    data: await hiring.candidateDetails(req.principal!.id, z.uuid().parse(req.params.id)),
  });
});

export const hiringAdminRouter = Router();
hiringAdminRouter.use(authenticate, verified, admin);
hiringAdminRouter.get('/requests', authorize('users.manage'), async (req, res) => {
  res.json({ data: await hiring.adminRequests(hiring.paging.parse(req.query).page) });
});
hiringAdminRouter.post('/requests/:id/confirm', authorize('users.manage'), async (req, res) => {
  await hiring.approveRequest(
    req.principal!.id,
    z.uuid().parse(req.params.id),
    hiring.procurement.parse(req.body).reference,
  );
  res.status(204).end();
});
hiringAdminRouter.post('/employers', authorize('users.manage'), async (req, res) => {
  const { email } = z.object({ email: accountEmail }).strict().parse(req.body);
  await hiring.grantEmployer(req.principal!.id, email);
  res.status(204).end();
});
hiringAdminRouter.get('/interviews', authorize('assessments.review'), async (req, res) => {
  const { page, stage } = hiring.paging
    .extend({ stage: z.enum(['READY', 'SCHEDULED', 'RECORDED']).default('READY') })
    .parse(req.query);
  res.json({ data: await hiring.interviewQueue(page, stage) });
});
hiringAdminRouter.put(
  '/interviews/:attemptId',
  authorize('assessments.review'),
  async (req, res) => {
    await hiring.scheduleInterview(
      req.principal!.id,
      z.uuid().parse(req.params.attemptId),
      hiring.scheduling.parse(req.body),
    );
    res.status(204).end();
  },
);
hiringAdminRouter.post(
  '/interviews/:attemptId/outcome',
  authorize('assessments.review'),
  async (req, res) => {
    await hiring.recordInterview(
      req.principal!.id,
      z.uuid().parse(req.params.attemptId),
      hiring.outcome.parse(req.body).outcome,
    );
    res.status(204).end();
  },
);
