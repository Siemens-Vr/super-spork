import type { RequestHandler } from 'express';
import type { z } from 'zod';
export function validate(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}
