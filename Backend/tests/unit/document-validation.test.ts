import { describe, expect, it } from 'vitest';
import {
  academicDocumentRules,
  documentSchema,
  metadataSchema,
} from '../../src/validators/document.schema.js';

describe('category-specific document metadata', () => {
  it.each(['BACHELOR', 'MASTER', 'PHD', 'DIPLOMA'])(
    'does not require issue or expiry dates for %s',
    (category) => {
      const input = {
        category,
        courseName: 'Mechatronics Engineering',
        institutionName: 'Engineering University',
      };
      for (const dates of [
        {},
        { issuedAt: '', expiresAt: '' },
        { issuedAt: ' \t ', expiresAt: '  ' },
        { issuedAt: null, expiresAt: null },
      ]) {
        const parsed = documentSchema.parse({ ...input, ...dates });
        expect(parsed.issuedAt).toBeUndefined();
        expect(parsed.expiresAt).toBeUndefined();
      }
      expect(
        documentSchema.parse({ ...input, issuedAt: ' 2025-12-01 ', expiresAt: '' }).issuedAt,
      ).toBe('2025-12-01');
      const invalid = documentSchema.safeParse({ ...input, issuedAt: 'string' });
      expect(invalid.success).toBe(false);
      if (!invalid.success) expect(invalid.error.issues[0]?.message).toContain('YYYY-MM-DD');
    },
  );
  it.each(['NATIONAL_ID', 'PASSPORT'])('keeps %s metadata minimal', (category) => {
    expect(documentSchema.safeParse({ category }).success).toBe(true);
  });
  it.each(['BACHELOR', 'MASTER', 'DIPLOMA', 'PHD', 'TRANSCRIPT'])(
    'requires course and selected or typed institution for %s',
    (category) => {
      const input = { category, courseName: 'Mechatronics Engineering' };
      expect(documentSchema.safeParse(input).success).toBe(false);
      expect(documentSchema.safeParse({ ...input, institutionName: 'New College' }).success).toBe(
        true,
      );
      expect(
        documentSchema.safeParse({
          ...input,
          institutionId: crypto.randomUUID(),
          institutionName: '',
        }).success,
      ).toBe(true);
      expect(documentSchema.safeParse({ ...input, institutionName: '  ' }).success).toBe(false);
      expect(documentSchema.safeParse({ category, institutionName: 'New College' }).success).toBe(
        false,
      );
    },
  );
  it('allows short courses without an institution but requires a course name', () => {
    expect(
      documentSchema.safeParse({ category: 'SHORT_COURSE', courseName: 'Software Engineering' })
        .success,
    ).toBe(true);
    expect(documentSchema.safeParse({ category: 'SHORT_COURSE', courseName: '  ' }).success).toBe(
      false,
    );
  });
  it('rejects conflicting institution selections for every category', () => {
    expect(
      documentSchema.safeParse({
        category: 'SHORT_COURSE',
        courseName: 'Software Engineering',
        institutionId: crypto.randomUUID(),
        institutionName: 'Other College',
      }).success,
    ).toBe(false);
  });
  it('requires professional body, issue date and expiry date', () => {
    const input = {
      category: 'PROFESSIONAL_REGISTRATION',
      issuer: 'Engineering Board',
      issuedAt: '2026-01-01',
      expiresAt: '2028-12-31',
    };
    expect(documentSchema.safeParse(input).success).toBe(true);
    for (const field of ['issuer', 'issuedAt', 'expiresAt'] as const) {
      const result = documentSchema.safeParse({ ...input, [field]: '' });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
    expect(documentSchema.safeParse({ ...input, expiresAt: '2028-02-30' }).success).toBe(false);
    expect(documentSchema.safeParse({ ...input, expiresAt: '2025-12-31' }).success).toBe(false);
  });
  it('requires the industry certification name and issuer, with optional expiry', () => {
    const input = {
      category: 'INDUSTRY_CERTIFICATION',
      certificationName: 'Certified Automation Professional',
      issuer: 'Automation Institute',
      issuedAt: '2026-01-01',
    };
    expect(documentSchema.safeParse(input).success).toBe(true);
    expect(documentSchema.safeParse({ ...input, certificationName: '' }).success).toBe(false);
    expect(documentSchema.safeParse({ ...input, issuer: '' }).success).toBe(false);
    expect(documentSchema.safeParse({ ...input, issuedAt: '' }).success).toBe(false);
  });
  it('requires a descriptive title for OTHER', () => {
    expect(documentSchema.safeParse({ category: 'OTHER' }).success).toBe(false);
    expect(
      documentSchema.safeParse({ category: 'OTHER', title: 'Engineering award' }).success,
    ).toBe(true);
  });
  it('prevents metadata edits from clearing a required professional issuer', () => {
    expect(metadataSchema.safeParse({ title: 'Professional licence', issuer: '  ' }).success).toBe(
      false,
    );
  });
  it('accepts blank optional Swagger fields without weakening required fields', () => {
    const result = documentSchema.parse({
      category: 'SHORT_COURSE',
      courseName: 'Software Engineering',
      institutionId: '',
      institutionName: '',
      issuedAt: '',
      expiresAt: '',
      issuer: '',
      certificationName: '',
      verificationUrl: '',
    });
    expect(result.institutionId).toBeUndefined();
    expect(result.verificationUrl).toBeUndefined();
  });
  it('requires transcript attachments only for the four qualification categories', () => {
    expect(
      Object.entries(academicDocumentRules)
        .filter(([, rule]) => rule.transcriptsRequired)
        .map(([category]) => category)
        .sort(),
    ).toEqual(['BACHELOR', 'DIPLOMA', 'MASTER', 'PHD']);
  });
});
