import {
  approveRequest,
  candidateDetails,
  employerRequests,
  interviewQueue,
  recordInterview,
  requestCandidate,
  scheduleInterview,
  shortlist,
} from '../../src/services/hiring.service.js';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../../src/config/prisma.js';
import {
  addTeachingSkill,
  assignTrainee,
  trainerTraining,
  saveTrainingSession,
  cancelTrainingSession,
  verifyEnrollment,
  recordAttendance,
  recordProgress,
} from '../../src/services/training.service.js';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('training delivery on PostgreSQL', () => {
  afterAll(() => prisma.$disconnect());
  it('enforces trainer enrollment and carries signed-off applicants through masked hiring and approved disclosure', async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/nexus_test')
      throw new Error('Isolated test database required');
    const tag = crypto.randomUUID();
    const role = await prisma.role.upsert({
      where: { name: 'TRAINER' },
      create: { name: 'TRAINER' },
      update: {},
    });
    const user = async (name: string, trainer = false) =>
      prisma.user.create({
        data: {
          email: `${name}-${tag}@example.test`,
          legalName: name,
          emailVerifiedAt: new Date(),
          ...(trainer
            ? {
                roles: { create: { roleId: role.id } },
                trainerProfile: { create: { status: 'APPROVED' } },
              }
            : {}),
        },
      });
    const t1 = await user('trainer-one', true),
      t2 = await user('trainer-two', true),
      learner = await user('learner'),
      learner2 = await user('learner-two');
    const c1 = await prisma.competency.create({
      data: { code: `A-${tag}`, name: 'PLC programming', description: 'PLC skill' },
    });
    const c2 = await prisma.competency.create({
      data: { code: `B-${tag}`, name: 'Robot safety', description: 'Robot skill' },
    });
    const career = await prisma.jobRole.create({
      data: { title: `Career-${tag}`, description: 'Test career' },
    });
    const framework = await prisma.competencyFramework.create({
      data: { jobRoleId: career.id, version: 1, title: 'Test framework' },
    });
    const blueprint = await prisma.assessmentBlueprint.create({
      data: {
        jobRoleId: career.id,
        frameworkId: framework.id,
        version: 1,
        title: 'Test blueprint',
        durationMinutes: 30,
        instructions: 'Test',
      },
    });
    async function publishAssessment(applicantId: string, competencyId: string, score = 50) {
      const target = await prisma.assessmentTarget.create({
        data: { applicantId, jobRoleId: career.id },
      });
      const attempt = await prisma.assessmentAttempt.create({
        data: { targetId: target.id, blueprintId: blueprint.id, contextSnapshot: {} },
      });
      const requirement = await prisma.assessmentRequirement.create({
        data: {
          attemptId: attempt.id,
          competencyId,
          code: 'TEST',
          name: 'Test skill',
          description: 'Test',
          requiredScore: 80,
          weight: 100,
          sources: [],
          learningObjective: 'Practice',
        },
      });
      await prisma.assessmentTarget.update({
        where: { id: target.id },
        data: { status: 'PREPARED', lockedAt: new Date() },
      });
      await prisma.assessmentTarget.update({
        where: { id: target.id },
        data: { status: 'IN_PROGRESS' },
      });
      const result = await prisma.assessmentCompetencyResult.create({
        data: {
          attemptId: attempt.id,
          requirementId: requirement.id,
          score,
          gap: Math.max(80 - score, 0),
          evidence: 'Reviewed practical evidence',
        },
      });
      await prisma.assessmentAttempt.update({
        where: { id: attempt.id },
        data: {
          startedAt: new Date(Date.now() - 60000),
          completedAt: new Date(),
          assessorId: t1.id,
          overallScore: score,
          completionKey: crypto.randomUUID(),
          completionHash: 'test',
        },
      });
      await prisma.assessmentTarget.update({
        where: { id: target.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      const plan = await prisma.learningPlan.create({
        data: {
          attemptId: attempt.id,
          ...(score >= 80 ? { status: 'COMPLETED', completedAt: new Date() } : {}),
        },
      });
      if (score >= 80) return { plan, learningItem: null };
      const learningItem = await prisma.learningPlanItem.create({
        data: {
          planId: plan.id,
          resultId: result.id,
          priority: 1,
          objective: 'Practice the assessed skill',
        },
      });
      return { plan, learningItem };
    }
    const i1 = (await publishAssessment(learner.id, c1.id)).learningItem!;
    const i2 = (await publishAssessment(learner2.id, c2.id)).learningItem!;
    await addTeachingSkill(t1.id, { trainerId: t1.id, competencyId: c1.id });
    await addTeachingSkill(t1.id, { trainerId: t1.id, competencyId: c2.id });
    await addTeachingSkill(t1.id, { trainerId: t2.id, competencyId: c1.id });
    expect((await trainerTraining(t2.id))[0]!.matchedApplicants).toEqual([
      { initials: 'L.', role: career.title },
    ]);
    await assignTrainee(t1.id, { trainerId: t1.id, learningItemId: i1.id });
    await assignTrainee(t1.id, { trainerId: t1.id, learningItemId: i2.id });
    const groups = await trainerTraining(t1.id);
    expect(groups).toHaveLength(2);
    expect(groups.reduce((n, g) => n + g.assignments.length, 0)).toBe(2);
    expect((await trainerTraining(t2.id))[0]!.assignments).toHaveLength(0);
    const input = {
      competencyId: c1.id,
      title: 'PLC training',
      startsAt: '2031-02-01T06:00:00Z',
      endsAt: '2031-02-01T08:00:00Z',
      location: 'Lab A',
      capacity: 1,
    };
    const session = await saveTrainingSession(t1.id, input);
    await expect(
      saveTrainingSession(t1.id, { ...input, competencyId: c2.id }),
    ).rejects.toMatchObject({ code: 'TRAINING_OVERLAP' });
    await expect(cancelTrainingSession(t2.id, session.id)).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    await saveTrainingSession(t2.id, input);
    await expect(
      prisma.trainingSession.create({
        data: {
          ...input,
          trainerId: t1.id,
          competencyId: c2.id,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
        },
      }),
    ).rejects.toThrow();
    await cancelTrainingSession(t1.id, session.id);
    await saveTrainingSession(t1.id, input);
    await assignTrainee(t1.id, { trainerId: t2.id, learningItemId: i1.id });
    expect(
      (await trainerTraining(t1.id)).find((g) => g.competencyId === c1.id)!.assignments,
    ).toHaveLength(0);
    expect((await trainerTraining(t2.id))[0]!.assignments).toHaveLength(1);
    const {
      assignments: [assignment],
      sessions: [enrollmentSession],
    } = (await trainerTraining(t2.id))[0]!;
    const plan = await prisma.learningPlan.findUniqueOrThrow({ where: { id: i1.planId } });
    const completion = {
      progress: 'COMPLETED' as const,
      performanceNotes: 'Demonstrated the skill',
    };
    await expect(recordProgress(t2.id, assignment!.id, completion)).rejects.toMatchObject({
      code: 'ENROLLMENT_REQUIRED',
    });
    await verifyEnrollment(t1.id, {
      assignmentId: assignment!.id,
      sessionId: enrollmentSession!.id,
      reference: 'training-receipt',
    });
    await expect(recordProgress(t2.id, assignment!.id, completion)).rejects.toMatchObject({
      code: 'TRAINING_NOT_FINISHED',
    });
    await prisma.trainingSession.update({
      where: { id: enrollmentSession!.id },
      data: { startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000) },
    });
    await expect(
      recordAttendance(t1.id, enrollmentSession!.id, assignment!.id, 'PRESENT'),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_UNAVAILABLE' });
    await recordAttendance(t2.id, enrollmentSession!.id, assignment!.id, 'PRESENT');
    await recordProgress(t2.id, assignment!.id, completion);
    expect((await interviewQueue(1, 'READY')).rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: plan.attemptId })]),
    );
    await scheduleInterview(t1.id, plan.attemptId, {
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      instructions: 'Meet at Lab A',
    });
    expect((await shortlist(career.id, 1)).rows).toEqual([]);
    await prisma.mockInterview.update({
      where: { attemptId: plan.attemptId },
      data: { scheduledAt: new Date(Date.now() - 3600000) },
    });
    await recordInterview(t1.id, plan.attemptId, 'PASSED');
    const employer = await user('employer-one');
    const otherEmployer = await user('employer-two');
    const found = (await shortlist(career.id, 1)).rows;
    expect(found).toEqual([
      {
        reference: expect.any(String),
        initials: 'L.',
        verifiedSkills: ['Test skill'],
        assessmentStatus: 'Upskilling and mock interview passed',
      },
    ]);
    await requestCandidate(employer.id, found[0]!.reference);
    await requestCandidate(employer.id, found[0]!.reference);
    const requests = (await employerRequests(employer.id, 1)).rows;
    expect(requests).toHaveLength(1);
    const requestId = requests[0]!.id;
    await expect(candidateDetails(employer.id, requestId)).rejects.toMatchObject({
      code: 'DETAILS_UNAVAILABLE',
    });
    await approveRequest(t1.id, requestId, 'procurement-reference');
    await expect(candidateDetails(otherEmployer.id, requestId)).rejects.toMatchObject({
      code: 'DETAILS_UNAVAILABLE',
    });
    await expect(candidateDetails(employer.id, requestId)).resolves.toMatchObject({
      legalName: learner.legalName,
      email: learner.email,
    });
    // A verified initial assessment with no gaps skips training but still needs a mock interview.
    const { plan: initialPlan } = await publishAssessment(
      (await user('initial-pass')).id,
      c1.id,
      90,
    );
    await scheduleInterview(t1.id, initialPlan.attemptId, {
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      instructions: 'Meet at Lab B',
    });
    await prisma.mockInterview.update({
      where: { attemptId: initialPlan.attemptId },
      data: { scheduledAt: new Date(Date.now() - 3600000) },
    });
    await recordInterview(t1.id, initialPlan.attemptId, 'PASSED');
    expect((await shortlist(career.id, 1)).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          initials: 'I.',
          assessmentStatus: 'Initial assessment and mock interview passed',
        }),
      ]),
    );
    expect(await prisma.notificationOutbox.count()).toBeGreaterThan(0);
    await prisma.trainerProfile.update({ where: { userId: t1.id }, data: { status: 'SUSPENDED' } });
    await expect(trainerTraining(t1.id)).rejects.toMatchObject({ code: 'TRAINER_NOT_APPROVED' });
  });
});
