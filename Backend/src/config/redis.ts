import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', (error: NodeJS.ErrnoException) => {
  const endpoint = new URL(env.REDIS_URL);
  logger.error(
    { host: endpoint.hostname, port: Number(endpoint.port || 6379), errorCode: error.code },
    'Redis connection failed. Check REDIS_URL and ensure Redis is running (locally: docker compose up -d redis).',
  );
});
