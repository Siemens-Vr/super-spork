import { env } from '../config/env.js';
// A confirmed answer accepted on time may finish processing after the slot ends.
// This is bounded and never permits submitting another answer after the deadline.
export function mayFinishAcceptedAnswer(
  booking: { status: string; slot: { endsAt: Date } },
  response: { createdAt: Date } | null,
  now = new Date(),
) {
  return (
    booking.status === 'SCHEDULED' &&
    !!response &&
    response.createdAt < booking.slot.endsAt &&
    now.getTime() < booking.slot.endsAt.getTime() + env.AI_TIMEOUT_MS + 30000
  );
}
