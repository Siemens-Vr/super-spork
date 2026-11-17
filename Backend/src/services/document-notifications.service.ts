import { prisma } from '../config/prisma.js';

export async function reviewNotifications(applicantId: string) {
  const where = { document: { applicantId } };
  const [items, unreadCount] = await Promise.all([
    prisma.documentVerification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: {
        id: true,
        documentId: true,
        outcome: true,
        reason: true,
        createdAt: true,
        applicantReadAt: true,
        document: { select: { title: true } },
      },
    }),
    prisma.documentVerification.count({ where: { ...where, applicantReadAt: null } }),
  ]);
  return { items, unreadCount };
}

export async function readReviewNotifications(applicantId: string, ids: string[]) {
  await prisma.documentVerification.updateMany({
    where: { id: { in: ids }, document: { applicantId }, applicantReadAt: null },
    data: { applicantReadAt: new Date() },
  });
}
