import type { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import { audit } from '../utils/audit.js';
import { applicantProfileSelect, isProfileComplete } from '../utils/applicant-profile.js';
import type { profileSchema } from '../validators/applicant.schema.js';
export async function profile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      legalName: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      profile: { select: applicantProfileSelect },
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
      profile: { select: applicantProfileSelect },
    },
  });
}
export async function onboarding(userId: string) {
  const [u, documents, target, booking] = await Promise.all([
    profile(userId),
    prisma.document.findMany({
      where: { applicantId: userId, replacement: null },
      select: { id: true, category: true, status: true, scanStatus: true },
    }),
    prisma.assessmentTarget.findFirst({
      where: { applicantId: userId, status: { not: 'COMPLETED' } },
      select: { id: true },
    }),
    prisma.assessmentBooking.findFirst({ where: { applicantId: userId, status: 'SCHEDULED' } }),
  ]);
  const complete = isProfileComplete(u);
  return {
    emailVerified: !!u.emailVerifiedAt,
    profileComplete: complete,
    identitySubmitted: documents.some(
      (d) => ['NATIONAL_ID', 'PASSPORT'].includes(d.category) && d.scanStatus !== 'INFECTED',
    ),
    documents,
    careerSelected: !!target,
    assessmentScheduled: !!booking,
    verificationBlocksOnboarding: false,
  };
}
