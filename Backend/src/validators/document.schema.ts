import { z } from 'zod';
export const identityCategories = ['NATIONAL_ID', 'PASSPORT'] as const;
export const degreeCategories = ['BACHELOR', 'MASTER', 'PHD', 'DIPLOMA'] as const;
export const professionalCategories = [
  'INDUSTRY_CERTIFICATION',
  'PROFESSIONAL_REGISTRATION',
] as const;
const optionalText = (schema: z.ZodType<string>) =>
  z
    .union([schema, z.literal('')])
    .optional()
    .transform((value) => value || undefined);
const optionalDocumentDate = z
  .string({ error: 'Use YYYY-MM-DD or an ISO datetime, or leave this optional date blank' })
  .trim()
  .pipe(
    z.union([z.iso.date(), z.iso.datetime({ offset: true }), z.literal('')], {
      error: 'Use YYYY-MM-DD or an ISO datetime, or leave this optional date blank',
    }),
  )
  .nullish()
  .transform((value) => value || undefined);
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
type RequiredDocumentField =
  'courseName' | 'certificationName' | 'issuer' | 'issuedAt' | 'expiresAt' | 'title';
export const academicDocumentRules: Record<
  (typeof academicCategories)[number],
  {
    label: string;
    institutionRequired: boolean;
    requiredFields: RequiredDocumentField[];
    transcriptsRequired: boolean;
  }
> = {
  BACHELOR: {
    label: "Bachelor's degree",
    institutionRequired: true,
    requiredFields: ['courseName'],
    transcriptsRequired: true,
  },
  MASTER: {
    label: "Master's degree",
    institutionRequired: true,
    requiredFields: ['courseName'],
    transcriptsRequired: true,
  },
  PHD: {
    label: 'PhD',
    institutionRequired: true,
    requiredFields: ['courseName'],
    transcriptsRequired: true,
  },
  DIPLOMA: {
    label: 'Diploma',
    institutionRequired: true,
    requiredFields: ['courseName'],
    transcriptsRequired: true,
  },
  SHORT_COURSE: {
    label: 'Short course',
    institutionRequired: false,
    requiredFields: ['courseName'],
    transcriptsRequired: false,
  },
  INDUSTRY_CERTIFICATION: {
    label: 'Industry certification',
    institutionRequired: false,
    requiredFields: ['certificationName', 'issuer', 'issuedAt'],
    transcriptsRequired: false,
  },
  PROFESSIONAL_REGISTRATION: {
    label: 'Professional registration',
    institutionRequired: false,
    requiredFields: ['issuer', 'issuedAt', 'expiresAt'],
    transcriptsRequired: false,
  },
  TRANSCRIPT: {
    label: 'Standalone transcript',
    institutionRequired: true,
    requiredFields: ['courseName'],
    transcriptsRequired: false,
  },
  OTHER: {
    label: 'Other document',
    institutionRequired: false,
    requiredFields: ['title'],
    transcriptsRequired: false,
  },
};
const fieldLabels: Record<RequiredDocumentField, string> = {
  courseName: 'Course or programme name',
  certificationName: 'Certification name',
  issuer: 'Issuing organisation or professional body name',
  issuedAt: 'Issue date',
  expiresAt: 'Expiry date',
  title: 'Descriptive document name',
};
export const documentSchema = z
  .object({
    category: z.enum([...identityCategories, ...academicCategories]),
    title: optionalText(z.string().trim().min(2).max(200)),
    courseName: optionalText(z.string().trim().min(2).max(200)),
    certificationName: optionalText(z.string().trim().min(2).max(200)),
    issuer: optionalText(z.string().trim().min(2).max(200)),
    institutionId: optionalText(z.uuid()),
    institutionName: optionalText(z.string().trim().min(2).max(200)),
    issuedAt: optionalDocumentDate,
    expiresAt: optionalDocumentDate,
    credentialNumber: z.string().max(150).optional(),
    verificationUrl: optionalText(
      z
        .url()
        .max(1000)
        .refine((v) => v.startsWith('https://'), 'Use HTTPS'),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rules = academicDocumentRules[value.category as keyof typeof academicDocumentRules];
    if (rules?.institutionRequired && !value.institutionId && !value.institutionName)
      ctx.addIssue({
        code: 'custom',
        path: ['institutionId'],
        message: 'Select an institution or enter its name',
      });
    if (value.institutionId && value.institutionName)
      ctx.addIssue({
        code: 'custom',
        path: ['institutionName'],
        message: 'Choose an institution OR enter a name, not both',
      });
    for (const field of rules?.requiredFields ?? []) {
      if (!value[field])
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${fieldLabels[field]} is required for ${rules!.label}`,
        });
    }
  })
  .refine((v) => !v.issuedAt || !v.expiresAt || new Date(v.expiresAt) > new Date(v.issuedAt), {
    path: ['expiresAt'],
    message: 'Expiry must follow issue date',
  });
export const metadataSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    issuer: z.string().trim().min(2).max(200).optional(),
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
