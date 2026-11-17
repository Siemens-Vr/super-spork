import { z } from 'zod';
import { email } from './auth.schema.js';
export const trainerStatuses = [
  'DRAFT',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export const trainerInviteSchema = z.object({ email }).strict();
export const acceptTrainerInviteSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const trainerVersionSchema = z.object({ version: z.number().int().min(0) }).strict();
export const trainerProfileSchema = z
  .object({
    version: z.number().int().min(0),
    headline: z.string().trim().min(3).max(120),
    biography: z.string().trim().min(40).max(3000),
    country: z.string().regex(/^[A-Z]{2}$/),
    region: z.string().trim().min(2).max(100),
    yearsExperience: z.number().int().min(0).max(60),
    expertise: z
      .array(z.string().trim().min(2).max(80))
      .min(1)
      .max(10)
      .refine(
        (v) => new Set(v.map((x) => x.toLowerCase())).size === v.length,
        'Duplicate expertise areas',
      ),
  })
  .strict();
export const trainerQualificationSchema = z
  .object({
    version: z.coerce.number().int().min(0),
    category: z.enum(['DEGREE', 'DIPLOMA', 'CERTIFICATION', 'REGISTRATION', 'OTHER']),
    title: z.string().trim().min(3).max(200),
    issuer: z.string().trim().min(2).max(200),
    issuedAt: z.iso
      .date()
      .refine((v) => new Date(v) <= new Date(), 'Issue date cannot be in the future'),
    expiresAt: z.union([z.iso.date(), z.literal('')]).optional(),
  })
  .strict()
  .refine((v) => !v.expiresAt || new Date(v.expiresAt) > new Date(v.issuedAt), {
    path: ['expiresAt'],
    message: 'Expiry must follow issue date',
  });
export const trainerReviewSchema = z
  .object({
    version: z.number().int().min(0),
    outcome: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED']),
    reason: z.string().trim().min(10).max(2000),
    evidenceReference: z.string().trim().min(5).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.outcome !== 'APPROVED' || !!v.evidenceReference, {
    path: ['evidenceReference'],
    message: 'Record the independent evidence supporting approval',
  });
export const trainerListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(150).optional(),
  status: z.enum(trainerStatuses).optional(),
});
