import { z } from 'zod';
import { pagination } from './career.schema.js';

export const institutionTypes = ['UNIVERSITY', 'COLLEGE', 'TRAINING_INSTITUTE', 'OTHER'] as const;
export const institutionQuery = pagination.extend({
  type: z.enum(institutionTypes).optional(),
  offersTvet: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
