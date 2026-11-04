import 'express-session';
import type { Principal } from '../middleware/authenticate.js';
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    sessionVersion?: number;
    csrf?: string;
    authenticatedAt?: number;
    mfaAt?: number;
    oauth?: {
      state: string;
      nonce: string;
      verifier: string;
      createdAt: number;
      linkUserId?: string;
    };
    pendingGoogle?: { subject: string; email: string; name: string; createdAt: number };
  }
}
declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
      correlationId: string;
    }
  }
}
