import { z } from 'zod';

const selections = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selections');

export const targetSchema = z
  .object({
    jobRoleId: z.uuid(),
    industryIds: selections(3).min(1),
    companyIds: selections(3).default([]),
    qualificationIds: selections(10).default([]),
  })
  .strict();
export const prepareTargetSchema = z.object({ blueprintId: z.uuid() }).strict();
export const completeAttemptSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            requirementId: z.uuid(),
            score: z.number().int().min(0).max(100),
            evidence: z.string().trim().min(10).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(400),
  })
  .strict()
  .refine(
    (v) => new Set(v.results.map((r) => r.requirementId)).size === v.results.length,
    'Duplicate competency results',
  );
export const learningProgressSchema = z
  .object({
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
  })
  .strict();
