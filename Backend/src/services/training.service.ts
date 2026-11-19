import { z } from 'zod';
import { prisma, userLock, type Tx } from '../config/prisma.js';
import { requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { initials, interviewReady } from './hiring.service.js';
import { notify } from './email.service.js';
const id = z.uuid();
export const sessionSchema = z
  .object({
    competencyId: id,
    title: z.string().trim().min(3).max(150),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    location: z.string().trim().min(3).max(300),
    capacity: z.coerce.number().int().min(1).max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const start = Date.parse(v.startsAt),
      end = Date.parse(v.endsAt);
    if (start <= Date.now())
      ctx.addIssue({ code: 'custom', path: ['startsAt'], message: 'Choose a future start time' });
    if (end <= start || end - start > 12 * 3600000)
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'A session must last between 1 minute and 12 hours',
      });
    if (end - start < 60000)
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'A session must last at least 1 minute',
      });
  });
export const assignmentSchema = z.object({ trainerId: id, learningItemId: id }).strict();
export const skillSchema = z.object({ trainerId: id, competencyId: id }).strict();
async function approved(tx: Tx, trainerId: string) {
  await userLock(tx, trainerId);
  const p = await tx.trainerProfile.findUnique({
    where: { userId: trainerId },
    include: { user: { select: { status: true, roles: { include: { role: true } } } } },
  });
  requireCondition(
    p?.status === 'APPROVED' &&
      p.user.status === 'ACTIVE' &&
      p.user.roles.some((r) => r.role.name === 'TRAINER'),
    403,
    'TRAINER_NOT_APPROVED',
    'An approved active trainer is required',
  );
  return p;
}
const eligible = {
  trainingAssignment: { isNot: { signedOffAt: { not: null } } },
  plan: {
    attempt: {
      completedAt: { not: null },
      target: { status: 'COMPLETED' as const, applicant: { status: 'ACTIVE' as const } },
    },
  },
  result: { gap: { gt: 0 } },
};
export async function trainingAdminData(search: string, page: number) {
  const where = {
    ...eligible,
    ...(search
      ? {
          OR: [
            {
              result: { requirement: { name: { contains: search, mode: 'insensitive' as const } } },
            },
            {
              plan: {
                attempt: {
                  target: {
                    applicant: { legalName: { contains: search, mode: 'insensitive' as const } },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [trainers, competencies, items, total] = await Promise.all([
    prisma.trainerProfile.findMany({
      where: {
        status: 'APPROVED',
        user: { status: 'ACTIVE', roles: { some: { role: { name: 'TRAINER' } } } },
      },
      select: {
        userId: true,
        user: { select: { legalName: true } },
        teachingSkills: {
          include: {
            competency: true,
            sessions: {
              where: { cancelledAt: null, startsAt: { gt: new Date() } },
              orderBy: { startsAt: 'asc' },
              take: 100,
            },
          },
        },
      },
      orderBy: { userId: 'asc' },
    }),
    prisma.competency.findMany({ orderBy: { name: 'asc' } }),
    prisma.learningPlanItem.findMany({
      where,
      take: 50,
      skip: (page - 1) * 50,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        objective: true,
        result: { select: { requirement: { select: { competencyId: true, name: true } } } },
        plan: {
          select: {
            attempt: {
              select: { target: { select: { applicant: { select: { legalName: true } } } } },
            },
          },
        },
        trainingAssignment: {
          select: { id: true, trainerId: true, enrollments: { select: { sessionId: true } } },
        },
      },
    }),
    prisma.learningPlanItem.count({ where }),
  ]);
  return { trainers, competencies, items, total, page };
}
export async function addTeachingSkill(actorId: string, input: z.infer<typeof skillSchema>) {
  return prisma.$transaction(async (tx) => {
    await approved(tx, input.trainerId);
    requireCondition(
      await tx.competency.findUnique({ where: { id: input.competencyId } }),
      404,
      'SKILL_NOT_FOUND',
      'Skill not found',
    );
    await tx.trainerSkill.upsert({
      where: { trainerId_competencyId: input },
      create: input,
      update: {},
    });
    await audit(tx, actorId, 'training.skill_assigned', input.trainerId, {
      competencyId: input.competencyId,
    });
  });
}
export async function assignTrainee(actorId: string, input: z.infer<typeof assignmentSchema>) {
  return prisma.$transaction(async (tx) => {
    await approved(tx, input.trainerId);
    await tx.$queryRaw`SELECT id FROM "LearningPlanItem" WHERE id=${input.learningItemId}::uuid FOR UPDATE`;
    const item = await tx.learningPlanItem.findFirst({
      where: { id: input.learningItemId, ...eligible },
      include: { result: { include: { requirement: true } } },
    });
    requireCondition(
      item,
      409,
      'LEARNING_ITEM_NOT_ELIGIBLE',
      'Choose an unfinished skill gap from a published assessment',
    );
    const competencyId = item.result.requirement.competencyId;
    requireCondition(
      await tx.trainerSkill.findFirst({
        where: { trainerId: input.trainerId, competencyId, enabled: true },
      }),
      409,
      'TRAINER_SKILL_REQUIRED',
      'Assign this teaching skill to the trainer first',
    );
    const existing = await tx.trainingAssignment.findUnique({ where: { learningItemId: item.id } });
    if (existing && existing.trainerId !== input.trainerId) {
      requireCondition(
        !(await tx.trainingEnrollment.count({ where: { assignmentId: existing.id } })),
        409,
        'TRAINING_ENROLLED',
        'This applicant already has a verified enrollment with their trainer',
      );
    }
    await tx.trainingAssignment.upsert({
      where: { learningItemId: item.id },
      create: { ...input, competencyId },
      update: { trainerId: input.trainerId, competencyId },
    });
    await audit(tx, actorId, 'training.trainee_assigned', item.id, {
      trainerId: input.trainerId,
      competencyId,
    });
  });
}
export async function trainerTraining(trainerId: string) {
  return prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);
    const groups = await tx.trainerSkill.findMany({
      where: { trainerId },
      orderBy: { competencyId: 'asc' },
      include: {
        competency: {
          include: {
            assessmentRequirements: {
              where: {
                result: { learningItem: { ...eligible, trainingAssignment: null } },
              },
              take: 25,
              orderBy: { id: 'asc' },
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
        },
        assignments: {
          where: { learningItem: { plan: eligible.plan, result: eligible.result } },
          select: {
            id: true,
            progress: true,
            performanceNotes: true,
            signedOffAt: true,
            enrollments: {
              select: {
                attendance: true,
                session: { select: { id: true, title: true, endsAt: true, cancelledAt: true } },
              },
            },
            learningItem: {
              select: {
                id: true,
                status: true,
                objective: true,
                plan: {
                  select: {
                    attempt: {
                      select: {
                        target: {
                          select: {
                            applicant: {
                              select: {
                                id: true,
                                legalName: true,
                                profile: {
                                  select: {
                                    discipline: true,
                                    educationLevel: true,
                                    professionalStatus: true,
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
            },
          },
        },
        sessions: { orderBy: { startsAt: 'desc' }, take: 100 },
      },
    });
    return groups.map(({ competency: { assessmentRequirements, ...competency }, ...group }) => ({
      ...group,
      competency,
      matchedApplicants: group.enabled
        ? assessmentRequirements.map(({ attempt: { target } }) => ({
            initials: initials(target.applicant.legalName),
            role: target.jobRole.title,
          }))
        : [],
    }));
  });
}
export async function saveTrainingSession(
  trainerId: string,
  input: z.infer<typeof sessionSchema>,
  sessionId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const profile = await approved(tx, trainerId);
    requireCondition(
      await tx.trainerSkill.findFirst({
        where: {
          trainerId,
          competencyId: input.competencyId,
          ...(sessionId ? {} : { enabled: true }),
        },
      }),
      403,
      'SKILL_NOT_ASSIGNED',
      'You can schedule only your assigned teaching skills',
    );
    if (sessionId)
      requireCondition(
        await tx.trainingSession.findFirst({
          where: {
            id: sessionId,
            trainerId,
            competencyId: input.competencyId,
            cancelledAt: null,
            startsAt: { gt: new Date() },
          },
        }),
        409,
        'SESSION_NOT_EDITABLE',
        'Only your future active sessions can be rescheduled',
      );
    const startsAt = new Date(input.startsAt),
      endsAt = new Date(input.endsAt);
    requireCondition(
      !(await tx.trainingSession.findFirst({
        where: {
          trainerId,
          cancelledAt: null,
          ...(sessionId ? { id: { not: sessionId } } : {}),
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
      })),
      409,
      'TRAINING_OVERLAP',
      'These dates overlap another training session',
    );
    const hours = workingHours.parse(profile.workingHours);
    if (hours.length) {
      const start = eastAfricaTime(startsAt);
      const end = eastAfricaTime(endsAt);
      requireCondition(
        hours.some(
          (window) =>
            window.day === start.day &&
            end.day === start.day &&
            start.time >= window.start + ':00' &&
            end.time <= window.end + ':00',
        ),
        409,
        'TRAINING_AVAILABILITY',
        'Choose a session within your working hours',
      );
    }
    const count = sessionId ? await tx.trainingEnrollment.count({ where: { sessionId } }) : 0;
    requireCondition(
      input.capacity >= count,
      409,
      'TRAINING_CAPACITY',
      `Capacity must cover all ${count} verified enrollments`,
    );
    const data = { ...input, startsAt, endsAt, trainerId };
    const session = sessionId
      ? await tx.trainingSession.update({ where: { id: sessionId }, data })
      : await tx.trainingSession.create({ data });
    await audit(
      tx,
      trainerId,
      sessionId ? 'training.session_rescheduled' : 'training.session_created',
      session.id,
    );
    await sessionEmails(tx, session, sessionId ? 'Training rescheduled' : 'Training scheduled');
    return session;
  });
}
async function sessionEmails(
  tx: Tx,
  session: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    location: string;
  },
  subject: string,
) {
  const rows = await tx.trainingAssignment.findMany({
    where: {
      enrollments: { some: { sessionId: session.id } },
      learningItem: { plan: eligible.plan },
    },
    select: {
      learningItem: {
        select: {
          plan: {
            select: {
              attempt: {
                select: { target: { select: { applicant: { select: { email: true } } } } },
              },
            },
          },
        },
      },
    },
  });
  const emails = new Set(rows.map((r) => r.learningItem.plan.attempt.target.applicant.email));
  for (const email of emails)
    await notify(
      tx,
      email,
      subject,
      `${session.title}\nStarts: ${session.startsAt.toISOString()}\nEnds: ${session.endsAt.toISOString()}\nLocation: ${session.location}\nTimes above are UTC.`,
    );
}
export async function cancelTrainingSession(trainerId: string, sessionId: string) {
  await prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);
    const session = await tx.trainingSession.findFirst({ where: { id: sessionId, trainerId } });
    requireCondition(session, 404, 'SESSION_NOT_FOUND', 'Training session not found');
    if (session.cancelledAt) return;
    requireCondition(
      session.startsAt > new Date(),
      409,
      'SESSION_STARTED',
      'A session that has started cannot be cancelled',
    );
    await tx.trainingSession.update({
      where: { id: sessionId },
      data: { cancelledAt: new Date() },
    });
    await audit(tx, trainerId, 'training.session_cancelled', sessionId);
    await sessionEmails(tx, session, 'Training cancelled');
  });
}

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const workingHours = z
  .array(
    z
      .object({
        day: z.number().int().min(0).max(6),
        start: clockTime,
        end: clockTime,
      })
      .strict(),
  )
  .max(7)
  .refine(
    (windows) =>
      new Set(windows.map((window) => window.day)).size === windows.length &&
      windows.every((window) => window.start < window.end),
    'Set one valid start and end time per day',
  );

function eastAfricaTime(value: Date) {
  const local = new Date(value.getTime() + 3 * 3600000);
  return { day: local.getUTCDay(), time: local.toISOString().slice(11, 19) };
}

export async function trainerHours(trainerId: string) {
  return prisma.$transaction(async (tx) => (await approved(tx, trainerId)).workingHours);
}

export async function setTrainerHours(trainerId: string, hours: z.infer<typeof workingHours>) {
  await prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);
    await tx.trainerProfile.update({ where: { userId: trainerId }, data: { workingHours: hours } });
    await audit(tx, trainerId, 'training.working_hours_updated', trainerId);
  });
}

export async function setTeachingSkill(trainerId: string, competencyId: string, enabled: boolean) {
  await prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);
    const updated = await tx.trainerSkill.updateMany({
      where: { trainerId, competencyId },
      data: { enabled },
    });
    requireCondition(
      updated.count,
      404,
      'SKILL_NOT_ASSIGNED',
      'This skill has not been certified for your profile',
    );
    await audit(tx, trainerId, 'training.teaching_skill_updated', competencyId, { enabled });
  });
}

export const enrollmentSchema = z
  .object({
    assignmentId: id,
    sessionId: id,
    reference: z.string().trim().min(2).max(150),
  })
  .strict();

export async function verifyEnrollment(actorId: string, input: z.infer<typeof enrollmentSchema>) {
  await prisma.$transaction(async (tx) => {
    const session = await tx.trainingSession.findUnique({ where: { id: input.sessionId } });
    requireCondition(session, 404, 'SESSION_NOT_FOUND', 'Training session not found');
    await approved(tx, session.trainerId);
    await tx.$queryRaw`SELECT item.id FROM "LearningPlanItem" item JOIN "TrainingAssignment" a ON a."learningItemId" = item.id WHERE a.id=${input.assignmentId}::uuid FOR UPDATE OF item`;
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: session.id } });
    const assignment = await tx.trainingAssignment.findFirst({
      where: {
        id: input.assignmentId,
        trainerId: session.trainerId,
        competencyId: session.competencyId,
        learningItem: eligible,
      },
      select: {
        learningItem: {
          select: {
            plan: {
              select: {
                attempt: {
                  select: {
                    target: { select: { applicant: { select: { email: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const key = { sessionId: current.id, assignmentId: input.assignmentId };
    if (await tx.trainingEnrollment.findUnique({ where: { sessionId_assignmentId: key } })) return;
    requireCondition(
      assignment && !current.cancelledAt && current.startsAt > new Date(),
      409,
      'ENROLLMENT_UNAVAILABLE',
      'Choose an upcoming session for this applicant’s assigned skill',
    );
    const count = await tx.trainingEnrollment.count({ where: { sessionId: current.id } });
    requireCondition(
      count < current.capacity,
      409,
      'TRAINING_CAPACITY',
      'This training session is full',
    );
    await tx.trainingEnrollment.create({
      data: { ...key, verifiedBy: actorId, paymentReference: input.reference },
    });
    await audit(tx, actorId, 'training.payment_verified', key.assignmentId, {
      sessionId: key.sessionId,
    });
    await notify(
      tx,
      assignment.learningItem.plan.attempt.target.applicant.email,
      'Training enrollment confirmed',
      `${current.title}\nStarts: ${current.startsAt.toISOString()} (UTC)\nLocation: ${current.location}`,
    );
  });
}

export const attendanceSchema = z
  .object({ attendance: z.enum(['PRESENT', 'ABSENT', 'EXCUSED']) })
  .strict();
export async function recordAttendance(
  trainerId: string,
  sessionId: string,
  assignmentId: string,
  attendance: z.infer<typeof attendanceSchema>['attendance'],
) {
  await prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);
    const updated = await tx.trainingEnrollment.updateMany({
      where: {
        sessionId,
        assignmentId,
        assignment: { trainerId },
        session: { trainerId, cancelledAt: null, startsAt: { lte: new Date() } },
      },
      data: { attendance },
    });
    requireCondition(
      updated.count,
      409,
      'ATTENDANCE_UNAVAILABLE',
      'Attendance is available for verified enrollments after the session starts',
    );
    await audit(tx, trainerId, 'training.attendance_recorded', assignmentId, {
      sessionId,
      attendance,
    });
  });
}

export const progressSchema = z
  .object({
    progress: z.enum(['IN_PROGRESS', 'NEEDS_ATTENTION', 'COMPLETED']),
    performanceNotes: z.string().trim().max(3000),
  })
  .strict();

export async function recordProgress(
  trainerId: string,
  assignmentId: string,
  input: z.infer<typeof progressSchema>,
) {
  await prisma.$transaction(async (tx) => {
    await approved(tx, trainerId);

    const assignment = await tx.trainingAssignment.findFirst({
      where: { id: assignmentId, trainerId, learningItem: { plan: eligible.plan } },
      include: {
        enrollments: {
          where: { session: { cancelledAt: null } },
          select: { session: { select: { endsAt: true } } },
        },
        learningItem: {
          include: {
            plan: {
              include: {
                attempt: {
                  include: {
                    target: {
                      select: { applicantId: true, applicant: { select: { email: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    requireCondition(assignment, 404, 'ASSIGNMENT_NOT_FOUND', 'Training assignment not found');
    requireCondition(
      !assignment.signedOffAt,
      409,
      'TRAINING_SIGNED_OFF',
      'This training milestone has already been signed off',
    );
    requireCondition(
      assignment.enrollments.length,
      409,
      'ENROLLMENT_REQUIRED',
      'An administrator must verify payment and enroll the applicant',
    );
    const completed = input.progress === 'COMPLETED';
    const now = new Date();
    requireCondition(
      !completed || assignment.enrollments.some((row) => row.session.endsAt <= now),
      409,
      'TRAINING_NOT_FINISHED',
      'Sign off after an enrolled session ends',
    );
    const { learningItem } = assignment;
    const { attempt } = learningItem.plan;
    await userLock(tx, attempt.target.applicantId);
    await tx.trainingAssignment.update({
      where: { id: assignmentId },
      data: { ...input, ...(completed ? { signedOffAt: now } : {}) },
    });
    if (completed) {
      await tx.learningPlanItem.update({
        where: { id: learningItem.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      const ready = await tx.assessmentAttempt.count({
        where: { id: attempt.id, ...interviewReady },
      });
      const remaining = await tx.learningPlanItem.count({
        where: { planId: learningItem.planId, status: { not: 'COMPLETED' } },
      });
      await tx.learningPlan.update({
        where: { id: learningItem.planId },
        data: {
          status: remaining ? 'IN_PROGRESS' : 'COMPLETED',
          completedAt: remaining ? null : now,
        },
      });
      if (ready)
        await notify(
          tx,
          attempt.target.applicant.email,
          'Training complete',
          'Your trainer has signed off on your remaining training. Your mock interview is ready to be scheduled.',
        );
    }
    await audit(tx, trainerId, 'training.progress_recorded', assignmentId, {
      progress: input.progress,
    });
  });
}
