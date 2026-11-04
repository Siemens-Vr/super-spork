import type { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import { audit } from '../utils/audit.js';
import { requireCondition } from '../errors/app-error.js';
import type { profileSchema } from '../validators/applicant.schema.js';
import type { careerSchema } from '../validators/career.schema.js';
export async function profile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      legalName: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      profile: true,
    },
  });
}
export async function updateProfile(userId: string, input: z.infer<typeof profileSchema>) {
  const { legalName, phone, ...data } = input;
  return prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    await tx.user.update({ where: { id: userId }, data: { legalName, phone } });
    await tx.applicantProfile.update({ where: { userId }, data });
    await audit(tx, userId, 'profile.updated', userId);
    return profileFromTx(tx, userId);
  });
}
async function profileFromTx(tx: Parameters<typeof userLock>[0], id: string) {
  return tx.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      legalName: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      profile: true,
    },
  });
}
export async function onboarding(userId: string) {
  const [u, documents, preferences, booking] = await Promise.all([
    profile(userId),
    prisma.document.findMany({
      where: { applicantId: userId, replacement: null },
      select: { id: true, category: true, status: true, scanStatus: true },
    }),
    prisma.careerPreference.findUnique({ where: { applicantId: userId } }),
    prisma.assessmentBooking.findFirst({ where: { applicantId: userId, status: 'SCHEDULED' } }),
  ]);
  const complete = !!(
    u.phone &&
    u.profile?.educationLevel &&
    u.profile.institution &&
    u.profile.discipline &&
    u.profile.professionalStatus
  );
  return {
    emailVerified: !!u.emailVerifiedAt,
    profileComplete: complete,
    identitySubmitted: documents.some(
      (d) => ['NATIONAL_ID', 'PASSPORT'].includes(d.category) && d.scanStatus !== 'INFECTED',
    ),
    documents,
    careerSelected: !!preferences,
    assessmentScheduled: !!booking,
    verificationBlocksOnboarding: false,
  };
}
export async function getPreferences(userId: string) {
  return prisma.careerPreference.findUnique({
    where: { applicantId: userId },
    include: {
      primaryRole: true,
      industries: { include: { industry: true }, orderBy: { rank: 'asc' } },
      companies: { include: { company: true }, orderBy: { rank: 'asc' } },
    },
  });
}
export async function updatePreferences(userId: string, input: z.infer<typeof careerSchema>) {
  return prisma.$transaction(async (tx) => {
    await userLock(tx, userId);
    requireCondition(
      await tx.document.count({
        where: {
          applicantId: userId,
          category: { in: ['NATIONAL_ID', 'PASSPORT'] },
          scanStatus: { not: 'INFECTED' },
          replacement: null,
        },
      }),
      409,
      'IDENTITY_REQUIRED',
      'Submit an identity document before career selection',
    );
    requireCondition(
      (await tx.industry.count({ where: { id: { in: input.industryIds }, active: true } })) ===
        input.industryIds.length,
      422,
      'INDUSTRY_INVALID',
      'Select active industries',
    );
    requireCondition(
      (await tx.company.count({ where: { id: { in: input.companyIds }, active: true } })) ===
        input.companyIds.length,
      422,
      'COMPANY_INVALID',
      'Select active companies',
    );
    requireCondition(
      await tx.jobRole.findFirst({ where: { id: input.primaryRoleId, active: true } }),
      422,
      'ROLE_INVALID',
      'Select an active target role',
    );
    const existing = await tx.careerPreference.findUnique({ where: { applicantId: userId } });
    if (existing?.primaryRoleId !== input.primaryRoleId)
      requireCondition(
        !(await tx.assessmentBooking.count({
          where: { applicantId: userId, status: 'SCHEDULED' },
        })),
        409,
        'ACTIVE_BOOKING_EXISTS',
        'Cancel your active booking before changing the target role',
      );
    const p = await tx.careerPreference.upsert({
      where: { applicantId: userId },
      create: { applicantId: userId, primaryRoleId: input.primaryRoleId },
      update: { primaryRoleId: input.primaryRoleId },
    });
    await tx.industryPreference.deleteMany({ where: { preferenceId: p.id } });
    await tx.companyPreference.deleteMany({ where: { preferenceId: p.id } });
    await tx.industryPreference.createMany({
      data: input.industryIds.map((industryId, i) => ({
        preferenceId: p.id,
        industryId,
        rank: i + 1,
      })),
    });
    await tx.companyPreference.createMany({
      data: input.companyIds.map((companyId, i) => ({
        preferenceId: p.id,
        companyId,
        rank: i + 1,
      })),
    });
    await audit(tx, userId, 'career.preferences_updated', p.id);
    return p;
  });
}
