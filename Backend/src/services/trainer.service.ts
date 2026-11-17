import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import type { z } from 'zod';
import { prisma, userLock, type Tx } from '../config/prisma.js';
import { env } from '../config/env.js';
import { storage } from '../config/storage.js';
import { requireCondition } from '../errors/app-error.js';
import { audit } from '../utils/audit.js';
import { randomToken, verifier } from '../utils/crypto.js';
import { notify } from './email.service.js';
import type {
  TrainerProfile,
  TrainerQualification,
  TrainerStatus,
  Prisma,
} from '../generated/prisma/client.js';
import type {
  trainerProfileSchema,
  trainerQualificationSchema,
  trainerReviewSchema,
  trainerListSchema,
} from '../validators/trainer.schema.js';
const editable: TrainerStatus[] = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'];
const transitions: Record<TrainerStatus, TrainerStatus[]> = {
  DRAFT: [],
  SUBMITTED: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
  CHANGES_REQUESTED: [],
  APPROVED: ['SUSPENDED', 'CHANGES_REQUESTED'],
  REJECTED: ['CHANGES_REQUESTED'],
  SUSPENDED: ['APPROVED', 'CHANGES_REQUESTED'],
};
export function publicQualification(q: TrainerQualification) {
  return {
    id: q.id,
    category: q.category,
    title: q.title,
    issuer: q.issuer,
    issuedAt: q.issuedAt,
    expiresAt: q.expiresAt,
    mimeType: q.mimeType,
    size: q.size,
    scanStatus: q.scanStatus,
    withdrawnAt: q.withdrawnAt,
    createdAt: q.createdAt,
  };
}
const detailInclude = {
  user: {
    select: {
      id: true,
      legalName: true,
      email: true,
      phone: true,
      status: true,
      emailVerifiedAt: true,
    },
  },
  qualifications: { orderBy: { createdAt: 'asc' as const } },
  reviews: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      fromStatus: true,
      outcome: true,
      reason: true,
      evidenceReference: true,
      createdAt: true,
    },
  },
};
export async function trainerDetail(userId: string) {
  const p = await prisma.trainerProfile.findUnique({ where: { userId }, include: detailInclude });
  requireCondition(p, 404, 'TRAINER_NOT_FOUND', 'Trainer profile not found');
  return { ...p, qualifications: p.qualifications.map(publicQualification) };
}
function checkVersion(profile: TrainerProfile, version: number) {
  requireCondition(
    profile.version === version,
    409,
    'TRAINER_VERSION_CONFLICT',
    'This trainer record changed. Refresh before making another change.',
  );
}
function checkEditable(profile: TrainerProfile, version: number) {
  checkVersion(profile, version);
  requireCondition(
    editable.includes(profile.status),
    409,
    'TRAINER_PROFILE_LOCKED',
    'Submitted or approved profiles require an administrator change request before editing.',
  );
}
export async function inviteTrainer(actorId: string, email: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trainer-invite:${email}`},0))`;
    const user = await tx.user.findUnique({ where: { email }, include: { trainerProfile: true } });
    requireCondition(
      !user?.trainerProfile,
      409,
      'TRAINER_EXISTS',
      'This account already has a trainer profile',
    );
    requireCondition(
      !user || user.status === 'ACTIVE',
      409,
      'ACCOUNT_RESTRICTED',
      'This account is restricted',
    );
    await tx.trainerInvitation.updateMany({
      where: { email, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    const token = randomToken();
    const invitation = await tx.trainerInvitation.create({
      data: {
        email,
        tokenHash: verifier(`trainer-invite:${token}`),
        invitedById: actorId,
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    const url = new URL('/invitations/accept', env.TRAINER_URL);
    url.hash = new URLSearchParams({ token }).toString();
    await notify(
      tx,
      email,
      'Trainer invitation',
      `You have been invited to join VML NEXUS as a trainer.\n\n${url.href}\n\nThis private link expires in seven days. Sign in or create an applicant account using this exact email, verify your email, then open this link to accept. Trainer access is invitation-only. Profile approval is required before teaching access can be granted.`,
    );
    await audit(tx, actorId, 'trainer.invited', invitation.id, { email });
    return {
      id: invitation.id,
      email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  });
}
export async function acceptTrainerInvitation(userId: string, token: string) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    const hash = verifier(`trainer-invite:${token}`);
    await tx.$queryRaw`SELECT id FROM "TrainerInvitation" WHERE "tokenHash"=${hash} FOR UPDATE`;
    const invitation = await tx.trainerInvitation.findUnique({ where: { tokenHash: hash } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    requireCondition(
      invitation &&
        invitation.status === 'PENDING' &&
        invitation.expiresAt > new Date() &&
        invitation.email === user.email &&
        user.emailVerifiedAt &&
        user.status === 'ACTIVE',
      400,
      'TRAINER_INVITATION_INVALID',
      'This invitation is invalid, expired, or belongs to another verified email.',
    );
    requireCondition(
      !(await tx.trainerProfile.findUnique({ where: { userId } })),
      409,
      'TRAINER_EXISTS',
      'This account already has a trainer profile',
    );
    const role = await tx.role.findUniqueOrThrow({ where: { name: 'TRAINER' } });
    await tx.trainerProfile.create({ data: { userId } });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
    await tx.trainerInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedById: userId, acceptedAt: new Date() },
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(tx, userId, 'trainer.invitation_accepted', invitation.id);
    return updated;
  });
}
export async function revokeTrainerInvitation(actorId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.trainerInvitation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    requireCondition(
      changed.count,
      409,
      'TRAINER_INVITATION_NOT_PENDING',
      'Only pending invitations can be revoked',
    );
    await audit(tx, actorId, 'trainer.invitation_revoked', id);
    return { id, status: 'REVOKED' };
  });
}
async function lockedProfile(tx: Tx, userId: string) {
  await userLock(tx, userId);
  const p = await tx.trainerProfile.findUnique({ where: { userId } });
  requireCondition(p, 404, 'TRAINER_NOT_FOUND', 'Trainer profile not found');
  return p;
}
export async function updateTrainerProfile(
  userId: string,
  input: z.infer<typeof trainerProfileSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const p = await lockedProfile(tx, userId);
    checkEditable(p, input.version);
    const { version: _version, ...data } = input;
    await tx.trainerProfile.update({
      where: { id: p.id },
      data: { ...data, version: { increment: 1 } },
    });
    await audit(tx, userId, 'trainer.profile_updated', p.id);
    return { id: p.id };
  });
}
export async function uploadTrainerQualification(
  userId: string,
  input: z.infer<typeof trainerQualificationSchema>,
  file: Express.Multer.File | undefined,
) {
  requireCondition(file, 422, 'FILE_REQUIRED', 'Attach a qualification document');
  const buffer = file.buffer ?? (await readFile(file.path));
  const detected = await fileTypeFromBuffer(buffer);
  requireCondition(
    detected &&
      ['application/pdf', 'image/jpeg', 'image/png'].includes(detected.mime) &&
      detected.mime === file.mimetype,
    415,
    'INVALID_FILE_TYPE',
    'Attach a matching PDF, JPEG or PNG document',
  );
  const key = `trainer-quarantine/${randomUUID()}`;
  await storage.put(key, buffer, detected.mime);
  try {
    return await prisma.$transaction(async (tx) => {
      const p = await lockedProfile(tx, userId);
      checkEditable(p, input.version);
      const current = await tx.trainerQualification.count({
        where: { trainerProfileId: p.id, withdrawnAt: null },
      });
      requireCondition(
        current < 20,
        409,
        'TRAINER_QUALIFICATION_LIMIT',
        'Keep at most twenty current qualifications',
      );
      const usage = await tx.trainerQualification.aggregate({
        where: { trainerProfileId: p.id, storageDeletedAt: null },
        _sum: { size: true },
      });
      requireCondition(
        (usage._sum.size ?? 0) + file.size <= env.MAX_ACCOUNT_UPLOAD_MB * 1024 * 1024,
        413,
        'STORAGE_QUOTA_EXCEEDED',
        'Trainer document storage quota exceeded',
      );
      const { version: _version, ...data } = input;
      const q = await tx.trainerQualification.create({
        data: {
          ...data,
          trainerProfileId: p.id,
          issuedAt: new Date(input.issuedAt),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          storageKey: key,
          mimeType: detected.mime,
          size: file.size,
          sha256: createHash('sha256').update(buffer).digest('hex'),
        },
      });
      await tx.trainerProfile.update({ where: { id: p.id }, data: { version: { increment: 1 } } });
      await audit(tx, userId, 'trainer.qualification_uploaded', q.id);
      return publicQualification(q);
    });
  } catch (e) {
    await storage.remove(key).catch(() => {});
    throw e;
  }
}
export async function withdrawTrainerQualification(userId: string, id: string, version: number) {
  return prisma.$transaction(async (tx) => {
    const p = await lockedProfile(tx, userId);
    checkEditable(p, version);
    const result = await tx.trainerQualification.updateMany({
      where: { id, trainerProfileId: p.id, withdrawnAt: null },
      data: { withdrawnAt: new Date() },
    });
    requireCondition(result.count, 404, 'NOT_FOUND', 'Qualification not found');
    await tx.trainerProfile.update({ where: { id: p.id }, data: { version: { increment: 1 } } });
    await audit(tx, userId, 'trainer.qualification_withdrawn', id);
  });
}
function completeProfile(p: TrainerProfile) {
  return (
    p.headline.length >= 3 &&
    p.biography.length >= 40 &&
    p.region.length >= 2 &&
    p.expertise.length > 0
  );
}
async function completeQualifications(tx: Tx, p: TrainerProfile) {
  const qs = await tx.trainerQualification.findMany({
    where: { trainerProfileId: p.id, withdrawnAt: null },
  });
  requireCondition(
    qs.length &&
      qs.every((q) => q.scanStatus === 'CLEAN' && (!q.expiresAt || q.expiresAt > new Date())),
    409,
    'TRAINER_QUALIFICATIONS_REQUIRED',
    'Add at least one qualification. All current files must pass scanning and be unexpired before submission or approval.',
  );
  return qs;
}
export async function submitTrainerProfile(userId: string, version: number) {
  return prisma.$transaction(async (tx) => {
    const p = await lockedProfile(tx, userId);
    checkEditable(p, version);
    requireCondition(
      completeProfile(p),
      422,
      'TRAINER_PROFILE_INCOMPLETE',
      'Complete your professional profile before submitting',
    );
    await completeQualifications(tx, p);
    await tx.trainerProfile.update({
      where: { id: p.id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), version: { increment: 1 } },
    });
    await audit(tx, userId, 'trainer.submitted', p.id);
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await notify(
      tx,
      u.email,
      'Trainer profile submitted',
      'Your professional profile has been submitted for administrator review. We will email you when a decision is recorded.',
    );
  });
}
export async function reviewTrainer(
  actorId: string,
  userId: string,
  input: z.infer<typeof trainerReviewSchema>,
) {
  return prisma.$transaction(async (tx) => {
    const p = await lockedProfile(tx, userId);
    checkVersion(p, input.version);
    requireCondition(
      actorId !== userId,
      403,
      'TRAINER_SELF_REVIEW_FORBIDDEN',
      'Another administrator must review your trainer profile',
    );
    requireCondition(
      transitions[p.status].includes(input.outcome),
      409,
      'TRAINER_TRANSITION_INVALID',
      'This review decision is not available for the current status',
    );
    if (input.outcome === 'APPROVED') {
      requireCondition(
        completeProfile(p),
        422,
        'TRAINER_PROFILE_INCOMPLETE',
        'The professional profile is incomplete',
      );
      await completeQualifications(tx, p);
    }
    const qualifications = await tx.trainerQualification.findMany({
      where: { trainerProfileId: p.id, withdrawnAt: null },
    });
    const snapshot = JSON.parse(
      JSON.stringify({
        headline: p.headline,
        biography: p.biography,
        country: p.country,
        region: p.region,
        yearsExperience: p.yearsExperience,
        expertise: p.expertise,
        version: p.version,
        qualifications: qualifications.map(publicQualification),
      }),
    ) as Prisma.InputJsonValue;
    await tx.trainerReview.create({
      data: {
        trainerProfileId: p.id,
        reviewerId: actorId,
        fromStatus: p.status,
        outcome: input.outcome,
        reason: input.reason,
        evidenceReference: input.evidenceReference,
        snapshot,
      },
    });
    await tx.trainerProfile.update({
      where: { id: p.id },
      data: { status: input.outcome, reviewedAt: new Date(), version: { increment: 1 } },
    });
    await audit(tx, actorId, 'trainer.reviewed', p.id, { from: p.status, to: input.outcome });
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    await notify(
      tx,
      u.email,
      'Trainer review update',
      `Your trainer profile status is ${input.outcome}.\n\n${input.reason}\n\nOpen your trainer workspace to see the decision.`,
    );
  });
}
export async function listTrainers(input: z.infer<typeof trainerListSchema>) {
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.search
      ? {
          user: {
            OR: [
              { email: { contains: input.search, mode: 'insensitive' as const } },
              { legalName: { contains: input.search, mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.trainerProfile.findMany({
      where,
      select: {
        id: true,
        userId: true,
        headline: true,
        status: true,
        version: true,
        submittedAt: true,
        updatedAt: true,
        user: { select: { legalName: true, email: true } },
        _count: { select: { qualifications: { where: { withdrawnAt: null } } } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    }),
    prisma.trainerProfile.count({ where }),
  ]);
  return { data, meta: { page: input.page, limit: input.limit, total } };
}
export async function downloadTrainerQualification(actorId: string, id: string, asAdmin = false) {
  const q = await prisma.trainerQualification.findFirst({
    where: { id, ...(!asAdmin ? { trainerProfile: { userId: actorId } } : {}) },
  });
  requireCondition(q, 404, 'NOT_FOUND', 'Qualification not found');
  requireCondition(
    q.scanStatus === 'CLEAN' && !q.storageDeletedAt,
    409,
    'DOCUMENT_QUARANTINED',
    'The file must pass malware scanning before it can be downloaded',
  );
  const buffer = await storage.get(q.storageKey);
  requireCondition(
    createHash('sha256').update(buffer).digest('hex') === q.sha256,
    503,
    'DOCUMENT_INTEGRITY_FAILED',
    'Document integrity check failed',
  );
  await audit(prisma, actorId, 'trainer.qualification_downloaded', id);
  return { buffer, mimeType: q.mimeType };
}
