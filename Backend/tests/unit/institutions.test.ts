import { describe, expect, it } from 'vitest';
import { institutionCatalogue, normalizeInstitutionName } from '../../prisma/seed-institutions.js';
import { institutionQuery } from '../../src/validators/institution.schema.js';

describe('institution catalogue integrity', () => {
  it('contains unique Kenyan institutions and retains the source revision', () => {
    const rows = institutionCatalogue.institutions;
    expect(rows).toHaveLength(313);
    expect(new Set(rows.map((row) => normalizeInstitutionName(row.name))).size).toBe(rows.length);
    expect(rows.every((row) => row.country === 'KE')).toBe(true);
    expect(rows.some((row) => row.name === 'Teachers College' || row.name.includes('Uganda'))).toBe(
      false,
    );
    expect(institutionCatalogue.sourceUrl).toContain('oldid=1375901675');
  });
  it('supports common abbreviations, institution types and TVET entries', () => {
    expect(
      institutionCatalogue.institutions.find(
        (row) => row.name === 'Jomo Kenyatta University of Agriculture and Technology',
      )?.aliases,
    ).toContain('JKUAT');
    expect(
      institutionCatalogue.institutions.find((row) => row.name === 'Kabete National Polytechnic')
        ?.offersTvet,
    ).toBe(true);
    expect(normalizeInstitutionName('St. Paul’s University')).toBe(
      normalizeInstitutionName("St Paul's University"),
    );
  });
  it('validates type and TVET filters without treating false as true', () => {
    expect(institutionQuery.parse({ offersTvet: 'false', type: 'COLLEGE' }).offersTvet).toBe(false);
    expect(institutionQuery.parse({ offersTvet: 'true' }).offersTvet).toBe(true);
    expect(institutionQuery.safeParse({ type: 'invalid' }).success).toBe(false);
    expect(institutionQuery.safeParse({ offersTvet: 'invalid' }).success).toBe(false);
  });
});
