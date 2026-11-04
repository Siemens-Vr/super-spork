import { Redis } from 'ioredis';
import { env } from './env.js';
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});
