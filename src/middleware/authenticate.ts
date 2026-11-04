import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
export interface Principal {
  id: string;
  email: string;
  legalName: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  roles: string[];
  permissions: string[];
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  if (!req.session.userId)
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in to continue');
  const u = await prisma.user.findUnique({
    where: { id: req.session.userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!u || u.status !== 'ACTIVE' || u.sessionVersion !== req.session.sessionVersion)
    throw new AppError(401, 'SESSION_INVALID', 'Session is no longer valid');
  req.principal = {
    id: u.id,
    email: u.email,
    legalName: u.legalName,
    phone: u.phone,
    emailVerifiedAt: u.emailVerifiedAt,
    roles: u.roles.map((r) => r.role.name),
    permissions: u.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.name)),
  };
  next();
};
export const verified: RequestHandler = (req, _res, next) => {
  if (!req.principal?.emailVerifiedAt)
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', 'Verify your email first');
  next();
};
export function authorize(permission: string): RequestHandler {
  return (req, _res, next) => {
    const p = req.principal;
    if (!p?.permissions.includes(permission))
      throw new AppError(403, 'FORBIDDEN', 'Permission required');
    if (
      p.roles.includes('ADMIN') &&
      (!req.session.mfaAt || Date.now() - req.session.mfaAt > env.ADMIN_MFA_MAX_AGE_MINUTES * 60000)
    )
      throw new AppError(403, 'MFA_REQUIRED', 'Complete admin MFA before privileged access');
    next();
  };
}
export const admin: RequestHandler = (req, _res, next) => {
  if (!req.principal?.roles.includes('ADMIN'))
    throw new AppError(403, 'FORBIDDEN', 'Administrator access required');
  next();
};
export const applicant: RequestHandler = (req, _res, next) => {
  if (!req.principal?.roles.includes('APPLICANT'))
    throw new AppError(403, 'FORBIDDEN', 'Applicant access required');
  next();
};
