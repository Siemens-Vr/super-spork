import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma, userLock, type Tx } from '../config/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { applicantProfileSelect } from '../utils/applicant-profile.js';
import { targetSchema, completeAttemptSchema } from '../validators/assessment-target.schema.js';

export const activeTargetStatuses = ['DRAFT', 'PREPARED', 'IN_PROGRESS'] as const;
const qualificationSelect = {
  id: true,
  category: true,
  courseName: true,
  certificationName: true,
  institutionId: true,
  institutionName: true,
  issuer: true,
  issuedAt: true,
  scanStatus: true,
  status: true,
} as const;
const targetInclude = {
  jobRole: true,
  industries: { include: { industry: true }, orderBy: { rank: 'asc' } },
  companies: { include: { company: true }, orderBy: { rank: 'asc' } },
  qualifications: {
    include: { document: { select: qualificationSelect } },
    orderBy: { documentId: 'asc' },
  },
  attempt: { select: { id: true, startedAt: true, completedAt: true, blueprintId: true } },
} satisfies Prisma.AssessmentTargetInclude;
const attemptInclude = {
  requirements: { orderBy: { code: 'asc' } },
  results: { include: { requirement: true }, orderBy: { requirementId: 'asc' } },
  learningPlan: { include: { items: { orderBy: { priority: 'asc' } } } },
} satisfies Prisma.AssessmentAttemptInclude;

export async function getTarget(applicantId: string, id: string, tx: Tx = prisma) {
  const target = await tx.assessmentTarget.findFirst({
    where: { id, applicantId },
    include: targetInclude,
  });
  requireCondition(target, 404, 'NOT_FOUND', 'Assessment target not found');
  return target;
}
export async function listTargets(applicantId: string, page: number, limit: number) {
  const where = { applicantId };
  const [data, total] = await Promise.all([
    prisma.assessmentTarget.findMany({
      where,
      include: targetInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.assessmentTarget.count({ where }),
  ]);
  return { data, meta: { page, limit, total } };
}

type TargetInput = z.infer<typeof targetSchema>;
async function validateChoices(tx: Tx, applicantId: string, input: TargetInput) {
  const role = await tx.jobRole.findFirst({
    where: { id: input.jobRoleId, active: true },
    include: { industries: true },
  });
  requireCondition(role, 422, 'ROLE_INVALID', 'Select an active career');
  const industries = await tx.industry.findMany({
    where: { id: { in: input.industryIds }, active: true },
  });
  requireCondition(
    industries.length === input.industryIds.length,
    422,
    'INDUSTRY_INVALID',
    'Select active industries',
  );
  requireCondition(
    input.industryIds.every((id) => role.industries.some((link) => link.industryId === id)),
    422,
    'CAREER_INDUSTRY_MISMATCH',
    'Each selected industry must be linked to the chosen career',
  );
  const companies = await tx.company.findMany({
    where: { id: { in: input.companyIds }, active: true },
    include: { industries: true },
  });
  requireCondition(
    companies.length === input.companyIds.length,
    422,
    'COMPANY_INVALID',
    'Select active companies',
  );
  requireCondition(
    companies.every((company) =>
      company.industries.some((link) => input.industryIds.includes(link.industryId)),
    ),
    422,
    'COMPANY_INDUSTRY_MISMATCH',
    'Each company must operate in a selected industry',
  );
  const qualifications = await tx.document.findMany({
    where: {
      id: { in: input.qualificationIds },
      applicantId,
      replacement: null,
      category: {
        in: [
          'BACHELOR',
          'MASTER',
          'PHD',
          'DIPLOMA',
          'SHORT_COURSE',
          'INDUSTRY_CERTIFICATION',
          'PROFESSIONAL_REGISTRATION',
        ],
      },
      scanStatus: 'CLEAN',
      status: { not: 'REJECTED' },
    },
    select: qualificationSelect,
  });
  requireCondition(
    qualifications.length === input.qualificationIds.length,
    422,
    'QUALIFICATION_INVALID',
    'Select your current, clean, non-rejected qualification documents',
  );
  const profile = await tx.applicantProfile.findUnique({
    where: { userId: applicantId },
    select: applicantProfileSelect,
  });
  requireCondition(
    profile?.discipline || qualifications.some((q) => q.courseName),
    422,
    'COURSE_REQUIRED',
    'Provide your course in the profile or select a qualification with a course name',
  );
  requireCondition(
    await tx.document.count({
      where: {
        applicantId,
        category: { in: ['NATIONAL_ID', 'PASSPORT'] },
        replacement: null,
        scanStatus: { not: 'INFECTED' },
      },
    }),
    409,
    'IDENTITY_REQUIRED',
    'Submit an identity document first',
  );
  return { role, industries, companies, qualifications, profile };
}
function choiceData(input: TargetInput) {
  return {
    jobRoleId: input.jobRoleId,
    industries: { create: input.industryIds.map((industryId, i) => ({ industryId, rank: i + 1 })) },
    companies: { create: input.companyIds.map((companyId, i) => ({ companyId, rank: i + 1 })) },
    qualifications: { create: input.qualificationIds.map((documentId) => ({ documentId })) },
  };
}
export async function createTarget(applicantId: string, input: TargetInput) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    requireCondition(
      !(await tx.assessmentTarget.count({
        where: { applicantId, status: { in: [...activeTargetStatuses] } },
      })),
      409,
      'ACTIVE_TARGET_EXISTS',
      'Complete the current assessment before choosing another career',
    );
    requireCondition(
      !(await tx.assessmentBooking.count({ where: { applicantId, status: 'SCHEDULED' } })),
      409,
      'ACTIVE_BOOKING_EXISTS',
      'An assessment booking already exists; use its current career target',
    );
    await validateChoices(tx, applicantId, input);
    const target = await tx.assessmentTarget.create({
      data: { applicantId, ...choiceData(input) },
    });
    await audit(tx, applicantId, 'assessment.target_created', target.id);
    return getTarget(applicantId, target.id, tx);
  });
}
export async function updateTarget(applicantId: string, id: string, input: TargetInput) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    const target = await getTarget(applicantId, id, tx);
    requireCondition(
      target.status === 'DRAFT',
      409,
      'TARGET_LOCKED',
      'Prepared assessment choices are immutable',
    );
    await validateChoices(tx, applicantId, input);
    await tx.assessmentTargetIndustry.deleteMany({ where: { targetId: id } });
    await tx.assessmentTargetCompany.deleteMany({ where: { targetId: id } });
    await tx.assessmentTargetQualification.deleteMany({ where: { targetId: id } });
    await tx.assessmentTarget.update({ where: { id }, data: choiceData(input) });
    await audit(tx, applicantId, 'assessment.target_updated', id);
    return getTarget(applicantId, id, tx);
  });
}

const normalizeCourse = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export async function prepareInTransaction(
  tx: Tx,
  applicantId: string,
  id: string,
  blueprintId: string,
) {
  const target = await getTarget(applicantId, id, tx);
  if (target.attempt) {
    requireCondition(
      target.attempt.blueprintId === blueprintId,
      409,
      'TARGET_LOCKED',
      'Use the blueprint already prepared for this target',
    );
    return tx.assessmentAttempt.findUniqueOrThrow({
      where: { id: target.attempt.id },
      include: attemptInclude,
    });
  }
  requireCondition(target.status === 'DRAFT', 409, 'TARGET_LOCKED', 'Target cannot be prepared');
  const choices = await validateChoices(tx, applicantId, {
    jobRoleId: target.jobRoleId,
    industryIds: target.industries.map((i) => i.industryId),
    companyIds: target.companies.map((c) => c.companyId),
    qualificationIds: target.qualifications.map((q) => q.documentId),
  });
  const blueprint = await tx.assessmentBlueprint.findFirst({
    where: {
      id: blueprintId,
      jobRoleId: target.jobRoleId,
      active: true,
      framework: { approved: true, scope: 'CORE' },
    },
    include: { framework: { include: { competencies: { include: { competency: true } } } } },
  });
  requireCondition(
    blueprint,
    422,
    'BLUEPRINT_INVALID',
    'Select an active blueprint with an approved core framework for this career',
  );
  const courseNames = new Set(
    [choices.profile?.discipline, ...choices.qualifications.map((q) => q.courseName)]
      .filter((name): name is string => !!name)
      .map(normalizeCourse),
  );
  const contextual = await tx.competencyFramework.findMany({
    where: { jobRoleId: target.jobRoleId, approved: true, scope: { not: 'CORE' } },
    include: { competencies: { include: { competency: true } } },
    orderBy: { version: 'desc' },
  });
  const selected = new Map<string, (typeof contextual)[number]>();
  for (const f of contextual) {
    const matches =
      (f.scope === 'INDUSTRY' && target.industries.some((i) => i.industryId === f.industryId)) ||
      (f.scope === 'COMPANY' && target.companies.some((c) => c.companyId === f.companyId)) ||
      (f.scope === 'COURSE' && !!f.courseName && courseNames.has(normalizeCourse(f.courseName)));
    const key = `${f.scope}:${f.industryId ?? f.companyId ?? normalizeCourse(f.courseName ?? '')}`;
    if (matches && !selected.has(key)) selected.set(key, f);
  }
  const frameworks = [blueprint.framework, ...selected.values()];
  const requirements = new Map<
    string,
    {
      competencyId: string;
      code: string;
      name: string;
      description: string;
      requiredScore: number;
      weight: number;
      sources: Prisma.InputJsonObject[];
      learningObjective: string;
      learningResources: string[];
    }
  >();
  for (const f of frameworks)
    for (const link of f.competencies) {
      const source = {
        frameworkId: f.id,
        version: f.version,
        scope: f.scope,
        industryId: f.industryId,
        companyId: f.companyId,
        courseName: f.courseName,
      };
      const existing = requirements.get(link.competencyId);
      if (existing) {
        existing.requiredScore = Math.max(existing.requiredScore, link.requiredScore);
        existing.weight += link.weight;
        existing.sources.push(source);
        if (link.learningObjective) existing.learningObjective += `\n${link.learningObjective}`;
        existing.learningResources = [
          ...new Set([...existing.learningResources, ...link.learningResources]),
        ];
      } else
        requirements.set(link.competencyId, {
          competencyId: link.competencyId,
          code: link.competency.code,
          name: link.competency.name,
          description: link.competency.description,
          requiredScore: link.requiredScore,
          weight: link.weight,
          sources: [source],
          learningObjective:
            link.learningObjective ??
            `Develop and demonstrate competency in ${link.competency.name}.`,
          learningResources: link.learningResources,
        });
    }
  requireCondition(
    requirements.size > 0 && requirements.size <= 400,
    422,
    'REQUIREMENTS_INVALID',
    'The combined rubric must contain between 1 and 400 competencies',
  );
  const profile = choices.profile;
  const contextSnapshot = {
    schemaVersion: 1,
    career: {
      id: choices.role.id,
      title: choices.role.title,
      description: choices.role.description,
    },
    industries: target.industries.map((i) => ({
      id: i.industryId,
      name: i.industry.name,
      rank: i.rank,
    })),
    companies: target.companies.map((c) => ({
      id: c.companyId,
      name: c.company.name,
      rank: c.rank,
    })),
    education: {
      discipline: profile?.discipline ?? null,
    },
    qualifications: choices.qualifications.map((q) => ({
      ...q,
      issuedAt: q.issuedAt?.toISOString() ?? null,
    })),
    blueprint: {
      id: blueprint.id,
      version: blueprint.version,
      title: blueprint.title,
      instructions: blueprint.instructions,
      durationMinutes: blueprint.durationMinutes,
      interactionPolicy: blueprint.interactionPolicy,
      requiresAuthenticatedIdentity: blueprint.requiresAuthenticatedIdentity,
      requiresAuthenticatedAcademic: blueprint.requiresAuthenticatedAcademic,
    },
    frameworks: frameworks.map((f) => ({
      id: f.id,
      version: f.version,
      scope: f.scope,
      title: f.title,
    })),
    scoring: {
      scale: '0-100',
      thresholdRule: 'maximum',
      weightRule: 'sum',
      gapRule: 'max(requiredScore - score, 0)',
      overallRule: 'weighted mean; gaps remain competency-specific',
    },
  };
  const attempt = await tx.assessmentAttempt.create({
    data: {
      targetId: id,
      blueprintId,
      contextSnapshot,
      requirements: { create: [...requirements.values()] },
    },
    include: attemptInclude,
  });
  await tx.assessmentTarget.update({
    where: { id },
    data: { status: 'PREPARED', lockedAt: new Date() },
  });
  await audit(tx, applicantId, 'assessment.target_prepared', id, {
    attemptId: attempt.id,
    blueprintId,
  });
  return attempt;
}
export async function prepareTarget(applicantId: string, id: string, blueprintId: string) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    return prepareInTransaction(tx, applicantId, id, blueprintId);
  });
}

export async function targetForBooking(tx: Tx, applicantId: string, blueprintId: string) {
  const target = await tx.assessmentTarget.findFirst({
    where: { applicantId, status: { in: [...activeTargetStatuses] } },
    include: { attempt: true },
  });
  requireCondition(
    target,
    409,
    'TARGET_REQUIRED',
    'Create and prepare an assessment target before booking',
  );
  requireCondition(
    target.status !== 'IN_PROGRESS',
    409,
    'ASSESSMENT_IN_PROGRESS',
    'Finish the current assessment',
  );
  requireCondition(
    target.status === 'PREPARED' && target.attempt,
    409,
    'TARGET_NOT_PREPARED',
    'Prepare the assessment target before booking',
  );
  requireCondition(
    target.attempt.blueprintId === blueprintId,
    409,
    'TARGET_BLUEPRINT_MISMATCH',
    'Book a slot for the prepared target blueprint',
  );
  return target.id;
}
export async function getAttempt(applicantId: string, id: string, asAdmin = false) {
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id, ...(!asAdmin ? { target: { applicantId } } : {}) },
    include: attemptInclude,
  });
  requireCondition(attempt, 404, 'NOT_FOUND', 'Assessment attempt not found');
  // Completion retry hashes and keys are internal, not applicant-facing data.
  const { completionKey: _key, completionHash: _hash, ...data } = attempt;
  return data;
}
export async function startAttempt(applicantId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    const attempt = await tx.assessmentAttempt.findFirst({
      where: { id, target: { applicantId } },
      include: { target: true },
    });
    requireCondition(attempt, 404, 'NOT_FOUND', 'Assessment attempt not found');
    if (attempt.target.status === 'IN_PROGRESS') return;
    requireCondition(
      attempt.target.status === 'PREPARED',
      409,
      'ATTEMPT_NOT_READY',
      'Assessment must be prepared and not completed',
    );
    const now = new Date();
    requireCondition(
      await tx.assessmentBooking.count({
        where: {
          targetId: attempt.targetId,
          status: 'SCHEDULED',
          slot: { startsAt: { lte: now }, endsAt: { gt: now } },
        },
      }),
      409,
      'ASSESSMENT_WINDOW_CLOSED',
      'Start during your scheduled assessment window',
    );
    const policy = z
      .object({
        blueprint: z.object({
          requiresAuthenticatedIdentity: z.boolean(),
          requiresAuthenticatedAcademic: z.boolean(),
        }),
      })
      .parse(attempt.contextSnapshot).blueprint;
    const documents = await tx.document.findMany({
      where: { applicantId, replacement: null, scanStatus: 'CLEAN', status: { not: 'REJECTED' } },
    });
    const identities = documents.filter(
      (d) => d.category === 'NATIONAL_ID' || d.category === 'PASSPORT',
    );
    requireCondition(
      identities.some((d) => !policy.requiresAuthenticatedIdentity || d.status === 'AUTHENTICATED'),
      409,
      'IDENTITY_SUBMISSION_REQUIRED',
      'A current clean identity meeting the frozen verification policy is required',
    );
    requireCondition(
      !policy.requiresAuthenticatedAcademic ||
        documents.some(
          (d) =>
            d.category !== 'NATIONAL_ID' &&
            d.category !== 'PASSPORT' &&
            d.status === 'AUTHENTICATED',
        ),
      409,
      'ACADEMIC_AUTHENTICATION_REQUIRED',
      'An authenticated academic document is required by this assessment',
    );
    requireCondition(
      !(await tx.assessmentTargetQualification.count({
        where: {
          targetId: attempt.targetId,
          document: { OR: [{ scanStatus: { not: 'CLEAN' } }, { status: 'REJECTED' }] },
        },
      })),
      409,
      'QUALIFICATION_INVALID',
      'A selected qualification no longer meets the assessment policy',
    );
    await tx.assessmentAttempt.update({ where: { id }, data: { startedAt: now } });
    await tx.assessmentTarget.update({
      where: { id: attempt.targetId },
      data: { status: 'IN_PROGRESS' },
    });
    await audit(tx, applicantId, 'assessment.started', id);
  });
  return getAttempt(applicantId, id);
}
export async function completeAttempt(
  actorId: string,
  id: string,
  key: string,
  input: z.infer<typeof completeAttemptSchema>,
) {
  const found = await prisma.assessmentAttempt.findUnique({
    where: { id },
    select: { target: { select: { applicantId: true } } },
  });
  requireCondition(found, 404, 'NOT_FOUND', 'Assessment attempt not found');
  const canonical = [...input.results].sort((a, b) =>
    a.requirementId.localeCompare(b.requirementId),
  );
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  await prisma.$transaction(
    async (tx) => {
      await userLock(tx, found.target.applicantId);
      const attempt = await tx.assessmentAttempt.findUniqueOrThrow({
        where: { id },
        include: { target: true, requirements: true },
      });
      if (attempt.completedAt) {
        requireCondition(
          attempt.completionKey === key && attempt.completionHash === hash,
          409,
          'RESULTS_IMMUTABLE',
          'Completed results cannot be replaced; retry with the same key and results',
        );
        return;
      }
      requireCondition(
        attempt.target.status === 'IN_PROGRESS' && attempt.startedAt,
        409,
        'ATTEMPT_NOT_STARTED',
        'Start the assessment before recording results',
      );
      requireCondition(
        canonical.length === attempt.requirements.length &&
          canonical.every((r) => attempt.requirements.some((q) => q.id === r.requirementId)),
        422,
        'RESULTS_INCOMPLETE',
        'Provide one result for every frozen requirement, without extra requirements',
      );
      let weighted = 0,
        weights = 0;
      const gaps: {
        resultId: string;
        gap: number;
        code: string;
        objective: string;
        resources: string[];
      }[] = [];
      for (const requirement of attempt.requirements) {
        const result = canonical.find((r) => r.requirementId === requirement.id)!;
        const gap = Math.max(requirement.requiredScore - result.score, 0);
        const row = await tx.assessmentCompetencyResult.create({
          data: { attemptId: id, ...result, gap },
        });
        weighted += result.score * requirement.weight;
        weights += requirement.weight;
        if (gap)
          gaps.push({
            resultId: row.id,
            gap,
            code: requirement.code,
            objective: requirement.learningObjective,
            resources: requirement.learningResources,
          });
      }
      const now = new Date();
      gaps.sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code));
      await tx.learningPlan.create({
        data: {
          attemptId: id,
          status: gaps.length ? 'PENDING' : 'COMPLETED',
          completedAt: gaps.length ? null : now,
          items: {
            create: gaps.map((gap, i) => ({
              resultId: gap.resultId,
              priority: i + 1,
              objective: gap.objective,
              resources: gap.resources,
            })),
          },
        },
      });
      await tx.assessmentAttempt.update({
        where: { id },
        data: {
          completedAt: now,
          assessorId: actorId,
          completionKey: key,
          completionHash: hash,
          overallScore: Math.round((weighted / weights) * 100) / 100,
        },
      });
      await tx.assessmentTarget.update({
        where: { id: attempt.targetId },
        data: { status: 'COMPLETED', completedAt: now },
      });
      const bookings = await tx.assessmentBooking.findMany({
        where: { targetId: attempt.targetId, status: 'SCHEDULED' },
      });
      for (const booking of bookings)
        await tx.assessmentBooking.update({
          where: { id: booking.id },
          data: {
            status: 'COMPLETED',
            events: {
              create: {
                actorId,
                action: 'COMPLETED',
                reason: 'Assessor recorded competency results',
              },
            },
          },
        });
      await audit(tx, actorId, 'assessment.completed', id, {
        targetId: attempt.targetId,
        skillGaps: gaps.length,
      });
    },
    { timeout: 15000 },
  );
  return getAttempt(found.target.applicantId, id);
}
export async function getLearningPlan(applicantId: string, id: string) {
  const plan = await prisma.learningPlan.findFirst({
    where: { id, attempt: { target: { applicantId } } },
    include: {
      items: {
        include: { result: { include: { requirement: true } } },
        orderBy: { priority: 'asc' },
      },
    },
  });
  requireCondition(plan, 404, 'NOT_FOUND', 'Learning plan not found');
  return plan;
}
export async function updateLearningProgress(
  applicantId: string,
  planId: string,
  itemId: string,
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED',
) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    const item = await tx.learningPlanItem.findFirst({
      where: { id: itemId, planId, plan: { attempt: { target: { applicantId } } } },
    });
    requireCondition(item, 404, 'NOT_FOUND', 'Learning plan item not found');
    await tx.learningPlanItem.update({
      where: { id: itemId },
      data: { status, completedAt: status === 'COMPLETED' ? new Date() : null },
    });
    const items = await tx.learningPlanItem.findMany({ where: { planId } });
    const completed = items.every((i) => i.status === 'COMPLETED');
    await tx.learningPlan.update({
      where: { id: planId },
      data: {
        status: completed
          ? 'COMPLETED'
          : items.some((i) => i.status !== 'PENDING')
            ? 'IN_PROGRESS'
            : 'PENDING',
        completedAt: completed ? new Date() : null,
      },
    });
    await audit(tx, applicantId, 'learning.progress_updated', itemId, { planId, status });
  });
  return getLearningPlan(applicantId, planId);
}
