import { z } from 'zod';
import { prisma, type Tx } from '../config/prisma.js';
import * as v from '../validators/admin.schema.js';
import { audit } from '../utils/audit.js';
import { requireCondition } from '../errors/app-error.js';
export const catalogueKind = z.enum([
  'industries',
  'companies',
  'careers',
  'institutions',
  'competencies',
  'frameworks',
  'blueprints',
]);
export type CatalogueKind = z.infer<typeof catalogueKind>;
async function validIndustries(tx: Tx, ids: string[]) {
  requireCondition(
    (await tx.industry.count({ where: { id: { in: ids }, active: true } })) === ids.length,
    422,
    'INDUSTRY_INVALID',
    'Select active industries',
  );
}
export async function listCatalogue(kind: CatalogueKind, skip: number, take: number) {
  switch (kind) {
    case 'industries':
      return prisma.industry.findMany({ skip, take, orderBy: { name: 'asc' } });
    case 'companies':
      return prisma.company.findMany({
        skip,
        take,
        include: { industries: true },
        orderBy: { name: 'asc' },
      });
    case 'careers':
      return prisma.jobRole.findMany({
        skip,
        take,
        include: { industries: true },
        orderBy: { title: 'asc' },
      });
    case 'institutions':
      return prisma.institution.findMany({ skip, take, orderBy: { name: 'asc' } });
    case 'competencies':
      return prisma.competency.findMany({ skip, take, orderBy: { code: 'asc' } });
    case 'frameworks':
      return prisma.competencyFramework.findMany({
        skip,
        take,
        include: { competencies: true },
        orderBy: { createdAt: 'desc' },
      });
    case 'blueprints':
      return prisma.assessmentBlueprint.findMany({ skip, take, orderBy: { createdAt: 'desc' } });
  }
}
export async function createCatalogue(kind: CatalogueKind, actorId: string, body: unknown) {
  return prisma.$transaction(async (tx) => {
    const record = await (async () => {
      switch (kind) {
        case 'industries':
          return tx.industry.create({ data: v.industrySchema.parse(body) });
        case 'institutions':
          return tx.institution.create({ data: v.institutionSchema.parse(body) });
        case 'competencies':
          return tx.competency.create({ data: v.competencySchema.parse(body) });
        case 'companies': {
          const { industryIds, ...data } = v.companySchema.parse(body);
          await validIndustries(tx, industryIds);
          return tx.company.create({
            data: {
              ...data,
              industries: { create: industryIds.map((industryId) => ({ industryId })) },
            },
          });
        }
        case 'careers': {
          const { industryIds, ...data } = v.roleSchema.parse(body);
          await validIndustries(tx, industryIds);
          return tx.jobRole.create({
            data: {
              ...data,
              industries: { create: industryIds.map((industryId) => ({ industryId })) },
            },
          });
        }
        case 'frameworks': {
          const { competencies, ...data } = v.frameworkSchema.parse(body);
          requireCondition(
            await tx.jobRole.count({ where: { id: data.jobRoleId, active: true } }),
            422,
            'ROLE_INVALID',
            'Select an active career',
          );
          if (data.industryId)
            requireCondition(
              await tx.jobRoleIndustry.count({
                where: {
                  jobRoleId: data.jobRoleId,
                  industryId: data.industryId,
                  industry: { active: true },
                },
              }),
              422,
              'INDUSTRY_INVALID',
              'Industry framework must match a career industry',
            );
          if (data.companyId)
            requireCondition(
              await tx.company.count({
                where: {
                  id: data.companyId,
                  active: true,
                  industries: {
                    some: {
                      industry: { active: true, jobRoles: { some: { jobRoleId: data.jobRoleId } } },
                    },
                  },
                },
              }),
              422,
              'COMPANY_INVALID',
              'Company framework must match a career industry',
            );
          requireCondition(
            (await tx.competency.count({
              where: { id: { in: competencies.map((c) => c.competencyId) } },
            })) === competencies.length,
            422,
            'COMPETENCY_INVALID',
            'Select existing competencies',
          );
          return tx.competencyFramework.create({
            data: { ...data, competencies: { create: competencies } },
          });
        }
        case 'blueprints': {
          const data = v.blueprintSchema.parse(body);
          const f = await tx.competencyFramework.findUnique({ where: { id: data.frameworkId } });
          requireCondition(
            f?.approved && f.scope === 'CORE' && f.jobRoleId === data.jobRoleId,
            422,
            'FRAMEWORK_INVALID',
            'Blueprint requires an approved framework for the same job role',
          );
          return tx.assessmentBlueprint.create({ data });
        }
      }
    })();
    await audit(tx, actorId, `catalogue.${kind}.created`, record.id);
    return record;
  });
}
export async function updateCatalogue(
  kind: CatalogueKind,
  id: string,
  actorId: string,
  body: unknown,
) {
  return prisma.$transaction(async (tx) => {
    const record = await (async () => {
      switch (kind) {
        case 'industries':
          return tx.industry.update({
            where: { id },
            data: v.industryPatchSchema.parse(body),
          });
        case 'institutions':
          return tx.institution.update({
            where: { id },
            data: v.institutionPatchSchema.parse(body),
          });
        case 'competencies': {
          requireCondition(
            !(await tx.frameworkCompetency.count({
              where: { competencyId: id, framework: { approved: true } },
            })),
            409,
            'VERSION_IMMUTABLE',
            'Create a new competency code to change an approved definition',
          );
          return tx.competency.update({
            where: { id },
            data: v.competencySchema.partial().parse(body),
          });
        }
        case 'companies': {
          const { industryIds, ...data } = v.companyPatchSchema.parse(body);
          if (industryIds) {
            await validIndustries(tx, industryIds);
            await tx.companyIndustry.deleteMany({ where: { companyId: id } });
          }
          return tx.company.update({
            where: { id },
            data: {
              ...data,
              ...(industryIds
                ? { industries: { create: industryIds.map((industryId) => ({ industryId })) } }
                : {}),
            },
          });
        }
        case 'careers': {
          const { industryIds, ...data } = v.rolePatchSchema.parse(body);
          if (industryIds) {
            await validIndustries(tx, industryIds);
            await tx.jobRoleIndustry.deleteMany({ where: { jobRoleId: id } });
          }
          return tx.jobRole.update({
            where: { id },
            data: {
              ...data,
              ...(industryIds
                ? { industries: { create: industryIds.map((industryId) => ({ industryId })) } }
                : {}),
            },
          });
        }
        case 'frameworks': {
          const input = z
            .object({ approved: z.literal(true) })
            .strict()
            .parse(body);
          return tx.competencyFramework.update({ where: { id }, data: input });
        }
        case 'blueprints':
          return tx.assessmentBlueprint.update({
            where: { id },
            data: v.activationSchema.parse(body),
          });
      }
    })();
    await audit(tx, actorId, `catalogue.${kind}.updated`, id);
    return record;
  });
}
