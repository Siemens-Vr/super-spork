import { describe, expect, it } from 'vitest';
import { documentSchema } from '../../src/validators/document.schema.js';

describe('category-specific document metadata', () => {
  it.each(['NATIONAL_ID', 'PASSPORT'])('requires only the category for %s metadata', (category) => {
    expect(documentSchema.safeParse({ category }).success).toBe(true);
  });
  it.each(['BACHELOR', 'MASTER', 'DIPLOMA', 'PHD', 'SHORT_COURSE', 'TRANSCRIPT'])(
    'requires a selected or typed institution for %s',
    (category) => {
      expect(documentSchema.safeParse({ category }).success).toBe(false);
      expect(documentSchema.safeParse({ category, institutionName: 'New College' }).success).toBe(
        true,
      );
      expect(
        documentSchema.safeParse({
          category,
          institutionId: crypto.randomUUID(),
          institutionName: '',
        }).success,
      ).toBe(true);
      expect(documentSchema.safeParse({ category, institutionName: '  ' }).success).toBe(false);
    },
  );
  it('rejects conflicting institution selections', () => {
    expect(
      documentSchema.safeParse({
        category: 'SHORT_COURSE',
        institutionId: crypto.randomUUID(),
        institutionName: 'Other College',
      }).success,
    ).toBe(false);
  });
  it.each(['INDUSTRY_CERTIFICATION', 'PROFESSIONAL_REGISTRATION'])(
    'requires expiry for %s and accepts a calendar date',
    (category) => {
      const input = { category, institutionName: 'Professional Institute' };
      expect(documentSchema.safeParse(input).success).toBe(false);
      expect(documentSchema.safeParse({ ...input, expiresAt: '2028-12-31' }).success).toBe(true);
      expect(documentSchema.safeParse({ ...input, expiresAt: '2028-02-30' }).success).toBe(false);
      expect(
        documentSchema.safeParse({ ...input, issuedAt: '2028-12-31', expiresAt: '2028-01-01' })
          .success,
      ).toBe(false);
    },
  );
});
