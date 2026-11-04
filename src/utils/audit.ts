import type { Prisma } from '../generated/prisma/client.js';
import type { Tx } from '../config/prisma.js';
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  resourceId?: string,
  details?: Prisma.InputJsonObject,
) {
  await tx.auditLog.create({ data: { actorId, action, resourceId, details } });
}
