import { z } from 'zod';
export const industrySchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    description: z.string().min(5).max(4000),
    active: z.boolean().default(true),
  })
  .strict();
export const companySchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    description: z.string().min(5).max(4000),
    website: z.url().max(1000).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('KE'),
    active: z.boolean().default(true),
    industryIds: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, 'Duplicate industries'),
  })
  .strict();
export const roleSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().min(5).max(4000),
    active: z.boolean().default(true),
    industryIds: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine((v) => new Set(v).size === v.length, 'Duplicate industries'),
  })
  .strict();
export const institutionSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('KE'),
    website: z.url().max(1000).optional(),
    active: z.boolean().default(true),
  })
  .strict();
export const competencySchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9_-]+$/)
      .max(60),
    name: z.string().min(3).max(200),
    description: z.string().min(5).max(4000),
  })
  .strict();
export const frameworkSchema = z
  .object({
    jobRoleId: z.uuid(),
    version: z.number().int().min(1),
    title: z.string().min(3).max(200),
    approved: z.boolean().default(false),
    competencies: z
      .array(
        z.object({ competencyId: z.uuid(), weight: z.number().int().min(1).max(100) }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.competencies.map((c) => c.competencyId)).size === v.competencies.length,
    'Duplicate competencies',
  )
  .refine(
    (v) => v.competencies.reduce((sum, c) => sum + c.weight, 0) === 100,
    'Competency weights must total 100',
  );
export const blueprintSchema = z
  .object({
    jobRoleId: z.uuid(),
    frameworkId: z.uuid(),
    version: z.number().int().min(1),
    title: z.string().min(3).max(200),
    durationMinutes: z.number().int().min(15).max(240),
    instructions: z.string().min(10).max(4000),
    active: z.boolean().default(false),
    requiresAuthenticatedIdentity: z.boolean().default(false),
    requiresAuthenticatedAcademic: z.boolean().default(false),
  })
  .strict();
export const activationSchema = z.object({ active: z.boolean() }).strict();
export const availabilityPatchSchema = z
  .object({ active: z.boolean().optional(), capacity: z.number().int().min(1).max(100).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one change');
export const accountStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();
export const suggestionReviewSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().min(10).max(1000),
    companyId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.status !== 'APPROVED' || !!v.companyId,
    'Create the catalogue company first, then provide its ID',
  );
