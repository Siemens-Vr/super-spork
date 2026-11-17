import { describe, expect, it } from 'vitest';
import { assessmentIdentityReadiness } from '../../src/services/assessment-identity-policy.js';

type Identity = Parameters<typeof assessmentIdentityReadiness>[0][number];
const identity = (overrides: Partial<Identity> = {}): Identity => ({
  id: 'identity',
  category: 'NATIONAL_ID',
  scanStatus: 'CLEAN',
  status: 'UNDER_REVIEW',
  ...overrides,
});

describe('assessment identity readiness', () => {
  it('rejects a clean rejected identity and returns its recovery document', () => {
    for (const authenticated of [false, true]) {
      expect(
        assessmentIdentityReadiness([identity({ status: 'REJECTED' })], authenticated),
      ).toMatchObject({
        reason: 'IDENTITY_REJECTED',
        recovery: { documentId: 'identity' },
      });
    }
  });
  it('accepts a valid alternative identity without treating the whole applicant as rejected', () => {
    const documents = [
      identity({ status: 'REJECTED' }),
      identity({ id: 'passport', category: 'PASSPORT', status: 'AUTHENTICATED' }),
    ];
    expect(assessmentIdentityReadiness(documents, true)).toMatchObject({
      reason: null,
      recovery: null,
    });
  });
  it('allows clean pending review only when authentication is optional', () => {
    expect(assessmentIdentityReadiness([identity()]).reason).toBeNull();
    expect(assessmentIdentityReadiness([identity()], true).reason).toBe(
      'IDENTITY_AUTHENTICATION_REQUIRED',
    );
  });
  it.each(['QUARANTINED', 'FAILED', 'INFECTED'] as const)(
    'rejects a %s identity even when authenticated',
    (scanStatus) => {
      expect(
        assessmentIdentityReadiness([identity({ scanStatus, status: 'AUTHENTICATED' })]).reason,
      ).toBe('IDENTITY_SUBMISSION_REQUIRED');
    },
  );
  it('does not mistake academic documents for identities or blame a pending alternative identity', () => {
    expect(
      assessmentIdentityReadiness([identity({ category: 'BACHELOR', status: 'AUTHENTICATED' })])
        .reason,
    ).toBe('IDENTITY_SUBMISSION_REQUIRED');
    expect(
      assessmentIdentityReadiness([
        identity({ status: 'REJECTED' }),
        identity({ id: 'pending-passport', category: 'PASSPORT', scanStatus: 'QUARANTINED' }),
      ]),
    ).toMatchObject({ reason: 'IDENTITY_SUBMISSION_REQUIRED', recovery: null });
  });
});
