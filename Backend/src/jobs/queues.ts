import { Queue } from 'bullmq';
import { env } from '../config/env.js';
export function queueConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
export const emailQueue = new Queue('nexus-email', {
  connection: queueConnection(),
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
export const documentQueue = new Queue('nexus-document-scan', {
  connection: queueConnection(),
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});
