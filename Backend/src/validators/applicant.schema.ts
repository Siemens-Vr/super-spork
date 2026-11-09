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
    discipline: z.string().trim().min(2).max(150).optional(),
  })
  .strict();
