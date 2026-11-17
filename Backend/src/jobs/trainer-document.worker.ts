import { createHash } from 'node:crypto';
import { prisma, userLock } from '../config/prisma.js';
import { storage } from '../config/storage.js';
import { scanFile } from '../integrations/storage/clamav.js';
import { audit } from '../utils/audit.js';
export async function scanTrainerQualification(id: string) {
  const q = await prisma.trainerQualification.findUnique({
    where: { id },
    include: { trainerProfile: { select: { userId: true } } },
  });
  if (!q) return;
  if (q.cleanupPending) {
    await storage.remove(q.storageKey);
    await prisma.trainerQualification.update({
      where: { id },
      data: { cleanupPending: false, storageDeletedAt: new Date() },
    });
    return;
  }
  if (!['QUARANTINED', 'FAILED'].includes(q.scanStatus)) return;
  try {
    const buffer = await storage.get(q.storageKey);
    if (createHash('sha256').update(buffer).digest('hex') !== q.sha256)
      throw new Error('Qualification integrity mismatch');
    const scanStatus = await scanFile(buffer);
    await prisma.$transaction(async (tx) => {
      await userLock(tx, q.trainerProfile.userId);
      const current = await tx.trainerQualification.findUniqueOrThrow({ where: { id } });
      if (!['QUARANTINED', 'FAILED'].includes(current.scanStatus)) return;
      await tx.trainerQualification.update({
        where: { id },
        data: { scanStatus, cleanupPending: scanStatus === 'INFECTED' },
      });
      await tx.trainerProfile.update({
        where: { id: q.trainerProfileId },
        data: { version: { increment: 1 } },
      });
      await audit(tx, null, 'trainer.qualification_scanned', id, { scanStatus });
    });
    if (scanStatus === 'INFECTED') {
      await storage.remove(q.storageKey);
      await prisma.trainerQualification.update({
        where: { id },
        data: { cleanupPending: false, storageDeletedAt: new Date() },
      });
    }
  } catch (error) {
    await prisma.trainerQualification.updateMany({
      where: { id, scanStatus: { in: ['QUARANTINED', 'FAILED'] } },
      data: { scanStatus: 'FAILED' },
    });
    throw error;
  }
}
