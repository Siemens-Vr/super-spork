import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { logger } from '../../src/config/logger.js';

afterEach(() => vi.restoreAllMocks());

describe('database error diagnostics', () => {
  it('logs the Prisma code without exposing credentials or database internals', () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('password authentication failed: private-password'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P1000',
      meta: { connectionString: 'postgresql://user:private-password@localhost/database' },
    });
    const req = { correlationId: 'session-diagnostic' } as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    errorHandler(error, req, res as unknown as Response, vi.fn());

    expect(log).toHaveBeenCalledWith(
      {
        requestId: 'session-diagnostic',
        errorType: 'PrismaClientKnownRequestError',
        prismaCode: 'P1000',
      },
      'Request failed',
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The request could not be completed',
        requestId: 'session-diagnostic',
      },
    });
  });
});
