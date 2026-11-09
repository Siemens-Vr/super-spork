import { z } from 'zod';
const ids = z
  .array(z.uuid())
  .max(3)
  .refine((v) => new Set(v).size === v.length, 'Duplicate selections are not allowed');
export const suggestionSchema = z
  .object({ name: z.string().trim().min(2).max(200), website: z.url().max(1000).optional() })
  .strict();
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(150).optional(),
});
export const catalogueQuery = pagination.extend({
  industryIds: z
    .string()
    .transform((value) => value.split(','))
    .pipe(ids.min(1))
    .optional(),
});
