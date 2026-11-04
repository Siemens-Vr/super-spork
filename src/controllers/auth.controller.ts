import type { RequestHandler } from 'express';
import * as service from '../services/auth.service.js';
import { prisma, userLock } from '../config/prisma.js';
import { env } from '../config/env.js';
import { cookieName } from '../config/session.js';
import { googleProvider } from '../integrations/google/client.js';
import { AppError, requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { email as emailValidator } from '../validators/auth.schema.js';
export const register: RequestHandler = async (req, res) => {
  await service.register(req.body);
  res.status(202).json({ data: { message: service.genericMessage } });
};
export const login: RequestHandler = async (req, res) => {
  const u = await service.credentials(req.body.email, req.body.password);
  await service.rotateSession(req, u);
  res.json({
    data: {
      csrfToken: req.session.csrf,
      mfaRequired: !!(await prisma.userRole.findFirst({
        where: { userId: u.id, role: { name: 'ADMIN' } },
      })),
    },
  });
};
export const verifyEmail: RequestHandler = async (req, res) => {
  await service.verifyEmail(req.body.email, req.body.code);
  res.json({ data: { emailVerified: true } });
};
export function requestCode(purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'): RequestHandler {
  return async (req, res) => {
    await service.requestCode(req.body.email, purpose);
    res.status(202).json({ data: { message: service.genericMessage } });
  };
}
export const resetPassword: RequestHandler = async (req, res) => {
  await service.resetPassword(req.body);
  res.json({ data: { message: 'Password updated; sign in again' } });
};
export const logout: RequestHandler = async (req, res) => {
  await new Promise<void>((resolve, reject) =>
    req.session.destroy((e) => (e ? reject(e) : resolve())),
  );
  res
    .clearCookie(cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
    })
    .status(204)
    .end();
};
export const logoutAll: RequestHandler = async (req, res) => {
  await service.revokeAll(req.principal!.id);
  await logout(req, res, () => {});
};
export const me: RequestHandler = (req, res) => {
  res.json({ data: req.principal });
};
export const sessions: RequestHandler = async (req, res) => {
  const rows = await prisma.session.findMany({
    where: { userId: req.principal!.id, expiresAt: { gt: new Date() } },
    select: { sid: true, createdAt: true, expiresAt: true },
  });
  res.json({
    data: rows.map((s) => ({
      id: s.sid,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.sid === req.sessionID,
    })),
  });
};
export const revokeSession: RequestHandler = async (req, res) => {
  const id = String(req.params.id);
  await prisma.session.deleteMany({ where: { sid: id, userId: req.principal!.id } });
  res.status(204).end();
};
export const reauthenticate: RequestHandler = async (req, res) => {
  const u = await service.credentials(req.principal!.email, req.body.password);
  await service.rotateSession(req, u, req.session.mfaAt);
  res.json({ data: { csrfToken: req.session.csrf } });
};
export const setupMfa: RequestHandler = async (req, res) => {
  requireCondition(
    req.session.authenticatedAt && Date.now() - req.session.authenticatedAt < 300000,
    403,
    'REAUTHENTICATION_REQUIRED',
    'Sign in again to configure MFA',
  );
  res.json({ data: await service.mfaSetup(req.principal!.id) });
};
export const verifyMfa: RequestHandler = async (req, res) => {
  await service.verifyMfa(req.principal!.id, req.body.code);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.principal!.id } });
  await service.rotateSession(req, u, Date.now());
  res.json({ data: { csrfToken: req.session.csrf, mfaVerified: true } });
};
export function googleStart(link = false): RequestHandler {
  return async (req, res) => {
    if (link)
      requireCondition(
        req.session.authenticatedAt && Date.now() - req.session.authenticatedAt < 300000,
        403,
        'REAUTHENTICATION_REQUIRED',
        'Reauthenticate before linking Google',
      );
    const start = await googleProvider.start();
    req.session.oauth = {
      state: start.state,
      nonce: start.nonce,
      verifier: start.verifier,
      createdAt: Date.now(),
      ...(link ? { linkUserId: req.principal!.id } : {}),
    };
    await new Promise<void>((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    res.redirect(start.url);
  };
}
export const googleCallback: RequestHandler = async (req, res) => {
  const flow = req.session.oauth;
  delete req.session.oauth;
  await new Promise<void>((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
  requireCondition(
    flow && Date.now() - flow.createdAt < 600000,
    400,
    'GOOGLE_FLOW_INVALID',
    'Restart Google sign in',
  );
  let claims;
  try {
    claims = await googleProvider.finish(new URL(req.originalUrl, env.APP_URL), flow);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(401, 'GOOGLE_FLOW_INVALID', 'Google authentication could not be validated');
  }
  emailValidator.parse(claims.email);
  if (flow.linkUserId) {
    requireCondition(
      req.session.userId === flow.linkUserId,
      401,
      'SESSION_INVALID',
      'Account linking session changed',
    );
    await prisma.$transaction(async (tx) => {
      await userLock(tx, flow.linkUserId!);
      const user = await tx.user.findUniqueOrThrow({ where: { id: flow.linkUserId } });
      requireCondition(
        user.status === 'ACTIVE',
        403,
        'ACCOUNT_RESTRICTED',
        'Account is restricted',
      );
      await tx.authIdentity.create({
        data: { userId: user.id, provider: 'google', subject: claims.subject },
      });
      await audit(tx, user.id, 'auth.google_linked', user.id);
    });
    res.json({ data: { linked: true } });
    return;
  }
  const identity = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider: 'google', subject: claims.subject } },
    include: { user: true },
  });
  if (identity) {
    requireCondition(
      identity.user.status === 'ACTIVE',
      403,
      'ACCOUNT_RESTRICTED',
      'Account is restricted',
    );
    await service.rotateSession(req, identity.user);
    res.json({ data: { authenticated: true, csrfToken: req.session.csrf } });
    return;
  }
  if (await prisma.user.findUnique({ where: { email: claims.email } }))
    throw new AppError(
      409,
      'ACCOUNT_LINK_REQUIRED',
      'Sign in to the existing account and explicitly link Google',
    );
  req.session.pendingGoogle = { ...claims, createdAt: Date.now() };
  res.json({ data: { registrationRequired: true, requiredFields: ['phone', 'consentVersion'] } });
};
export const completeGoogle: RequestHandler = async (req, res) => {
  const pending = req.session.pendingGoogle;
  requireCondition(
    pending && Date.now() - pending.createdAt < 600000,
    400,
    'GOOGLE_FLOW_INVALID',
    'Restart Google registration',
  );
  requireCondition(
    req.body.consentVersion === env.PRIVACY_NOTICE_VERSION,
    422,
    'CONSENT_REQUIRED',
    'Accept the current privacy notice version',
  );
  const u = await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { name: 'APPLICANT' } });
    return tx.user.create({
      data: {
        email: pending.email,
        legalName: pending.name,
        phone: req.body.phone,
        emailVerifiedAt: new Date(),
        profile: { create: { consentVersion: req.body.consentVersion } },
        roles: { create: { roleId: role.id } },
        identities: { create: { provider: 'google', subject: pending.subject } },
      },
    });
  });
  await service.rotateSession(req, u);
  res.status(201).json({ data: { authenticated: true, csrfToken: req.session.csrf } });
};
