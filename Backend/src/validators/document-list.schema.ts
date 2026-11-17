import { z } from 'zod';

const documentCursor = z.object({ createdAt: z.iso.datetime(), id: z.uuid() }).strict();
export const documentListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .transform((value, ctx) => {
      try {
        return documentCursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid document cursor' });
        return z.NEVER;
      }
    })
    .optional(),
  eligibleForAssessment: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const qualificationCategories = [
  'BACHELOR',
  'MASTER',
  'PHD',
  'DIPLOMA',
  'SHORT_COURSE',
  'INDUSTRY_CERTIFICATION',
  'PROFESSIONAL_REGISTRATION',
] as const;
