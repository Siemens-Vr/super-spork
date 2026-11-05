import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const phone = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const p = parsePhoneNumberFromString(value, 'KE');
    if (!p?.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
      return z.NEVER;
    }
    return p.number;
  });
export const password = z.string().min(8).max(128);
export const registerSchema = z
  .object({
    legalName: z.string().trim().min(3).max(150),
    email,
    phone,
    password,
    passwordConfirmation: password,
    consentVersion: z.string().min(1).max(40),
  })
  .strict()
  .refine((v) => v.password === v.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Passwords must match',
  });
export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const emailSchema = z.object({ email }).strict();
export const codeSchema = z.object({ email, code: z.string().regex(/^\d{6}$/) }).strict();
export const resetSchema = z
  .object({ email, code: z.string().regex(/^\d{6}$/), password, passwordConfirmation: password })
  .strict()
  .refine((v) => v.password === v.passwordConfirmation, {
    path: ['passwordConfirmation'],
    message: 'Passwords must match',
  });
export const mfaSchema = z.object({ code: z.string().min(6).max(64) }).strict();
export const reauthSchema = z.object({ password: z.string().min(1).max(128) }).strict();
export const googleCompleteSchema = z
  .object({ phone, consentVersion: z.string().min(1).max(40) })
  .strict();
export const uuid = z.uuid();
