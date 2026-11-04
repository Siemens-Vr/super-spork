import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import * as v from '../validators/auth.schema.js';
import { validate } from '../middleware/validate.js';
import { authenticate, admin } from '../middleware/authenticate.js';
import { csrfToken, rateLimit } from '../middleware/security.js';
export const authRouter = Router();
authRouter.get('/csrf', csrfToken);
authRouter.post(
  '/register',
  rateLimit('register-ip', 12, 900),
  rateLimit('register-account', 4, 900, true),
  validate(v.registerSchema),
  c.register,
);
authRouter.post(
  '/login',
  rateLimit('login-ip', 30, 900),
  rateLimit('login-account', 10, 900, true),
  validate(v.loginSchema),
  c.login,
);
authRouter.post(
  '/verify-email',
  rateLimit('verify-ip', 30, 900),
  rateLimit('verify-account', 10, 900, true),
  validate(v.codeSchema),
  c.verifyEmail,
);
authRouter.post(
  '/resend-verification',
  rateLimit('resend-ip', 20, 900),
  rateLimit('resend-account', 4, 900, true),
  validate(v.emailSchema),
  c.requestCode('EMAIL_VERIFICATION'),
);
authRouter.post(
  '/forgot-password',
  rateLimit('recovery-ip', 20, 900),
  rateLimit('recovery-account', 4, 900, true),
  validate(v.emailSchema),
  c.requestCode('PASSWORD_RESET'),
);
authRouter.post(
  '/reset-password',
  rateLimit('reset-ip', 30, 900),
  rateLimit('reset-account', 10, 900, true),
  validate(v.resetSchema),
  c.resetPassword,
);
authRouter.get('/google', rateLimit('google', 20, 900), c.googleStart());
authRouter.get('/google/callback', c.googleCallback);
authRouter.post('/google/complete', validate(v.googleCompleteSchema), c.completeGoogle);
authRouter.use(authenticate);
authRouter.get('/me', c.me);
authRouter.post('/logout', c.logout);
authRouter.post('/logout-all', c.logoutAll);
authRouter.get('/sessions', c.sessions);
authRouter.delete('/sessions/:id', c.revokeSession);
authRouter.post(
  '/reauthenticate',
  rateLimit('reauth', 10, 900, true),
  validate(v.reauthSchema),
  c.reauthenticate,
);
authRouter.post('/google/link', c.googleStart(true));
authRouter.post('/mfa/setup', admin, c.setupMfa);
authRouter.post(
  '/mfa/verify',
  admin,
  rateLimit('mfa', 10, 900, true),
  validate(v.mfaSchema),
  c.verifyMfa,
);
