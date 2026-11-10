import { expireAssessmentBookings } from '../services/assessment-lifecycle.service.js';
import { Worker } from 'bullmq';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { queueConnection, emailQueue, documentQueue } from './queues.js';
import { deliverEmail } from './email.worker.js';
import { scanDocument } from './document.worker.js';
const workers = [
  new Worker('nexus-email', (job) => deliverEmail(String(job.data.id)), {
    connection: queueConnection(),
    concurrency: 4,
  }),
  new Worker('nexus-document-scan', (job) => scanDocument(String(job.data.id)), {
    connection: queueConnection(),
    concurrency: 2,
  }),
];
for (const worker of workers) {
  worker.on('failed', (job) => {
    logger.warn(
      { jobId: job?.id, queue: worker.name },
      'Background job failed; will retry according to queue policy',
    );
  });
  worker.on('error', () => logger.error('Worker connection failed'));
}
let dispatching = false;
let emailCursor: string | undefined;
let documentCursor: string | undefined;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    await expireAssessmentBookings();
    const [emails, documents] = await Promise.all([
      prisma.notificationOutbox.findMany({
        where: { status: 'PENDING', ...(emailCursor ? { id: { gt: emailCursor } } : {}) },
        take: 100,
        orderBy: { id: 'asc' },
      }),
      prisma.document.findMany({
        where: {
          OR: [{ scanStatus: { in: ['QUARANTINED', 'FAILED'] } }, { cleanupPending: true }],
          ...(documentCursor ? { id: { gt: documentCursor } } : {}),
        },
        take: 100,
        orderBy: { id: 'asc' },
      }),
    ]);
    emailCursor = emails.at(-1)?.id;
    documentCursor = documents.at(-1)?.id;
    for (const item of emails) await emailQueue.add('deliver', { id: item.id }, { jobId: item.id });
    for (const item of documents)
      await documentQueue.add('scan', { id: item.id }, { jobId: item.id });
    await prisma.session.deleteMany({
      where: { absoluteExpiresAt: { lt: new Date(Date.now() - 3600000) } },
    });
    await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    logger.error('Outbox dispatch failed; pending records are preserved');
  } finally {
    dispatching = false;
  }
}
const interval = setInterval(() => void dispatch(), 5000);
await dispatch();
async function stop() {
  clearInterval(interval);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([emailQueue.close(), documentQueue.close()]);
  await prisma.$disconnect();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
