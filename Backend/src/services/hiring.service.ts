import { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { notify } from './email.service.js';

const pageSize = 25;
export const paging = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) });
export const scheduling = z
  .object({
    scheduledAt: z.iso.datetime({ offset: true }),
    instructions: z.string().trim().min(3).max(1000),
  })
  .strict();
export const outcome = z.object({ outcome: z.enum(['PASSED', 'FAILED']) }).strict();
export const procurement = z.object({ reference: z.string().trim().min(2).max(150) }).strict();

export const interviewReady = {
  completedAt: { not: null },
  target: { status: 'COMPLETED', applicant: { status: 'ACTIVE', emailVerifiedAt: { not: null } } },
  results: {
    some: {},
    every: {
      OR: [{ gap: 0 }, { learningItem: { trainingAssignment: { signedOffAt: { not: null } } } }],
    },
  },
  learningPlan: {
    items: { every: { trainingAssignment: { is: { signedOffAt: { not: null } } } } },
  },
} satisfies Prisma.AssessmentAttemptWhereInput;

function pageOptions(page: number) {
  return { take: pageSize + 1, skip: (page - 1) * pageSize, orderBy: { id: 'asc' as const } };
}

function resultPage<T>(rows: T[], page: number) {
  return { rows: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

function qualifiedFor(roleId?: string) {
  return {
    outcome: 'PASSED',
    attempt: {
      ...interviewReady,
      target: {
        ...interviewReady.target,
        jobRole: { active: true, ...(roleId ? { id: roleId } : {}) },
      },
    },
  } satisfies Prisma.MockInterviewWhereInput;
}

export async function findRoles(search: string) {
  return prisma.jobRole.findMany({
    where: { active: true, title: { contains: search, mode: 'insensitive' } },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
    take: 50,
  });
}

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => `${Array.from(part)[0]?.toUpperCase()}.`)
    .join(' ');
}

const verifiedAssessment = {
  results: { select: { gap: true, requirement: { select: { name: true } } } },
} satisfies Prisma.AssessmentAttemptSelect;

function assessmentSummary(attempt: { results: { gap: number; requirement: { name: string } }[] }) {
  return {
    verifiedSkills: [...new Set(attempt.results.map((row) => row.requirement.name))].sort(),
    assessmentStatus: attempt.results.some((row) => row.gap > 0)
      ? 'Upskilling and mock interview passed'
      : 'Initial assessment and mock interview passed',
  };
}

export async function shortlist(roleId: string, page: number) {
  const rows = await prisma.mockInterview.findMany({
    ...pageOptions(page),
    where: qualifiedFor(roleId),
    select: {
      id: true,
      attempt: {
        select: {
          ...verifiedAssessment,
          target: { select: { applicant: { select: { legalName: true } } } },
        },
      },
    },
  });
  return resultPage(
    rows.map(({ id, attempt }) => ({
      reference: id,
      initials: initials(attempt.target.applicant.legalName),
      ...assessmentSummary(attempt),
    })),
    page,
  );
}

export async function requestCandidate(employerId: string, interviewId: string) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, employerId);
    requireCondition(
      await tx.mockInterview.findFirst({
        where: { id: interviewId, ...qualifiedFor() },
        select: { id: true },
      }),
      404,
      'CANDIDATE_NOT_FOUND',
      'Candidate is unavailable',
    );
    const key = { employerId, interviewId };
    const existing = await tx.candidateAccess.findUnique({
      where: { employerId_interviewId: key },
    });
    if (existing) return;
    const row = await tx.candidateAccess.create({ data: key });
    await audit(tx, employerId, 'hiring.details_requested', row.id);
  });
}

export async function employerRequests(employerId: string, page: number) {
  const rows = await prisma.candidateAccess.findMany({
    ...pageOptions(page),
    where: { employerId, interview: qualifiedFor() },
    select: {
      id: true,
      interviewId: true,
      confirmedAt: true,
      interview: {
        select: {
          attempt: {
            select: {
              target: {
                select: {
                  applicant: { select: { legalName: true } },
                  jobRole: { select: { title: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  return resultPage(
    rows.map((row) => ({
      id: row.id,
      candidateReference: row.interviewId,
      initials: initials(row.interview.attempt.target.applicant.legalName),
      role: row.interview.attempt.target.jobRole.title,
      approved: Boolean(row.confirmedAt),
    })),
    page,
  );
}

export async function candidateDetails(employerId: string, requestId: string) {
  const row = await prisma.candidateAccess.findFirst({
    where: { id: requestId, employerId, confirmedAt: { not: null }, interview: qualifiedFor() },
    select: {
      interview: {
        select: {
          attempt: {
            select: {
              ...verifiedAssessment,
              target: {
                select: {
                  applicant: {
                    select: {
                      legalName: true,
                      email: true,
                      phone: true,
                      profile: {
                        select: {
                          country: true,
                          region: true,
                          educationLevel: true,
                          institution: true,
                          discipline: true,
                          professionalStatus: true,
                          graduationYear: true,
                          summary: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  requireCondition(row, 404, 'DETAILS_UNAVAILABLE', 'Candidate details are unavailable');
  const { attempt } = row.interview;
  return { ...attempt.target.applicant, ...assessmentSummary(attempt) };
}

export async function adminRequests(page: number) {
  const rows = await prisma.candidateAccess.findMany({
    ...pageOptions(page),
    where: { confirmedAt: null, interview: qualifiedFor() },
    select: {
      id: true,
      requestedAt: true,
      employer: { select: { legalName: true, email: true } },
      interview: {
        select: {
          attempt: {
            select: {
              target: {
                select: {
                  jobRole: { select: { title: true } },
                  applicant: { select: { legalName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  return resultPage(rows, page);
}

export async function approveRequest(actorId: string, requestId: string, reference: string) {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const result = await tx.candidateAccess.updateMany({
      where: { id: requestId, confirmedAt: null, interview: qualifiedFor() },
      data: { confirmedAt: now, confirmedBy: actorId, procurementReference: reference },
    });
    requireCondition(
      result.count,
      409,
      'REQUEST_UNAVAILABLE',
      'This request is no longer awaiting confirmation',
    );
    await audit(tx, actorId, 'hiring.procurement_confirmed', requestId);
  });
}

export async function grantEmployer(actorId: string, email: string) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { email, status: 'ACTIVE', emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    requireCondition(user, 404, 'ACCOUNT_NOT_FOUND', 'No active, verified account has that email');
    await userLock(tx, user.id);
    const role = await tx.role.findUniqueOrThrow({ where: { name: 'EMPLOYER' } });
    const key = { userId: user.id, roleId: role.id };
    await tx.userRole.upsert({ where: { userId_roleId: key }, create: key, update: {} });
    await audit(tx, actorId, 'hiring.employer_access_granted', user.id);
  });
}

export async function interviewQueue(page: number, stage: 'READY' | 'SCHEDULED' | 'RECORDED') {
  const rows = await prisma.assessmentAttempt.findMany({
    ...pageOptions(page),
    where: {
      ...interviewReady,
      mockInterview:
        stage === 'READY'
          ? { is: null }
          : { is: { outcome: stage === 'SCHEDULED' ? null : { not: null } } },
    },
    select: {
      id: true,
      mockInterview: { select: { scheduledAt: true, instructions: true, outcome: true } },
      target: {
        select: {
          jobRole: { select: { title: true } },
          applicant: { select: { legalName: true } },
        },
      },
    },
  });
  return resultPage(rows, page);
}

export async function scheduleInterview(
  actorId: string,
  attemptId: string,
  input: z.infer<typeof scheduling>,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AssessmentAttempt" WHERE id=${attemptId}::uuid FOR UPDATE`;
    const attempt = await tx.assessmentAttempt.findFirst({
      where: { id: attemptId, ...interviewReady },
      select: {
        mockInterview: { select: { outcome: true } },
        target: { select: { applicant: { select: { email: true } } } },
      },
    });
    requireCondition(
      attempt && !attempt.mockInterview?.outcome,
      409,
      'INTERVIEW_NOT_READY',
      'This applicant is unavailable for scheduling',
    );
    const scheduledAt = new Date(input.scheduledAt);
    requireCondition(scheduledAt > new Date(), 422, 'INTERVIEW_DATE', 'Choose a future time');
    const data = { scheduledAt, instructions: input.instructions };
    await tx.mockInterview.upsert({
      where: { attemptId },
      create: { attemptId, ...data },
      update: data,
    });
    await audit(tx, actorId, 'hiring.mock_interview_scheduled', attemptId);
    await notify(
      tx,
      attempt.target.applicant.email,
      'Mock interview scheduled',
      `Your mock interview is scheduled for ${scheduledAt.toISOString()} (UTC).\n\n${input.instructions}`,
    );
  });
}

export async function recordInterview(
  actorId: string,
  attemptId: string,
  result: z.infer<typeof outcome>['outcome'],
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AssessmentAttempt" WHERE id=${attemptId}::uuid FOR UPDATE`;
    const updated = await tx.mockInterview.updateMany({
      where: {
        attemptId,
        scheduledAt: { lte: new Date() },
        outcome: null,
        attempt: interviewReady,
      },
      data: { outcome: result },
    });
    requireCondition(
      updated.count,
      409,
      'INTERVIEW_NOT_COMPLETE',
      'Record an outcome after the scheduled interview',
    );
    await audit(tx, actorId, 'hiring.mock_interview_recorded', attemptId, { outcome: result });
  });
}
