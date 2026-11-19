import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  trainerProfile: { findUnique: vi.fn() },
  trainerSkill: { findFirst: vi.fn(), findMany: vi.fn() },
  trainingSession: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  trainingAssignment: { findMany: vi.fn() },
  trainingEnrollment: { count: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock('../../src/config/prisma.js', () => ({
  prisma: { $transaction: (run: (tx: unknown) => unknown) => run(mocks) },
  userLock: vi.fn(),
}));
vi.mock('../../src/services/email.service.js', () => ({ notify: vi.fn() }));
import {
  sessionSchema,
  saveTrainingSession,
  trainerTraining,
  cancelTrainingSession,
} from '../../src/services/training.service.js';
const input = {
  competencyId: '10000000-0000-4000-8000-000000000001',
  title: 'PLC workshop',
  startsAt: '2030-01-01T06:00:00Z',
  endsAt: '2030-01-01T08:00:00Z',
  location: 'Engineering lab',
  capacity: 20,
};
describe('trainer scheduling boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.trainerProfile.findUnique.mockResolvedValue({
      status: 'APPROVED',
      workingHours: [],
      user: { status: 'ACTIVE', roles: [{ role: { name: 'TRAINER' } }] },
    });
    mocks.trainerSkill.findFirst.mockResolvedValue({});
    mocks.trainingEnrollment.count.mockResolvedValue(2);
    mocks.trainingAssignment.findMany.mockResolvedValue([]);
  });
  it('rejects past dates, reverse ranges, excessive duration and invalid capacity', () => {
    expect(sessionSchema.safeParse(input).success).toBe(true);
    for (const patch of [
      { startsAt: '2020-01-01T06:00:00Z' },
      { endsAt: input.startsAt },
      { endsAt: '2030-01-02T08:00:00Z' },
      { capacity: 0 },
    ])
      expect(sessionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
  it('denies unapproved trainers before any trainee data is queried', async () => {
    mocks.trainerProfile.findUnique.mockResolvedValue({
      status: 'SUSPENDED',
      user: { status: 'ACTIVE', roles: [{ role: { name: 'TRAINER' } }] },
    });
    await expect(trainerTraining('trainer')).rejects.toMatchObject({
      code: 'TRAINER_NOT_APPROVED',
    });
    expect(mocks.trainerSkill.findMany).not.toHaveBeenCalled();
  });
  it('does not allow scheduling a skill owned by another trainer', async () => {
    mocks.trainerSkill.findFirst.mockResolvedValue(null);
    await expect(saveTrainingSession('trainer', input)).rejects.toMatchObject({
      code: 'SKILL_NOT_ASSIGNED',
    });
    expect(mocks.trainingSession.create).not.toHaveBeenCalled();
  });
  it('rejects overlapping dates across skill groups', async () => {
    mocks.trainingSession.findFirst.mockResolvedValue({ id: 'other' });
    await expect(saveTrainingSession('trainer', input)).rejects.toMatchObject({
      code: 'TRAINING_OVERLAP',
    });
  });
  it('prevents rescheduling below verified enrollment', async () => {
    mocks.trainingSession.findFirst
      .mockResolvedValueOnce({ id: 'session' })
      .mockResolvedValueOnce(null);
    mocks.trainingEnrollment.count.mockResolvedValue(21);
    await expect(saveTrainingSession('trainer', input, 'session')).rejects.toMatchObject({
      code: 'TRAINING_CAPACITY',
    });
  });
  it('enforces the trainer’s weekly hours in East Africa Time', async () => {
    mocks.trainerProfile.findUnique.mockResolvedValue({
      status: 'APPROVED',
      workingHours: [{ day: 2, start: '09:00', end: '10:00' }],
      user: { status: 'ACTIVE', roles: [{ role: { name: 'TRAINER' } }] },
    });
    mocks.trainingSession.findFirst.mockResolvedValue(null);
    await expect(saveTrainingSession('trainer', input)).rejects.toMatchObject({
      code: 'TRAINING_AVAILABILITY',
    });
    expect(mocks.trainingSession.create).not.toHaveBeenCalled();
  });
  it('creates a nonoverlapping session with the server-owned trainer id', async () => {
    mocks.trainingSession.findFirst.mockResolvedValue(null);
    mocks.trainingSession.create.mockResolvedValue({
      id: 'session',
      ...input,
      trainerId: 'trainer',
    });
    await saveTrainingSession('trainer', input);
    expect(mocks.trainingSession.create).toHaveBeenCalledWith({
      data: {
        ...input,
        trainerId: 'trainer',
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      },
    });
    expect(mocks.auditLog.create).toHaveBeenCalled();
  });
  it('cannot cancel another trainers session', async () => {
    mocks.trainingSession.findFirst.mockResolvedValue(null);
    await expect(cancelTrainingSession('trainer', 'foreign')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
    expect(mocks.trainingSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', trainerId: 'trainer' },
    });
    expect(mocks.trainingSession.update).not.toHaveBeenCalled();
  });
});
