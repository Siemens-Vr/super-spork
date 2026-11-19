import { expireBookingsForUser } from './assessment-lifecycle.service.js';
import type { z } from 'zod';
import { prisma, userLock, type Tx } from '../config/prisma.js';
import { requireCondition } from '../errors/app-error.js';
import { notify } from './email.service.js';
import { activeTargetStatuses, targetForBooking } from './assessment-target.service.js';
import { audit } from '../utils/audit.js';
import { applicantProfileSelect, isProfileComplete } from '../utils/applicant-profile.js';
import type { availabilitySchema } from '../validators/assessment.schema.js';
import {
  assessmentIdentityReadiness,
  currentAssessmentDocuments,
  identityMessages,
} from './assessment-identity-policy.js';
import { interviewer } from '../integrations/assessment-interview/provider.js';
import {
  onDemandOccupancy,
  onDemandSetupMinutes,
  setupExpiresAt,
} from './assessment-on-demand-policy.js';
import type { deliverySchema } from '../validators/assessment.schema.js';
const bookingInclude = {
  target: { select: { attempt: { select: { id: true, startedAt: true } } } },
  blueprint: { include: { jobRole: true } },
  slot: { include: { availability: true } },
  events: { orderBy: { createdAt: 'asc' as const } },
};
export async function eligibility(applicantId: string, tx: Tx = prisma, blueprintId?: string) {
  const u = await tx.user.findUniqueOrThrow({
    where: { id: applicantId },
    include: {
      profile: { select: applicantProfileSelect },
      documents: { where: currentAssessmentDocuments },
      assessmentTargets: {
        where: { status: { in: [...activeTargetStatuses] } },
        include: { jobRole: true, attempt: true },
        take: 1,
      },
    },
  });
  const reasons: string[] = [];
  if (u.status !== 'ACTIVE') reasons.push('ACCOUNT_RESTRICTED');
  if (!u.emailVerifiedAt) reasons.push('EMAIL_NOT_VERIFIED');
  if (!isProfileComplete(u)) reasons.push('PROFILE_INCOMPLETE');
  const identity = assessmentIdentityReadiness(u.documents);
  if (identity.reason) reasons.push(identity.reason);
  const target = u.assessmentTargets[0];
  const role = target?.jobRole;
  if (!target) reasons.push('TARGET_REQUIRED');
  if (!role?.active) reasons.push('TARGET_ROLE_REQUIRED');
  const blueprints = await tx.assessmentBlueprint.findMany({
    where: {
      ...(blueprintId ? { id: blueprintId } : {}),
      ...(target?.attempt ? { id: target.attempt.blueprintId } : {}),
      ...(blueprintId && target?.attempt ? { AND: { id: blueprintId } } : {}),
      jobRoleId: role?.id ?? '00000000-0000-0000-0000-000000000000',
      active: true,
      framework: { approved: true, scope: 'CORE' },
    },
  });
  if (!blueprints.length) reasons.push('BLUEPRINT_UNAVAILABLE');
  const policies = await Promise.all(
    blueprints.map(async (b) => {
      const policy = {
        blueprintId: b.id,
        reasons: [
          ...reasons,
          ...(!identity.reason &&
          assessmentIdentityReadiness(u.documents, b.requiresAuthenticatedIdentity).reason
            ? ['IDENTITY_AUTHENTICATION_REQUIRED']
            : []),
          ...(b.requiresAuthenticatedAcademic &&
          !u.documents.some(
            (d) =>
              !['NATIONAL_ID', 'PASSPORT'].includes(d.category) &&
              d.status === 'AUTHENTICATED' &&
              d.scanStatus === 'CLEAN',
          )
            ? ['ACADEMIC_AUTHENTICATION_REQUIRED']
            : []),
        ],
      };
      const demandReasons = [...policy.reasons];
      if (!b.onDemandEnabled || b.requiresSupervision || b.requiresEquipment)
        demandReasons.push('SCHEDULED_ONLY');
      if (!target?.attempt || target.status !== 'PREPARED')
        demandReasons.push('TARGET_NOT_PREPARED');
      if (!interviewer.ready()) demandReasons.push('INTERVIEWER_UNAVAILABLE');
      if (target?.attempt) {
        const snapshot = target.attempt.contextSnapshot as {
          blueprint: {
            requiresAuthenticatedIdentity: boolean;
            requiresAuthenticatedAcademic: boolean;
          };
        };
        const pinnedIdentity = assessmentIdentityReadiness(
          u.documents,
          snapshot.blueprint.requiresAuthenticatedIdentity,
        );
        if (pinnedIdentity.reason && !demandReasons.includes(pinnedIdentity.reason))
          demandReasons.push(pinnedIdentity.reason);
        if (
          snapshot.blueprint.requiresAuthenticatedAcademic &&
          !u.documents.some(
            (d) =>
              !['NATIONAL_ID', 'PASSPORT'].includes(d.category) &&
              d.status === 'AUTHENTICATED' &&
              d.scanStatus === 'CLEAN',
          )
        )
          demandReasons.push('ACADEMIC_AUTHENTICATION_REQUIRED');
        if (
          await tx.assessmentTargetQualification.count({
            where: {
              targetId: target.id,
              document: { OR: [{ scanStatus: { not: 'CLEAN' } }, { status: 'REJECTED' }] },
            },
          })
        )
          demandReasons.push('QUALIFICATION_INVALID');
        const [requirements, scenarios] = await Promise.all([
          tx.assessmentRequirement.findMany({
            where: { attemptId: target.attempt.id },
            select: { competencyId: true },
          }),
          tx.blueprintScenario.findMany({
            where: { blueprintId: b.id, scenario: { approved: true } },
            select: { scenario: { select: { competencyIds: true } } },
          }),
        ]);
        if (
          !scenarios.length ||
          requirements.some(
            (r) => !scenarios.some((s) => s.scenario.competencyIds.includes(r.competencyId)),
          )
        )
          demandReasons.push('APPROVED_SCENARIOS_REQUIRED');
      }
      const remainingCapacity = b.onDemandEnabled
        ? Math.max(0, b.onDemandCapacity - (await onDemandOccupancy(b.id, tx)))
        : 0;
      if (b.onDemandEnabled && !remainingCapacity) demandReasons.push('ON_DEMAND_FULL');
      return {
        ...policy,
        onDemand: {
          enabled: b.onDemandEnabled,
          available: !demandReasons.length,
          remainingCapacity,
          durationMinutes: b.durationMinutes,
          setupMinutes: onDemandSetupMinutes,
          reasons: [...new Set(demandReasons)],
        },
      };
    }),
  );
  return {
    targetId: target?.id ?? null,
    attemptId: target?.attempt?.id ?? null,
    eligible: policies.some((p) => !p.reasons.length),
    reasons,
    identityRecovery: identity.recovery,
    blueprints: policies,
    timezone: 'Africa/Nairobi',
  };
}
export function generateSlots(startsAt: Date, endsAt: Date, durationMinutes: number) {
  const result: { startsAt: Date; endsAt: Date }[] = [];
  for (
    let cursor = startsAt.getTime();
    cursor + durationMinutes * 60000 <= endsAt.getTime();
    cursor += durationMinutes * 60000
  ) {
    requireCondition(
      result.length < 2000,
      422,
      'AVAILABILITY_TOO_LARGE',
      'Availability may contain at most 2000 slots',
    );
    result.push({ startsAt: new Date(cursor), endsAt: new Date(cursor + durationMinutes * 60000) });
  }
  return result;
}
export async function createAvailability(
  actorId: string,
  input: z.infer<typeof availabilitySchema>,
) {
  return prisma.$transaction(async (tx) => {
    const b = await tx.assessmentBlueprint.findUnique({
      where: { id: input.blueprintId },
      include: { framework: true },
    });
    requireCondition(
      b?.active && b.framework.approved,
      422,
      'BLUEPRINT_INVALID',
      'Select an active, approved blueprint',
    );
    const startsAt = new Date(input.startsAt),
      endsAt = new Date(input.endsAt);
    requireCondition(
      startsAt > new Date() && endsAt.getTime() - startsAt.getTime() <= 90 * 86400000,
      422,
      'INVALID_WINDOW',
      'Availability must be future and at most 90 days long',
    );
    const slots = generateSlots(startsAt, endsAt, b.durationMinutes);
    requireCondition(
      slots.length,
      422,
      'INVALID_WINDOW',
      'Window must fit at least one assessment',
    );
    const a = await tx.assessmentAvailability.create({
      data: { ...input, startsAt, endsAt, slots: { create: slots } },
      include: { slots: true },
    });
    await audit(tx, actorId, 'assessment.availability_created', a.id, {
      slotCount: slots.length,
      capacity: input.capacity,
    });
    return a;
  });
}
export async function availableSlots(
  applicantId: string,
  blueprintId: string,
  from?: string,
  to?: string,
) {
  const e = await eligibility(applicantId, prisma, blueprintId);
  requireCondition(
    e.eligible,
    409,
    'ASSESSMENT_NOT_ELIGIBLE',
    e.identityRecovery
      ? identityMessages.IDENTITY_REJECTED
      : 'Complete the required onboarding steps',
  );
  const now = new Date(),
    start = from ? new Date(from) : now,
    end = to ? new Date(to) : new Date(now.getTime() + 90 * 86400000);
  requireCondition(
    end > start && end.getTime() - start.getTime() <= 90 * 86400000,
    422,
    'INVALID_WINDOW',
    'Query an ordered window of at most 90 days',
  );
  const slots = await prisma.assessmentSlot.findMany({
    where: {
      startsAt: { gte: start, lt: end },
      availability: { blueprintId, active: true, blueprint: { active: true } },
    },
    include: {
      availability: true,
      _count: { select: { bookings: { where: { status: 'SCHEDULED' } } } },
    },
    orderBy: { startsAt: 'asc' },
    take: 2000,
  });
  return slots
    .filter(
      (s) =>
        s.startsAt.getTime() >= Date.now() + s.availability.minNoticeMinutes * 60000 &&
        s.startsAt.getTime() <= Date.now() + s.availability.maxHorizonDays * 86400000 &&
        s._count.bookings < s.availability.capacity,
    )
    .map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      timezone: s.availability.timezone,
      remainingCapacity: s.availability.capacity - s._count.bookings,
    }));
}
export async function booking(applicantId: string, id: string, asAdmin = false) {
  const b = await prisma.assessmentBooking.findFirst({
    where: { id, ...(!asAdmin ? { applicantId } : {}) },
    include: bookingInclude,
  });
  requireCondition(b, 404, 'NOT_FOUND', 'Booking not found');
  return b;
}
async function reserve(
  tx: Tx,
  applicantId: string,
  slotId: string,
  key: string,
  rescheduledFromId?: string,
  reason?: string,
) {
  const existing = await tx.assessmentBooking.findUnique({
    where: { applicantId_idempotencyKey: { applicantId, idempotencyKey: key } },
    include: bookingInclude,
  });
  if (existing) {
    requireCondition(
      !existing.onDemand &&
        existing.slotId === slotId &&
        existing.rescheduledFromId === (rescheduledFromId ?? null),
      409,
      'IDEMPOTENCY_CONFLICT',
      'This key was already used for a different booking request',
    );
    return existing;
  }
  let rescheduleCount = 0;
  if (rescheduledFromId) {
    const old = await tx.assessmentBooking.findFirst({
      where: { id: rescheduledFromId, applicantId },
      include: { slot: { include: { availability: true } } },
    });
    requireCondition(
      old?.status === 'SCHEDULED',
      409,
      'BOOKING_NOT_ACTIVE',
      'Only a scheduled booking can be rescheduled',
    );
    requireCondition(
      !old.onDemand,
      409,
      'ON_DEMAND_NOT_RESCHEDULABLE',
      'Cancel an unstarted on-demand reservation before choosing a scheduled time',
    );
    requireCondition(old.slotId !== slotId, 409, 'SAME_SLOT', 'Choose a different slot');
    requireCondition(
      old.slot.startsAt.getTime() - Date.now() >=
        old.slot.availability.cancellationNoticeMinutes * 60000,
      409,
      'CANCELLATION_WINDOW_CLOSED',
      'The change deadline has passed',
    );
    requireCondition(
      old.rescheduleCount < old.slot.availability.rescheduleLimit,
      409,
      'RESCHEDULE_LIMIT',
      'Rescheduling limit reached',
    );
    rescheduleCount = old.rescheduleCount + 1;
    await tx.assessmentBooking.update({
      where: { id: old.id },
      data: {
        status: 'RESCHEDULED',
        events: { create: { actorId: applicantId, action: 'RESCHEDULED', reason } },
      },
    });
  }
  requireCondition(
    !(await tx.assessmentBooking.count({ where: { applicantId, status: 'SCHEDULED' } })),
    409,
    'ACTIVE_BOOKING_EXISTS',
    'An active assessment booking already exists',
  );
  await tx.$queryRaw`SELECT id FROM "AssessmentSlot" WHERE id=${slotId}::uuid FOR UPDATE`;
  const slot = await tx.assessmentSlot.findUnique({
    where: { id: slotId },
    include: {
      availability: { include: { blueprint: { include: { jobRole: true, framework: true } } } },
      bookings: { where: { status: 'SCHEDULED' }, select: { seat: true } },
    },
  });
  requireCondition(slot, 404, 'NOT_FOUND', 'Assessment slot not found');
  const a = slot.availability,
    b = a.blueprint;
  requireCondition(
    a.active && b.active && b.jobRole.active && b.framework.approved,
    409,
    'SLOT_UNAVAILABLE',
    'Assessment slot is not available',
  );
  const now = Date.now();
  requireCondition(
    slot.startsAt.getTime() > now &&
      slot.startsAt.getTime() >= now + a.minNoticeMinutes * 60000 &&
      slot.startsAt.getTime() <= now + a.maxHorizonDays * 86400000,
    409,
    'SLOT_UNAVAILABLE',
    'Slot is outside the booking window',
  );
  const e = await eligibility(applicantId, tx, b.id);
  requireCondition(
    e.eligible,
    409,
    'ASSESSMENT_NOT_ELIGIBLE',
    e.identityRecovery
      ? identityMessages.IDENTITY_REJECTED
      : 'Required onboarding or verification is incomplete',
  );
  const used = new Set(slot.bookings.map((x) => x.seat));
  const seat = Array.from({ length: a.capacity }, (_, i) => i + 1).find((i) => !used.has(i));
  requireCondition(seat, 409, 'SLOT_UNAVAILABLE', 'This assessment slot is full');
  const targetId = await targetForBooking(tx, applicantId, b.id);
  const result = await tx.assessmentBooking.create({
    data: {
      applicantId,
      targetId,
      slotId,
      blueprintId: b.id,
      seat,
      idempotencyKey: key,
      rescheduledFromId,
      rescheduleCount,
      events: { create: { actorId: applicantId, action: 'SCHEDULED', reason } },
    },
    include: bookingInclude,
  });
  const user = await tx.user.findUniqueOrThrow({ where: { id: applicantId } });
  await notify(
    tx,
    user.email,
    rescheduledFromId ? 'Assessment rescheduled' : 'Assessment booking confirmed',
    `Booking ${result.id}\nRole: ${b.jobRole.title}\nBlueprint: ${b.title} v${b.version}\nStart: ${slot.startsAt.toISOString()}\nEnd: ${slot.endsAt.toISOString()}\nDisplay timezone: ${a.timezone}\nDuration: ${b.durationMinutes} minutes\n${b.instructions}\nOpen your assessment booking during its scheduled window to start the session.`,
  );
  await audit(
    tx,
    applicantId,
    rescheduledFromId ? 'assessment.rescheduled' : 'assessment.booked',
    result.id,
    { slotId, rescheduledFromId: rescheduledFromId ?? null },
  );
  return result;
}
export async function createBooking(
  applicantId: string,
  slotId: string,
  key: string,
  rescheduledFromId?: string,
  reason?: string,
) {
  return prisma.$transaction(
    async (tx) => {
      await userLock(tx, applicantId);
      await expireBookingsForUser(tx, applicantId);
      return reserve(tx, applicantId, slotId, key, rescheduledFromId, reason);
    },
    { timeout: 15000 },
  );
}
export async function reserveOnDemand(applicantId: string, blueprintId: string, key: string) {
  return prisma.$transaction(
    async (tx) => {
      await userLock(tx, applicantId);
      await expireBookingsForUser(tx, applicantId);
      const previous = await tx.assessmentBooking.findUnique({
        where: { applicantId_idempotencyKey: { applicantId, idempotencyKey: key } },
        include: bookingInclude,
      });
      if (previous) {
        requireCondition(
          previous.onDemand && previous.blueprintId === blueprintId,
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for another booking request',
        );
        return previous;
      }
      // Serialize admissions and policy changes for this assessment across applicants.
      await tx.$queryRaw`SELECT id FROM "AssessmentBlueprint" WHERE id=${blueprintId}::uuid FOR UPDATE`;
      requireCondition(
        !(await tx.assessmentBooking.count({ where: { applicantId, status: 'SCHEDULED' } })),
        409,
        'ACTIVE_BOOKING_EXISTS',
        'An active assessment booking already exists',
      );
      const e = await eligibility(applicantId, tx, blueprintId);
      const demand = e.blueprints.find((b) => b.blueprintId === blueprintId)?.onDemand;
      requireCondition(
        demand?.available,
        409,
        demand?.reasons.includes('ON_DEMAND_FULL') ? 'ON_DEMAND_FULL' : 'ON_DEMAND_UNAVAILABLE',
        demand?.reasons.includes('ON_DEMAND_FULL')
          ? 'All immediate assessment places are in use. Refresh later or choose a scheduled time.'
          : 'Immediate assessment is unavailable. Refresh readiness or choose a scheduled time.',
      );
      const targetId = await targetForBooking(tx, applicantId, blueprintId);
      const now = new Date(),
        endsAt = new Date(now.getTime() + (demand.durationMinutes + onDemandSetupMinutes) * 60000);
      // Private one-booking windows never appear in published scheduled availability.
      const availability = await tx.assessmentAvailability.create({
        data: {
          blueprintId,
          startsAt: now,
          endsAt,
          capacity: 1,
          active: false,
          onDemand: true,
          minNoticeMinutes: 0,
          cancellationNoticeMinutes: 0,
          rescheduleLimit: 0,
          slots: { create: { startsAt: now, endsAt } },
        },
        include: { slots: true },
      });
      const result = await tx.assessmentBooking.create({
        data: {
          applicantId,
          targetId,
          blueprintId,
          slotId: availability.slots[0]!.id,
          seat: 1,
          onDemand: true,
          idempotencyKey: key,
          createdAt: now,
          events: {
            create: {
              actorId: applicantId,
              action: 'ON_DEMAND_RESERVED',
              reason:
                'Complete device checks and consent within five minutes. The full assessment duration begins at start.',
            },
          },
        },
        include: bookingInclude,
      });
      await audit(tx, applicantId, 'assessment.on_demand_reserved', result.id, {
        blueprintId,
        setupExpiresAt: setupExpiresAt(result).toISOString(),
      });
      return result;
    },
    { timeout: 15000 },
  );
}
export async function updateDelivery(
  actorId: string,
  id: string,
  input: z.infer<typeof deliverySchema>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AssessmentBlueprint" WHERE id=${id}::uuid FOR UPDATE`;
    requireCondition(
      await tx.assessmentBlueprint.findUnique({ where: { id } }),
      404,
      'NOT_FOUND',
      'Assessment blueprint not found',
    );
    requireCondition(
      input.onDemandCapacity >= (await onDemandOccupancy(id, tx)),
      409,
      'CAPACITY_IN_USE',
      'Wait for immediate assessments to finish before reducing capacity',
    );
    const result = await tx.assessmentBlueprint.update({ where: { id }, data: input });
    await audit(tx, actorId, 'assessment.delivery_updated', id, input);
    return result;
  });
}
export async function cancelBooking(actorId: string, id: string, reason: string, asAdmin = false) {
  const target = await booking(actorId, id, asAdmin);
  return prisma.$transaction(async (tx) => {
    await userLock(tx, target.applicantId);
    const b = await tx.assessmentBooking.findUniqueOrThrow({
      where: { id },
      include: {
        target: true,
        slot: { include: { availability: true } },
        applicant: { select: { email: true } },
      },
    });
    requireCondition(
      b.status === 'SCHEDULED',
      409,
      'BOOKING_NOT_ACTIVE',
      'Only a scheduled booking can be cancelled',
    );
    requireCondition(
      b.target?.status !== 'IN_PROGRESS',
      409,
      'ASSESSMENT_IN_PROGRESS',
      'A started assessment must be completed',
    );
    if (!asAdmin && !b.onDemand)
      requireCondition(
        b.slot.startsAt.getTime() - Date.now() >=
          b.slot.availability.cancellationNoticeMinutes * 60000,
        409,
        'CANCELLATION_WINDOW_CLOSED',
        'Cancellation deadline has passed',
      );
    await tx.assessmentBooking.update({
      where: { id },
      data: { status: 'CANCELLED', events: { create: { actorId, action: 'CANCELLED', reason } } },
    });
    await audit(tx, actorId, 'assessment.cancelled', id, { reason });
    await notify(
      tx,
      b.applicant.email,
      'Assessment booking cancelled',
      `Booking ${id} was cancelled. ${reason}`,
    );
    return { id, status: 'CANCELLED' };
  });
}
export function confirmation(b: Awaited<ReturnType<typeof booking>>) {
  return {
    bookingId: b.id,
    slotId: b.slotId,
    onDemand: b.onDemand,
    setupExpiresAt:
      b.onDemand && !b.target?.attempt?.startedAt ? setupExpiresAt(b).toISOString() : null,
    changePolicy: {
      deadline: new Date(
        b.slot.startsAt.getTime() - b.slot.availability.cancellationNoticeMinutes * 60000,
      ).toISOString(),
      reschedulesRemaining: Math.max(0, b.slot.availability.rescheduleLimit - b.rescheduleCount),
    },
    targetId: b.targetId,
    attemptId: b.target?.attempt?.id ?? null,
    applicantId: b.applicantId,
    jobRole: b.blueprint.jobRole,
    blueprint: { id: b.blueprint.id, title: b.blueprint.title, version: b.blueprint.version },
    startsAt: b.slot.startsAt,
    endsAt: b.slot.endsAt,
    timezone: b.slot.availability.timezone,
    status: b.status,
    durationMinutes: b.blueprint.durationMinutes,
    instructions: b.blueprint.instructions,
    rescheduledFromId: b.rescheduledFromId,
    rescheduleCount: b.rescheduleCount,
    events: b.events,
  };
}
export async function updateAvailability(
  actorId: string,
  id: string,
  input: { active?: boolean; capacity?: number },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "AssessmentAvailability" WHERE id=${id}::uuid FOR UPDATE`;
    const slots = await tx.assessmentSlot.findMany({
      where: { availabilityId: id },
      orderBy: { id: 'asc' },
    });
    const availability = await tx.assessmentAvailability.findUnique({ where: { id } });
    requireCondition(
      availability && !availability.onDemand,
      409,
      'PRIVATE_AVAILABILITY',
      'On-demand reservations are managed through their bookings',
    );
    for (const slot of slots)
      await tx.$queryRaw`SELECT id FROM "AssessmentSlot" WHERE id=${slot.id}::uuid FOR UPDATE`;
    if (input.capacity) {
      const max = await tx.assessmentBooking.aggregate({
        where: { slotId: { in: slots.map((s) => s.id) }, status: 'SCHEDULED' },
        _max: { seat: true },
      });
      requireCondition(
        (max._max.seat ?? 0) <= input.capacity,
        409,
        'CAPACITY_IN_USE',
        'Cancel affected bookings before reducing capacity',
      );
    }
    const a = await tx.assessmentAvailability.update({ where: { id }, data: input });
    await audit(tx, actorId, 'assessment.availability_updated', id, input);
    return a;
  });
}
