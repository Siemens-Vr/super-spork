import { z } from 'zod';
import { phone } from './auth.schema.js';
export const profileSchema = z
  .object({
    legalName: z.string().trim().min(3).max(150).optional(),
    phone: phone.optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    region: z.string().trim().min(2).max(100).optional(),
    educationLevel: z
      .enum(['SECONDARY', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD', 'OTHER'])
      .optional(),
    institution: z.string().trim().min(2).max(200).optional(),
    discipline: z.string().trim().min(2).max(150).optional(),
    professionalStatus: z.enum(['STUDENT', 'GRADUATE', 'PROFESSIONAL', 'OTHER']).optional(),
    graduationYear: z
      .number()
      .int()
      .min(1950)
      .max(new Date().getUTCFullYear() + 10)
      .optional(),
    summary: z.string().max(2000).optional(),
  })
  .strict();
