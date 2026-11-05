import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { logger } from './config/logger.js';
await prisma.$connect();
await redis.connect();
const server = createApp().listen(env.PORT, () =>
  logger.info({ port: env.PORT }, 'VML NEXUS API listening'),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  server.close(() => {
    void Promise.all([prisma.$disconnect(), redis.quit()]).then(() => {
      clearTimeout(deadline);
      process.exitCode = 0;
    });
  });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
