import { prisma, type Tx } from '../config/prisma.js';
import { env } from '../config/env.js';
export const onDemandSetupMinutes = 5;
export function setupExpiresAt(booking: { createdAt: Date }) {
  return new Date(booking.createdAt.getTime() + onDemandSetupMinutes * 60000);
}
// Reservations, active interviews and accepted answers still processing occupy capacity.
// Human review does not occupy an interview seat. No cross-applicant writes are needed.
export async function onDemandOccupancy(blueprintId: string, tx: Tx = prisma, now = new Date()) {
  const rows = await tx.assessmentBooking.findMany({
    where: {
      blueprintId,
      onDemand: true,
      status: 'SCHEDULED',
      OR: [
        { interaction: { is: null } },
        { interaction: { status: { in: ['ACTIVE', 'INTERRUPTED'] } } },
      ],
    },
    include: {
      slot: true,
      target: { select: { attempt: { select: { startedAt: true } } } },
      interaction: { select: { pendingResponseId: true } },
    },
  });
  return rows.filter((b) =>
    b.target?.attempt?.startedAt
      ? b.slot.endsAt > now ||
        (!!b.interaction?.pendingResponseId &&
          now.getTime() < b.slot.endsAt.getTime() + env.AI_TIMEOUT_MS + 30000)
      : setupExpiresAt(b) > now,
  ).length;
}
