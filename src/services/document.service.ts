import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { z } from 'zod';
import { prisma, userLock } from '../config/prisma.js';
import { storage } from '../config/storage.js';
import { documentSchema, identityCategories, reviewSchema } from '../validators/document.schema.js';
import { requireCondition } from '../errors/app-error.js';
import { encrypt } from '../utils/crypto.js';
import { audit } from '../utils/audit.js';
import { notify } from './email.service.js';
import type { Document, VerificationStatus } from '../generated/prisma/client.js';
export const isIdentity = (category: string) => identityCategories.some((c) => c === category);
export function publicDocument(d: Document) {
  return {
    id: d.id,
    category: d.category,
    title: d.title,
    issuer: d.issuer,
    institutionId: d.institutionId,
    issuedAt: d.issuedAt,
    expiresAt: d.expiresAt,
    verificationUrl: d.verificationUrl,
    mimeType: d.mimeType,
    size: d.size,
    scanStatus: d.scanStatus,
    status: d.status,
    replacesId: d.replacesId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
export async function ownedDocument(id: string, applicantId: string) {
  const d = await prisma.document.findFirst({ where: { id, applicantId } });
  requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
  return d;
}
export async function uploadDocument(
  applicantId: string,
  input: z.infer<typeof documentSchema>,
  file: Express.Multer.File | undefined,
  identityOnly: boolean,
  replacesId?: string,
) {
  requireCondition(file, 422, 'FILE_REQUIRED', 'Attach one document file');
  requireCondition(
    isIdentity(input.category) === identityOnly,
    422,
    'INVALID_DOCUMENT_CATEGORY',
    'Use the appropriate identity or academic upload endpoint',
  );
  const detected = await fileTypeFromBuffer(file.buffer);
  requireCondition(
    detected &&
      ['application/pdf', 'image/jpeg', 'image/png'].includes(detected.mime) &&
      detected.mime === file.mimetype,
    415,
    'INVALID_FILE_TYPE',
    'Only matching PDF, JPEG, and PNG files are accepted',
  );
  const key = `quarantine/${randomUUID()}`;
  await storage.put(key, file.buffer, detected.mime);
  try {
    return await prisma.$transaction(async (tx) => {
      await userLock(tx, applicantId);
      if (!identityOnly)
        requireCondition(
          await tx.document.count({
            where: {
              applicantId,
              category: { in: ['NATIONAL_ID', 'PASSPORT'] },
              scanStatus: { not: 'INFECTED' },
              replacement: null,
            },
          }),
          409,
          'IDENTITY_REQUIRED',
          'Submit a National ID or passport first',
        );
      if (replacesId) {
        const previous = await tx.document.findFirst({
          where: { id: replacesId, applicantId },
          include: { replacement: true },
        });
        requireCondition(
          previous && !previous.replacement && isIdentity(previous.category) === identityOnly,
          409,
          'REPLACEMENT_INVALID',
          'Document cannot be replaced',
        );
      }
      if (input.institutionId)
        requireCondition(
          await tx.institution.findFirst({ where: { id: input.institutionId, active: true } }),
          422,
          'INSTITUTION_INVALID',
          'Institution is not available',
        );
      const { credentialNumber, ...metadata } = input;
      const d = await tx.document.create({
        data: {
          ...metadata,
          issuedAt: input.issuedAt ? new Date(input.issuedAt) : undefined,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          applicantId,
          replacesId,
          encryptedCredentialNumber: credentialNumber ? encrypt(credentialNumber) : undefined,
          storageKey: key,
          mimeType: detected.mime,
          size: file.size,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
          history: {
            create: {
              toStatus: 'UPLOADED',
              actorId: applicantId,
              reason: replacesId ? 'Replacement submitted' : 'Document submitted',
            },
          },
        },
      });
      await audit(tx, applicantId, 'document.uploaded', d.id, {
        category: d.category,
        replacesId: replacesId ?? null,
      });
      return publicDocument(d);
    });
  } catch (e) {
    await storage.remove(key).catch(() => {});
    throw e;
  }
}
export async function verificationHistory(id: string, applicantId: string) {
  await ownedDocument(id, applicantId);
  const reviews = await prisma.documentVerification.findMany({
    where: { documentId: id },
    select: { id: true, method: true, outcome: true, reason: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const history = await prisma.verificationStatusHistory.findMany({
    where: { documentId: id },
    orderBy: { createdAt: 'asc' },
    select: { fromStatus: true, toStatus: true, reason: true, createdAt: true },
  });
  const evidence = await prisma.verificationEvidence.findMany({
    where: { documentId: id, authorId: applicantId },
    select: { id: true, note: true, reference: true, createdAt: true },
  });
  return { reviews, history, evidence };
}
const transitions: Record<VerificationStatus, VerificationStatus[]> = {
  UPLOADED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['AUTHENTICATED', 'REJECTED', 'ADDITIONAL_EVIDENCE_REQUIRED'],
  ADDITIONAL_EVIDENCE_REQUIRED: ['UNDER_REVIEW', 'REJECTED'],
  AUTHENTICATED: ['UNDER_REVIEW', 'DISPUTED'],
  REJECTED: ['UNDER_REVIEW', 'DISPUTED'],
  DISPUTED: ['UNDER_REVIEW', 'REJECTED'],
};
export async function reviewDocument(
  id: string,
  actorId: string,
  input: z.infer<typeof reviewSchema>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
    const d = await tx.document.findUnique({
      where: { id },
      include: { applicant: true, replacement: true },
    });
    requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
    requireCondition(
      d.scanStatus === 'CLEAN',
      409,
      'DOCUMENT_QUARANTINED',
      'A successful malware scan is required before review',
    );
    requireCondition(!d.replacement, 409, 'DOCUMENT_SUPERSEDED', 'Review the replacement document');
    requireCondition(
      transitions[d.status].includes(input.outcome),
      409,
      'INVALID_STATUS_TRANSITION',
      'Review status transition is not allowed',
    );
    await tx.documentVerification.create({
      data: { documentId: id, reviewerId: actorId, ...input },
    });
    await tx.document.update({ where: { id }, data: { status: input.outcome } });
    await tx.verificationStatusHistory.create({
      data: {
        documentId: id,
        fromStatus: d.status,
        toStatus: input.outcome,
        actorId,
        reason: input.reason,
      },
    });
    await audit(tx, actorId, 'document.reviewed', id, {
      from: d.status,
      to: input.outcome,
      method: input.method,
    });
    await notify(
      tx,
      d.applicant.email,
      'Document review update',
      `The review status for ${d.title} is ${input.outcome}. ${input.reason}`,
    );
    return { id, status: input.outcome };
  });
}
export async function addEvidence(
  id: string,
  actorId: string,
  input: { note: string; reference?: string },
  asAdmin = false,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
    const d = await tx.document.findFirst({
      where: { id, ...(!asAdmin ? { applicantId: actorId } : {}) },
      include: { replacement: true },
    });
    requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
    requireCondition(
      !d.replacement,
      409,
      'DOCUMENT_SUPERSEDED',
      'Respond on the replacement document',
    );
    if (!asAdmin)
      requireCondition(
        ['ADDITIONAL_EVIDENCE_REQUIRED', 'DISPUTED', 'REJECTED'].includes(d.status),
        409,
        'EVIDENCE_NOT_REQUESTED',
        'Evidence can be submitted after a review request or dispute',
      );
    const record = await tx.verificationEvidence.create({
      data: { documentId: id, authorId: actorId, ...input },
    });
    if (!asAdmin) {
      await tx.document.update({ where: { id }, data: { status: 'UNDER_REVIEW' } });
      await tx.verificationStatusHistory.create({
        data: {
          documentId: id,
          fromStatus: d.status,
          toStatus: 'UNDER_REVIEW',
          actorId,
          reason: 'Applicant submitted additional evidence',
        },
      });
    }
    await audit(tx, actorId, 'document.evidence_added', id);
    return record;
  });
}
export async function downloadDocument(id: string, actorId: string, asAdmin = false) {
  const d = await prisma.document.findFirst({
    where: { id, ...(!asAdmin ? { applicantId: actorId } : {}) },
  });
  requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
  requireCondition(
    d.scanStatus === 'CLEAN',
    409,
    'DOCUMENT_QUARANTINED',
    'Document is not available until it passes malware scanning',
  );
  const buffer = await storage.get(d.storageKey);
  requireCondition(
    createHash('sha256').update(buffer).digest('hex') === d.sha256,
    503,
    'DOCUMENT_INTEGRITY_FAILED',
    'Document integrity check failed',
  );
  await audit(prisma, actorId, 'document.downloaded', id);
  return { buffer, mimeType: d.mimeType };
}
