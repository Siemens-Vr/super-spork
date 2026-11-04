import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { redis } from './config/redis.js';
import { sessionMiddleware } from './config/session.js';
import { csrf } from './middleware/security.js';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './errors/app-error.js';
import { authRouter } from './routes/auth.routes.js';
import { applicantRouter } from './routes/applicant.routes.js';
import { documentRouter, identityRouter } from './routes/document.routes.js';
import { catalogueRouter } from './routes/catalogue.routes.js';
import { assessmentRouter } from './routes/assessment.routes.js';
import { adminRouter } from './routes/admin.routes.js';
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use((req, res, next) => {
    req.correlationId = randomUUID();
    res.set('X-Request-Id', req.correlationId);
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).correlationId,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',').map((v) => v.trim());
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(
          origin && !origins.includes(origin)
            ? new AppError(403, 'ORIGIN_REJECTED', 'Origin not allowed')
            : null,
          true,
        ),
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.get('/health/live', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.get('/health/ready', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      res.json({ data: { status: 'ready' } });
    } catch {
      res.status(503).json({
        error: {
          code: 'NOT_READY',
          message: 'Required infrastructure is unavailable',
          requestId: req.correlationId,
        },
      });
    }
  });
  if (env.ENABLE_SWAGGER) {
    const spec = YAML.parse(readFileSync(resolve('docs/openapi.yaml'), 'utf8'));
    app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(spec, {
        swaggerOptions: {
          persistAuthorization: false,
          requestInterceptor: async (request: {
            method: string;
            headers: Record<string, string>;
          }) => {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
              const response = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
              const body = (await response.json()) as { data: { csrfToken: string } };
              request.headers['X-CSRF-Token'] = body.data.csrfToken;
            }
            return request;
          },
        },
        customSiteTitle: 'VML NEXUS API',
      }),
    );
  }
  app.use(sessionMiddleware());
  app.use(
    '/api/v1',
    (_req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    },
    csrf,
  );
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/applicants', applicantRouter);
  app.use('/api/v1/identity', identityRouter);
  app.use('/api/v1/documents', documentRouter);
  app.use('/api/v1/assessments', assessmentRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1', catalogueRouter);
  app.use(() => {
    throw new AppError(404, 'NOT_FOUND', 'Endpoint not found');
  });
  app.use(errorHandler);
  return app;
}
