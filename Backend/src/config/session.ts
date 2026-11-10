import session, { type SessionData } from 'express-session';
import { prisma } from './prisma.js';
import { env } from './env.js';
import { AppError } from '../errors/app-error.js';
export const cookieName = env.NODE_ENV === 'production' ? '__Host-nexus.sid' : 'nexus.sid';
export class PrismaSessionStore extends session.Store {
  get(sid: string, cb: (err: unknown, data?: SessionData | null) => void) {
    prisma.session
      .findUnique({ where: { sid } })
      .then((row) => {
        if (
          !row ||
          row.revokedAt ||
          row.expiresAt <= new Date() ||
          row.absoluteExpiresAt <= new Date()
        )
          return cb(null, null);
        const data = row.data as unknown as SessionData;
        data.absoluteExpiresAt = row.absoluteExpiresAt.getTime();
        cb(null, data);
      })
      .catch(cb);
  }
  set(sid: string, data: SessionData, cb?: (err?: unknown) => void) {
    const now = Date.now();
    data.absoluteExpiresAt ??= Math.min(
      new Date(data.cookie.expires ?? now + env.SESSION_TTL_HOURS * 3600000).getTime(),
      now + env.SESSION_TTL_HOURS * 3600000,
    );
    if (data.absoluteExpiresAt <= now) {
      cb?.(new AppError(401, 'SESSION_INVALID', 'Session has expired'));
      return;
    }
    const absolute = new Date(data.absoluteExpiresAt);
    const expires = new Date(
      Math.min(new Date(data.cookie.expires ?? absolute).getTime(), absolute.getTime()),
    );
    const json = JSON.stringify(data);
    // The conflict predicate is atomic with revocation: a late writer cannot recreate a revoked SID.
    prisma.$executeRaw`INSERT INTO "Session" (sid,"userId",data,"expiresAt","absoluteExpiresAt","createdAt")
      VALUES (${sid},${data.userId ?? null}::uuid,${json}::jsonb,${expires},${absolute},CURRENT_TIMESTAMP)
      ON CONFLICT (sid) DO UPDATE SET "userId"=EXCLUDED."userId",data=EXCLUDED.data,"expiresAt"=LEAST(EXCLUDED."expiresAt","Session"."absoluteExpiresAt")
      WHERE "Session"."revokedAt" IS NULL AND "Session"."absoluteExpiresAt">CURRENT_TIMESTAMP AND "Session"."expiresAt">CURRENT_TIMESTAMP`
      .then((count) =>
        cb?.(
          count
            ? undefined
            : new AppError(401, 'SESSION_INVALID', 'Session has expired or was revoked'),
        ),
      )
      .catch((error) => cb?.(error));
  }
  destroy(sid: string, cb?: (err?: unknown) => void) {
    const now = new Date();
    const expiry = new Date(Date.now() + 168 * 3600000);
    prisma.session
      .upsert({
        where: { sid },
        create: { sid, data: {}, revokedAt: now, expiresAt: expiry, absoluteExpiresAt: expiry },
        update: { revokedAt: now, data: {} },
      })
      .then(() => cb?.())
      .catch((error) => cb?.(error));
  }
  touch(sid: string, _data: SessionData, cb?: (err?: unknown) => void) {
    // There is no sliding idle lifetime: the immutable deadline is enforced by get/set.
    void sid;
    cb?.();
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
