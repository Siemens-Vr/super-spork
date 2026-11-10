import { createHash } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { storage } from '../config/storage.js';
import { scanFile } from '../integrations/storage/clamav.js';
import { audit } from '../utils/audit.js';
export async function scanDocument(id: string) {
  const d = await prisma.document.findUnique({ where: { id } });
  if (!d) return;
  if (d.scanStatus === 'INFECTED') {
    if (d.cleanupPending) {
      await storage.remove(d.storageKey);
      await prisma.document.update({
        where: { id },
        data: { cleanupPending: false, storageDeletedAt: new Date() },
      });
    }
    return;
  }
  if (!['QUARANTINED', 'FAILED'].includes(d.scanStatus)) return;
  try {
    const buffer = await storage.get(d.storageKey);
    if (createHash('sha256').update(buffer).digest('hex') !== d.sha256)
      throw new Error('Integrity mismatch');
    const result = await scanFile(buffer);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
      const current = await tx.document.findUniqueOrThrow({ where: { id } });
      if (!['QUARANTINED', 'FAILED'].includes(current.scanStatus)) return;
      await tx.document.update({
        where: { id },
        data: {
          scanStatus: result,
          cleanupPending: result === 'INFECTED',
          ...(result === 'CLEAN' ? { status: 'UNDER_REVIEW' } : {}),
        },
      });
      if (result === 'CLEAN')
        await tx.verificationStatusHistory.create({
          data: {
            documentId: id,
            fromStatus: current.status,
            toStatus: 'UNDER_REVIEW',
            actorId: d.applicantId,
            reason: 'Malware scan passed; awaiting human review',
          },
        });
      await audit(tx, null, 'document.scanned', id, { scanStatus: result });
    });
    if (result === 'INFECTED') {
      await storage.remove(d.storageKey);
      await prisma.document.update({
        where: { id },
        data: { cleanupPending: false, storageDeletedAt: new Date() },
      });
    }
  } catch (e) {
    await prisma.document.updateMany({
      where: { id, scanStatus: { in: ['QUARANTINED', 'FAILED'] } },
      data: { scanStatus: 'FAILED' },
    });
    throw e;
  }
}
