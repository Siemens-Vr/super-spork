import { emailQueue, documentQueue } from '../src/jobs/queues.js';
try {
  for (const queue of [emailQueue, documentQueue]) {
    const counts = await queue.getJobCounts('failed', 'waiting', 'active');
    console.log(`${queue.name}: ${JSON.stringify(counts)}`);
    await queue.retryJobs({ count: 100, state: 'failed' });
  }
} finally {
  await Promise.all([emailQueue.close(), documentQueue.close()]);
}
