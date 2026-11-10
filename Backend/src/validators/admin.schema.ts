import { z } from 'zod';
import { interactionPolicySchema } from './assessment-interaction.schema.js';
import { institutionTypes } from './institution.schema.js';
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
    type: z.enum(institutionTypes).default('OTHER'),
    offersTvet: z.boolean().default(false),
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
    scope: z.enum(['CORE', 'INDUSTRY', 'COMPANY', 'COURSE']).default('CORE'),
    industryId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    courseName: z.string().trim().min(2).max(200).optional(),
    competencies: z
      .array(
        z
          .object({
            competencyId: z.uuid(),
            weight: z.number().int().min(1).max(100),
            requiredScore: z.number().int().min(1).max(100).default(70),
            learningObjective: z.string().trim().min(10).max(2000).optional(),
            learningResources: z
              .array(
                z
                  .url()
                  .max(1000)
                  .refine((url) => /^https?:\/\//.test(url), 'Use HTTP or HTTPS resources'),
              )
              .max(20)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) =>
      (v.scope === 'CORE' && !v.industryId && !v.companyId && !v.courseName) ||
      (v.scope === 'INDUSTRY' && !!v.industryId && !v.companyId && !v.courseName) ||
      (v.scope === 'COMPANY' && !!v.companyId && !v.industryId && !v.courseName) ||
      (v.scope === 'COURSE' && !!v.courseName && !v.industryId && !v.companyId),
    'Provide only the context field matching the framework scope',
  )
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
    interactionPolicy: interactionPolicySchema.default({
      cameraRequired: false,
      microphoneRequired: false,
      allowText: true,
      language: 'en',
      accommodationInstructions:
        'Contact an administrator to request an equipment exception before starting.',
    }),
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

// PATCH accepts only supplied values; creation defaults must not reactivate or reset records.
const nonempty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'Provide at least one change');
export const industryPatchSchema = nonempty({
  name: industrySchema.shape.name.optional(),
  description: industrySchema.shape.description.optional(),
  active: z.boolean().optional(),
});
export const companyPatchSchema = nonempty({
  name: companySchema.shape.name.optional(),
  description: companySchema.shape.description.optional(),
  website: companySchema.shape.website,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  active: z.boolean().optional(),
  industryIds: companySchema.shape.industryIds.optional(),
});
export const institutionPatchSchema = nonempty({
  name: institutionSchema.shape.name.optional(),
  type: z.enum(institutionTypes).optional(),
  offersTvet: z.boolean().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  website: institutionSchema.shape.website,
  active: z.boolean().optional(),
});
export const rolePatchSchema = nonempty({
  title: roleSchema.shape.title.optional(),
  description: roleSchema.shape.description.optional(),
  active: z.boolean().optional(),
  industryIds: roleSchema.shape.industryIds.optional(),
});
