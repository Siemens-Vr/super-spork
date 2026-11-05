import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';
try {
  const cutoff = new Date(Date.now() - env.DOCUMENT_RETENTION_DAYS * 86400000);
  const [
    agedDocuments,
    replacedDocuments,
    closedAccountDocuments,
    expiredChallenges,
    expiredSessions,
    pendingEmails,
  ] = await Promise.all([
    prisma.document.count({ where: { createdAt: { lt: cutoff } } }),
    prisma.document.count({ where: { createdAt: { lt: cutoff }, replacement: { isNot: null } } }),
    prisma.document.count({
      where: { createdAt: { lt: cutoff }, applicant: { status: 'CLOSED' } },
    }),
    prisma.authChallenge.count({ where: { expiresAt: { lt: new Date() } } }),
    prisma.session.count({ where: { expiresAt: { lt: new Date() } } }),
    prisma.notificationOutbox.count({
      where: { status: 'PENDING', createdAt: { lt: new Date(Date.now() - 3600000) } },
    }),
  ]);
  console.log(
    JSON.stringify(
      {
        mode: 'REPORT_ONLY',
        retentionDays: env.DOCUMENT_RETENTION_DAYS,
        cutoff,
        agedDocuments,
        replacedDocuments,
        closedAccountDocuments,
        expiredChallenges,
        expiredSessions,
        pendingEmailsOlderThanOneHour: pendingEmails,
        note: 'No records were deleted. Apply institutional legal holds and approved retention policy before deleting sensitive data.',
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
