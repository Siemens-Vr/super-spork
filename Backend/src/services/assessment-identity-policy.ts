import type { Document, Prisma } from '../generated/prisma/client.js';

// Apply this filter before evaluating identity status so superseded files never qualify.
export const currentAssessmentDocuments = { replacement: null } satisfies Prisma.DocumentWhereInput;
type IdentityDocument = Pick<Document, 'id' | 'category' | 'status' | 'scanStatus'>;
type IdentityBlocker =
  'IDENTITY_REJECTED' | 'IDENTITY_SUBMISSION_REQUIRED' | 'IDENTITY_AUTHENTICATION_REQUIRED';

export const identityMessages: Record<IdentityBlocker, string> = {
  IDENTITY_REJECTED:
    'Your identity document was rejected. Review the verification feedback and upload a replacement or provide the requested evidence.',
  IDENTITY_SUBMISSION_REQUIRED:
    'A current clean identity meeting the verification policy is required. Upload a National ID or passport and wait for its malware scan to pass.',
  IDENTITY_AUTHENTICATION_REQUIRED:
    'Your current identity document needs human verification before this assessment.',
};

export function assessmentIdentityReadiness(
  documents: readonly IdentityDocument[],
  requiresAuthenticatedIdentity = false,
) {
  const identities = documents.filter((document) =>
    ['NATIONAL_ID', 'PASSPORT'].includes(document.category),
  );
  const nonRejected = identities.filter((document) => document.status !== 'REJECTED');
  const usable = nonRejected.filter((document) => document.scanStatus === 'CLEAN');
  let reason: IdentityBlocker | null = null;
  if (
    !usable.some(
      (document) => !requiresAuthenticatedIdentity || document.status === 'AUTHENTICATED',
    )
  ) {
    if (usable.length) reason = 'IDENTITY_AUTHENTICATION_REQUIRED';
    else if (!nonRejected.length && identities.length) reason = 'IDENTITY_REJECTED';
    else reason = 'IDENTITY_SUBMISSION_REQUIRED';
  }
  return {
    reason,
    message: reason ? identityMessages[reason] : '',
    recovery: reason === 'IDENTITY_REJECTED' ? { documentId: identities[0]!.id } : null,
  };
}
