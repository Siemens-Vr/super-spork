import { describe, it, expect } from 'vitest';
import { registerSchema, resetSchema, phone } from '../../src/validators/auth.schema.js';
import { careerSchema } from '../../src/validators/career.schema.js';
import { reviewSchema } from '../../src/validators/document.schema.js';
import { generateSlots } from '../../src/services/scheduling.service.js';
import { encrypt, decrypt, verifier } from '../../src/utils/crypto.js';
import { loadEnv } from '../../src/config/env.js';
const uuid = () => crypto.randomUUID();
describe('validation and cryptographic protections', () => {
  it('normalizes Kenyan phone numbers', () =>
    expect(phone.parse('0712345678')).toBe('+254712345678'));
  it('rejects invalid phone numbers', () => expect(() => phone.parse('1234')).toThrow());
  const registration = {
    legalName: 'Example Applicant',
    email: 'applicant@example.test',
    phone: '0712345678',
    password: 'a long safe passphrase',
    passwordConfirmation: 'a long safe passphrase',
    consentVersion: '2026-11-01',
  };
  it('prevents choosing authorization roles during registration', () =>
    expect(registerSchema.safeParse({ ...registration, role: 'ADMIN' }).success).toBe(false));
  it('requires password confirmation', () =>
    expect(
      registerSchema.safeParse({ ...registration, passwordConfirmation: 'not matching at all' })
        .success,
    ).toBe(false));
  it.each([7, 8])(
    'checks the password minimum at %i characters for registration and reset',
    (length) => {
      const fields = { password: 'x'.repeat(length), passwordConfirmation: 'x'.repeat(length) };
      expect(registerSchema.safeParse({ ...registration, ...fields }).success).toBe(length >= 8);
      expect(
        resetSchema.safeParse({ email: registration.email, code: '123456', ...fields }).success,
      ).toBe(length >= 8);
    },
  );
  it('supports long passphrases', () =>
    expect(
      registerSchema.safeParse({
        ...registration,
        password: 'x'.repeat(128),
        passwordConfirmation: 'x'.repeat(128),
      }).success,
    ).toBe(true));
  it('limits industries to three', () =>
    expect(
      careerSchema.safeParse({
        industryIds: [uuid(), uuid(), uuid(), uuid()],
        companyIds: [],
        primaryRoleId: uuid(),
      }).success,
    ).toBe(false));
  it('limits companies to three', () =>
    expect(
      careerSchema.safeParse({
        industryIds: [uuid()],
        companyIds: [uuid(), uuid(), uuid(), uuid()],
        primaryRoleId: uuid(),
      }).success,
    ).toBe(false));
  it('rejects duplicate preferences', () => {
    const id = uuid();
    expect(
      careerSchema.safeParse({ industryIds: [id, id], companyIds: [], primaryRoleId: uuid() })
        .success,
    ).toBe(false);
  });
  it('does not permit AI to authenticate a credential', () =>
    expect(
      reviewSchema.safeParse({
        outcome: 'AUTHENTICATED',
        method: 'AI_ASSISTED',
        reason: 'Looks plausible in the image',
        evidenceReference: 'AI-only signal',
      }).success,
    ).toBe(false));
  it('requires independent evidence for authentication', () =>
    expect(
      reviewSchema.safeParse({
        outcome: 'AUTHENTICATED',
        method: 'MANUAL',
        reason: 'Name matches on a screenshot',
      }).success,
    ).toBe(false));
  it('encrypts and authenticates sensitive values', () => {
    const encrypted = encrypt('private identity number');
    expect(encrypted).not.toContain('private');
    expect(decrypt(encrypted)).toBe('private identity number');
    const parts = encrypted.split('.');
    parts[2] = Buffer.alloc(16).toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('uses purpose-bound verifiers', () =>
    expect(verifier('EMAIL_VERIFICATION:123456')).not.toBe(verifier('PASSWORD_RESET:123456')));
  it('rejects insecure production configuration', () =>
    expect(() =>
      loadEnv({ ...process.env, NODE_ENV: 'production', APP_URL: 'http://insecure.test' }),
    ).toThrow());
  it('generates exact slots and drops an incomplete remainder', () => {
    const slots = generateSlots(
      new Date('2026-12-01T09:00:00+03:00'),
      new Date('2026-12-01T11:30:00+03:00'),
      60,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0]?.startsAt.toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit' }).format(
        slots[0]!.startsAt,
      ),
    ).toBe('09');
  });
});
