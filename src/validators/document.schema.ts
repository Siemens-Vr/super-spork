import { z } from 'zod';
export const identityCategories = ['NATIONAL_ID', 'PASSPORT'] as const;
export const academicCategories = [
  'BACHELOR',
  'MASTER',
  'PHD',
  'DIPLOMA',
  'TRANSCRIPT',
  'SHORT_COURSE',
  'INDUSTRY_CERTIFICATION',
  'PROFESSIONAL_REGISTRATION',
  'OTHER',
] as const;
export const documentSchema = z
  .object({
    category: z.enum([...identityCategories, ...academicCategories]),
    title: z.string().trim().min(2).max(200),
    issuer: z.string().trim().max(200).optional(),
    institutionId: z.uuid().optional(),
    issuedAt: z.iso.datetime({ offset: true }).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    credentialNumber: z.string().max(150).optional(),
    verificationUrl: z
      .url()
      .max(1000)
      .refine((v) => v.startsWith('https://'), 'Use HTTPS')
      .optional(),
  })
  .strict()
  .refine((v) => !v.issuedAt || !v.expiresAt || new Date(v.expiresAt) > new Date(v.issuedAt), {
    path: ['expiresAt'],
    message: 'Expiry must follow issue date',
  });
export const metadataSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    issuer: z.string().trim().max(200).optional(),
  })
  .strict();
export const reviewSchema = z
  .object({
    outcome: z.enum([
      'UNDER_REVIEW',
      'ADDITIONAL_EVIDENCE_REQUIRED',
      'AUTHENTICATED',
      'REJECTED',
      'DISPUTED',
    ]),
    method: z.enum(['MANUAL', 'INSTITUTION_CONFIRMATION', 'OFFICIAL_VERIFICATION', 'AI_ASSISTED']),
    reason: z.string().trim().min(10).max(2000),
    internalNotes: z.string().max(4000).optional(),
    evidenceReference: z.string().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.outcome !== 'AUTHENTICATED' || v.method !== 'AI_ASSISTED', {
    message: 'AI-assisted analysis cannot authenticate documents',
  })
  .refine((v) => v.outcome !== 'AUTHENTICATED' || !!v.evidenceReference, {
    message: 'Authentication requires an independent evidence reference',
  });
export const evidenceSchema = z
  .object({ note: z.string().trim().min(5).max(4000), reference: z.string().max(1000).optional() })
  .strict();
