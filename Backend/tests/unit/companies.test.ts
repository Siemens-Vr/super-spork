import { describe, expect, it } from 'vitest';
import { companyCatalogue, normalizeCompanyName } from '../../prisma/seed-companies.js';
import { industryCatalogue } from '../../prisma/seed-industries.js';

describe('company catalogue integrity', () => {
  it('contains unique employers with country and source information', () => {
    const rows = companyCatalogue.companies;
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => normalizeCompanyName(row.name))).size).toBe(rows.length);
    expect([...new Set(rows.map((row) => row.country))].sort()).toEqual(['KE', 'RW', 'TZ', 'UG']);
    expect(companyCatalogue.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const row of rows) {
      expect(row.description.length).toBeGreaterThan(20);
      expect(new URL(row.website).protocol).toBe('https:');
      expect(row.sourceUrls.length).toBeGreaterThan(0);
      for (const url of row.sourceUrls) expect(new URL(url).protocol).toBe('https:');
      expect(row.name).not.toMatch(/demonstration|example/i);
    }
  });

  it('covers all agreed industries using valid, distinct mappings', () => {
    const names = industryCatalogue.map((row) => row.name);
    const covered = new Set<string>();
    for (const row of companyCatalogue.companies) {
      expect(row.industryNames.length).toBeGreaterThan(0);
      expect(new Set(row.industryNames).size).toBe(row.industryNames.length);
      for (const name of row.industryNames) {
        expect(names).toContain(name);
        covered.add(name);
      }
    }
    expect([...covered].sort()).toEqual(names.sort());
    expect(normalizeCompanyName('  KENYA   Airways  ')).toBe(normalizeCompanyName('Kenya Airways'));
  });
});
