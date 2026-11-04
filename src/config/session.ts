import session, { type SessionData } from 'express-session';
import { prisma } from './prisma.js';
import { env } from './env.js';
import type { Prisma } from '../generated/prisma/client.js';
export const cookieName = env.NODE_ENV === 'production' ? '__Host-nexus.sid' : 'nexus.sid';
export class PrismaSessionStore extends session.Store {
  get(sid: string, cb: (err: unknown, data?: SessionData | null) => void) {
    prisma.session
      .findUnique({ where: { sid } })
      .then((r) =>
        cb(null, r && r.expiresAt > new Date() ? (r.data as unknown as SessionData) : null),
      )
      .catch(cb);
  }
  set(sid: string, data: SessionData, cb?: (err?: unknown) => void) {
    const expiresAt = new Date(data.cookie.expires ?? Date.now() + env.SESSION_TTL_HOURS * 3600000);
    const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
    prisma.session
      .upsert({
        where: { sid },
        create: { sid, userId: data.userId, data: json, expiresAt },
        update: { userId: data.userId ?? null, data: json, expiresAt },
      })
      .then(() => cb?.())
      .catch((e) => cb?.(e));
  }
  destroy(sid: string, cb?: (err?: unknown) => void) {
    prisma.session
      .deleteMany({ where: { sid } })
      .then(() => cb?.())
      .catch((e) => cb?.(e));
  }
  touch(sid: string, data: SessionData, cb?: (err?: unknown) => void) {
    prisma.session
      .updateMany({
        where: { sid },
        data: {
          expiresAt: new Date(data.cookie.expires ?? Date.now() + env.SESSION_TTL_HOURS * 3600000),
        },
      })
      .then(() => cb?.())
      .catch((e) => cb?.(e));
  }
}
export function sessionMiddleware() {
  return session({
    name: cookieName,
    secret: env.SESSION_SECRET,
    store: new PrismaSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: env.SESSION_TTL_HOURS * 3600000,
      path: '/',
    },
  });
}
