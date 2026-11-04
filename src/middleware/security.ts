import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { randomToken, safeEqual, verifier } from '../utils/crypto.js';
import { AppError } from '../errors/app-error.js';
export const csrf: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim());
  if (origin && !allowed.includes(origin))
    throw new AppError(403, 'ORIGIN_REJECTED', 'Origin not allowed');
  const token = req.get('x-csrf-token');
  if (!token || !req.session.csrf || !safeEqual(token, req.session.csrf))
    throw new AppError(403, 'CSRF_INVALID', 'Obtain a CSRF token and send it with this request');
  next();
};
export const csrfToken: RequestHandler = (req, res) => {
  req.session.csrf ??= randomToken();
  res.json({ data: { csrfToken: req.session.csrf } });
};
// PostgreSQL atomic fixed windows work across API replicas and fail closed.
export function rateLimit(
  scope: string,
  limit: number,
  seconds: number,
  account = false,
): RequestHandler {
  return async (req, res, next) => {
    const window = Math.floor(Date.now() / (seconds * 1000));
    const signal =
      account && typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : account
          ? (req.session.userId ?? req.ip)
          : req.ip;
    const key = verifier(`${scope}:${signal}:${window}`);
    const rows = await prisma.$queryRaw<
      { count: number }[]
    >`INSERT INTO "RateLimitBucket" (key,count,"expiresAt") VALUES (${key},1,${new Date((window + 1) * seconds * 1000)}) ON CONFLICT (key) DO UPDATE SET count="RateLimitBucket".count+1 RETURNING count`;
    if ((rows[0]?.count ?? limit + 1) > limit) {
      res.set('Retry-After', String(seconds));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests; try again later');
    }
    next();
  };
}
