import { prisma, userLock, type Tx } from '../config/prisma.js';
import { audit } from '../utils/audit.js';
import { requireCondition } from '../errors/app-error.js';

// Call under the applicant row lock, shared with booking, start, and completion.
export async function expireBookingsForUser(tx: Tx, applicantId: string, now = new Date()) {
  const bookings = await tx.assessmentBooking.findMany({
    where: { applicantId, status: 'SCHEDULED', slot: { endsAt: { lte: now } } },
    include: { target: { include: { attempt: { include: { interaction: true } } } } },
  });
  for (const booking of bookings) {
    const target = booking.target;
    const interaction = target?.attempt?.interaction;
    // Submitted evidence awaiting a human decision must not be abandoned by a timer.
    if (
      target?.status === 'COMPLETED' ||
      interaction?.status === 'AWAITING_REVIEW' ||
      interaction?.status === 'COMPLETED'
    )
      continue;
    const started = target?.status === 'IN_PROGRESS';
    await tx.assessmentBooking.update({
      where: { id: booking.id },
      data: {
        status: started ? 'EXPIRED' : 'MISSED',
        events: {
          create: {
            actorId: applicantId,
            action: started ? 'EXPIRED' : 'MISSED',
            reason: 'Scheduled assessment window ended',
          },
        },
      },
    });
    if (started && target) {
      await tx.assessmentTarget.update({ where: { id: target.id }, data: { status: 'ABANDONED' } });
      if (interaction)
        await tx.assessmentInteractionSession.update({
          where: { id: interaction.id },
          data: { status: 'EXPIRED', leaseToken: null, leaseExpiresAt: null },
        });
    }
    await audit(tx, applicantId, 'assessment.window_expired', booking.id, { started });
  }
}
export async function reconcileApplicantBookings(applicantId: string) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, applicantId);
    await expireBookingsForUser(tx, applicantId);
  });
}
export async function expireAssessmentBookings() {
  const rows = await prisma.assessmentBooking.findMany({
    where: {
      status: 'SCHEDULED',
      slot: { endsAt: { lte: new Date() } },
      target: { attempt: { interaction: { is: null } } },
    },
    take: 100,
    select: { applicantId: true },
    distinct: ['applicantId'],
  });
  const started = await prisma.assessmentBooking.findMany({
    where: {
      status: 'SCHEDULED',
      slot: { endsAt: { lte: new Date() } },
      target: { attempt: { interaction: { status: { in: ['ACTIVE', 'INTERRUPTED'] } } } },
    },
    take: 100,
    select: { applicantId: true },
    distinct: ['applicantId'],
  });
  for (const id of new Set([...rows, ...started].map((row) => row.applicantId)))
    await reconcileApplicantBookings(id);
}
export async function abandonTarget(
  actorId: string,
  targetId: string,
  reason: string,
  asAdmin = false,
) {
  const target = await prisma.assessmentTarget.findFirst({
    where: { id: targetId, ...(!asAdmin ? { applicantId: actorId } : {}) },
  });
  requireCondition(target, 404, 'NOT_FOUND', 'Assessment target not found');
  return prisma.$transaction(async (tx) => {
    await userLock(tx, target.applicantId);
    await expireBookingsForUser(tx, target.applicantId);
    const current = await tx.assessmentTarget.findUniqueOrThrow({
      where: { id: targetId },
      include: {
        attempt: { include: { interaction: true } },
        bookings: {
          where: { status: 'SCHEDULED' },
          include: { slot: { include: { availability: true } } },
        },
      },
    });
    requireCondition(
      current.status !== 'COMPLETED',
      409,
      'RESULTS_IMMUTABLE',
      'Completed assessments cannot be abandoned',
    );
    requireCondition(
      asAdmin ||
        (current.status !== 'IN_PROGRESS' &&
          current.attempt?.interaction?.status !== 'AWAITING_REVIEW'),
      409,
      'ADMIN_RECOVERY_REQUIRED',
      'Ask an administrator to recover a started assessment',
    );
    if (current.status === 'ABANDONED') return { id: targetId, status: current.status };
    if (!asAdmin)
      for (const booking of current.bookings)
        requireCondition(
          booking.slot.startsAt.getTime() - Date.now() >=
            booking.slot.availability.cancellationNoticeMinutes * 60000,
          409,
          'CANCELLATION_WINDOW_CLOSED',
          'The cancellation deadline has passed; ask an administrator for recovery',
        );
    await tx.assessmentTarget.update({ where: { id: targetId }, data: { status: 'ABANDONED' } });
    if (current.attempt?.interaction)
      await tx.assessmentInteractionSession.update({
        where: { id: current.attempt.interaction.id },
        data: { status: 'ABANDONED', leaseToken: null, leaseExpiresAt: null },
      });
    for (const booking of current.bookings)
      await tx.assessmentBooking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', events: { create: { actorId, action: 'ABANDONED', reason } } },
      });
    await audit(tx, actorId, 'assessment.target_abandoned', targetId, {
      reason,
      administrator: asAdmin,
    });
    return { id: targetId, status: 'ABANDONED' as const };
  });
}
