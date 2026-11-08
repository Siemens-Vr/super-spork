import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { authenticate, verified, applicant } from '../middleware/authenticate.js';
import { pagination, suggestionSchema } from '../validators/career.schema.js';
import { uuid } from '../validators/auth.schema.js';
import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/security.js';
import { requireCondition } from '../errors/app-error.js';
export const catalogueRouter = Router();
catalogueRouter.use(authenticate, verified);
catalogueRouter.get('/institutions', async (req, res) => {
  const p = pagination.parse(req.query);
  const where = {
    active: true,
    ...(p.search ? { name: { contains: p.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.institution.findMany({
      where,
      skip: (p.page - 1) * p.limit,
      take: p.limit,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, country: true, website: true },
    }),
    prisma.institution.count({ where }),
  ]);
  res.json({ data, meta: { ...p, total } });
});
catalogueRouter.get('/industries', async (req, res) => {
  const p = pagination.parse(req.query);
  const where = {
    active: true,
    ...(p.search ? { name: { contains: p.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.industry.findMany({
      where,
      skip: (p.page - 1) * p.limit,
      take: p.limit,
      orderBy: { name: 'asc' },
    }),
    prisma.industry.count({ where }),
  ]);
  res.json({ data, meta: { ...p, total } });
});
catalogueRouter.get('/companies', async (req, res) => {
  const p = pagination.parse(req.query);
  const where = {
    active: true,
    ...(p.search ? { name: { contains: p.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: { industries: { include: { industry: true } } },
      skip: (p.page - 1) * p.limit,
      take: p.limit,
      orderBy: { name: 'asc' },
    }),
    prisma.company.count({ where }),
  ]);
  res.json({ data, meta: { ...p, total } });
});
catalogueRouter.post(
  '/companies/suggestions',
  applicant,
  rateLimit('suggestion', 5, 3600, true),
  validate(suggestionSchema),
  async (req, res) => {
    res.status(201).json({
      data: await prisma.companySuggestion.create({
        data: { applicantId: req.principal!.id, ...suggestionSchema.parse(req.body) },
      }),
    });
  },
);
catalogueRouter.get('/careers', async (req, res) => {
  const p = pagination.parse(req.query);
  const where = {
    active: true,
    ...(p.search ? { title: { contains: p.search, mode: 'insensitive' as const } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.jobRole.findMany({
      where,
      include: { industries: { include: { industry: true } } },
      skip: (p.page - 1) * p.limit,
      take: p.limit,
      orderBy: { title: 'asc' },
    }),
    prisma.jobRole.count({ where }),
  ]);
  res.json({ data, meta: { ...p, total } });
});
catalogueRouter.get('/careers/:id', async (req, res) => {
  const data = await prisma.jobRole.findFirst({
    where: { id: uuid.parse(req.params.id), active: true },
    include: {
      industries: { include: { industry: true } },
      blueprints: { where: { active: true } },
    },
  });
  requireCondition(data, 404, 'NOT_FOUND', 'Career not found');
  res.json({ data });
});
catalogueRouter.get('/careers/:id/competencies', async (req, res) => {
  const data = await prisma.competencyFramework.findMany({
    where: { jobRoleId: uuid.parse(req.params.id), approved: true, jobRole: { active: true } },
    include: { competencies: { include: { competency: true } } },
    orderBy: { version: 'desc' },
  });
  res.json({ data });
});
