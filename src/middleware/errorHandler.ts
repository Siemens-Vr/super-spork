import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../errors/app-error.js';
import { logger } from '../config/logger.js';
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let status = 500,
    code = 'INTERNAL_ERROR',
    message = 'The request could not be completed',
    details: unknown;
  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Check the submitted fields';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof multer.MulterError) {
    status = 413;
    code = 'UPLOAD_REJECTED';
    message = 'Upload exceeds the permitted size or file count';
  } else if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    ['P2002', 'P2003', 'P2025', 'P2034'].includes(String(err.code))
  ) {
    status = 409;
    code = 'CONFLICT';
    message = 'The resource changed or conflicts with an existing record';
  } else if (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    err.type === 'entity.too.large'
  ) {
    status = 413;
    code = 'REQUEST_TOO_LARGE';
    message = 'Request body exceeds the permitted size';
  } else if (err instanceof SyntaxError) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON body';
  }
  if (status >= 500)
    logger.error(
      { requestId: req.correlationId, errorType: err instanceof Error ? err.name : 'UnknownError' },
      'Request failed',
    );
  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}), requestId: req.correlationId },
  });
};
