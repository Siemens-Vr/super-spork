import argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import type { z } from 'zod';
import type { Request } from 'express';
import { prisma, userLock, type Tx } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError, requireCondition } from '../errors/app-error.js';
import { decrypt, encrypt, randomToken, safeEqual, verifier } from '../utils/crypto.js';
import { notify } from './email.service.js';
import { audit } from '../utils/audit.js';
import type { registerSchema, resetSchema } from '../validators/auth.schema.js';
import type { ChallengePurpose } from '../generated/prisma/client.js';
export const hashPassword = (password: string) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
const dummyHash = hashPassword(randomToken());
export const genericMessage = 'If the account is eligible, an email will be sent.';
async function issueChallenge(
  tx: Tx,
  user: { id: string; email: string },
  purpose: ChallengePurpose,
) {
  const last = await tx.authChallenge.findFirst({
    where: { userId: user.id, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (last && Date.now() - last.createdAt.getTime() < env.OTP_RESEND_SECONDS * 1000) return;
  await tx.authChallenge.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const challengeId = crypto.randomUUID();
  await tx.authChallenge.create({
    data: {
      id: challengeId,
      userId: user.id,
      purpose,
      verifier: verifier(`${purpose}:${challengeId}:${code}`),
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    },
  });
  await notify(
    tx,
    user.email,
    purpose === 'EMAIL_VERIFICATION' ? 'Verify your email' : 'Password recovery',
    `Your code is ${code}. It expires in ${env.OTP_TTL_SECONDS / 60} minutes.`,
  );
}
async function consumeChallenge(
  tx: Tx,
  userId: string,
  purpose: ChallengePurpose,
  code: string,
): Promise<boolean> {
  const c = await tx.authChallenge.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!c || c.expiresAt <= new Date() || c.attempts >= env.OTP_MAX_ATTEMPTS) return false;
  await tx.authChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
  if (!safeEqual(c.verifier, verifier(`${purpose}:${c.id}:${code}`))) return false;
  await tx.authChallenge.update({ where: { id: c.id }, data: { consumedAt: new Date() } });
  return true;
}
export async function register(input: z.infer<typeof registerSchema>) {
  requireCondition(
    input.consentVersion === env.PRIVACY_NOTICE_VERSION,
    422,
    'CONSENT_REQUIRED',
    'Accept the current privacy notice version',
  );
  const passwordHash = await hashPassword(input.password);
  try {
    await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.email } })) return;
      const role = await tx.role.findUniqueOrThrow({ where: { name: 'APPLICANT' } });
      const u = await tx.user.create({
        data: {
          legalName: input.legalName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          roles: { create: { roleId: role.id } },
          profile: { create: { consentVersion: input.consentVersion } },
        },
      });
      await issueChallenge(tx, u, 'EMAIL_VERIFICATION');
      await audit(tx, u.id, 'auth.registered', u.id);
    });
  } catch (e) {
    if (!(typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002')) throw e;
  }
}
export async function requestCode(email: string, purpose: ChallengePurpose) {
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { email } });
    if (!u) return;
    await userLock(tx, u.id);
    if (
      u.status !== 'ACTIVE' ||
      (purpose === 'EMAIL_VERIFICATION' && u.emailVerifiedAt) ||
      (purpose === 'PASSWORD_RESET' && !u.passwordHash)
    )
      return;
    await issueChallenge(tx, u, purpose);
  });
}
export async function verifyEmail(email: string, code: string) {
  const ok = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { email } });
    if (!u || u.status !== 'ACTIVE') return false;
    await userLock(tx, u.id);
    if (!(await consumeChallenge(tx, u.id, 'EMAIL_VERIFICATION', code))) return false;
    await tx.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    await notify(
      tx,
      u.email,
      'Registration complete',
      'Your email has been verified. You may complete onboarding and book your competency assessment.',
    );
    await audit(tx, u.id, 'auth.email_verified', u.id);
    return true;
  });
  requireCondition(ok, 400, 'CODE_INVALID', 'Invalid or expired verification code');
}
export async function resetPassword(input: z.infer<typeof resetSchema>) {
  const passwordHash = await hashPassword(input.password);
  const ok = await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { email: input.email } });
    if (!u || u.status !== 'ACTIVE' || !u.passwordHash) return false;
    await userLock(tx, u.id);
    if (!(await consumeChallenge(tx, u.id, 'PASSWORD_RESET', input.code))) return false;
    await tx.user.update({
      where: { id: u.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.session.updateMany({
      where: { userId: u.id },
      data: { revokedAt: new Date(), data: {} },
    });
    await notify(
      tx,
      u.email,
      'Password changed',
      'Your password was changed and all sessions were revoked.',
    );
    await audit(tx, u.id, 'auth.password_reset', u.id);
    return true;
  });
  requireCondition(ok, 400, 'CODE_INVALID', 'Invalid or expired recovery code');
}
export async function credentials(email: string, password: string) {
  const u = await prisma.user.findUnique({ where: { email } });
  const valid = await argon2.verify(u?.passwordHash ?? (await dummyHash), password);
  if (!u || !valid || u.status !== 'ACTIVE')
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return u;
}
export async function rotateSession(
  req: Request,
  user: { id: string; sessionVersion: number },
  mfaAt?: number,
) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
  req.session.userId = user.id;
  req.session.sessionVersion = user.sessionVersion;
  req.session.authenticatedAt = Date.now();
  req.session.mfaAt = mfaAt;
  req.session.csrf = randomToken();
  await new Promise<void>((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
}
export async function revokeAll(userId: string) {
  await prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { userId }, data: { revokedAt: new Date(), data: {} } });
    await audit(tx, userId, 'auth.sessions_revoked', userId);
  });
}
export async function mfaSetup(userId: string) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    const existing = await tx.adminMfaCredential.findUnique({ where: { userId } });
    requireCondition(!existing?.enabledAt, 409, 'MFA_ALREADY_ENABLED', 'MFA is already configured');
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const totp = new OTPAuth.TOTP({
      issuer: 'VML NEXUS',
      label: u.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });
    const recoveryCodes = Array.from({ length: 10 }, () => randomToken());
    await tx.adminMfaCredential.upsert({
      where: { userId },
      create: {
        userId,
        encryptedSecret: encrypt(totp.secret.base32),
        recoveryHashes: recoveryCodes.map(verifier),
      },
      update: {
        encryptedSecret: encrypt(totp.secret.base32),
        recoveryHashes: recoveryCodes.map(verifier),
        lastCounter: BigInt(-1),
      },
    });
    await audit(tx, userId, 'auth.mfa_setup_started', userId);
    return { provisioningUri: totp.toString(), recoveryCodes };
  });
}
export async function verifyMfa(userId: string, code: string) {
  const result = await prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    const m = await tx.adminMfaCredential.findUnique({ where: { userId } });
    if (!m) return false;
    const recovery = verifier(code);
    if (m.enabledAt && m.recoveryHashes.includes(recovery)) {
      await tx.adminMfaCredential.update({
        where: { userId },
        data: { recoveryHashes: { set: m.recoveryHashes.filter((h) => h !== recovery) } },
      });
      await audit(tx, userId, 'auth.mfa_recovery_used', userId);
      return true;
    }
    const totp = new OTPAuth.TOTP({
      secret: decrypt(m.encryptedSecret),
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    const delta = totp.validate({ token: code, window: 1 });
    if (delta === null) return false;
    const counter = BigInt(Math.floor(Date.now() / 30000) + delta);
    if (counter <= m.lastCounter) return false;
    await tx.adminMfaCredential.update({
      where: { userId },
      data: { lastCounter: counter, enabledAt: m.enabledAt ?? new Date() },
    });
    await audit(tx, userId, 'auth.mfa_verified', userId);
    return true;
  });
  requireCondition(result, 401, 'MFA_INVALID', 'Invalid or already used MFA code');
}
