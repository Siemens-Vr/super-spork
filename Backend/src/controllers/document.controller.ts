import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import * as s from '../services/document.service.js';
import {
  academicDocumentRules,
  documentSchema,
  metadataSchema,
} from '../validators/document.schema.js';
import { uuid } from '../validators/auth.schema.js';
import { requireCondition } from '../errors/app-error.js';
import { env } from '../config/env.js';
import { audit } from '../utils/audit.js';
import { listDocuments } from '../services/document-list.service.js';
export const requirements: RequestHandler = (_req, res) => {
  res.json({
    data: {
      categories: [
        {
          category: 'NATIONAL_ID',
          label: 'National ID',
          institutionRequired: false,
          requiredFields: [],
          transcriptsRequired: false,
        },
        {
          category: 'PASSPORT',
          label: 'Passport',
          institutionRequired: false,
          requiredFields: [],
          transcriptsRequired: false,
        },
        ...Object.entries(academicDocumentRules).map(([category, rules]) => ({
          category,
          ...rules,
        })),
      ],
      maxFileBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
      maxTotalBytes: env.MAX_UPLOAD_TOTAL_MB * 1024 * 1024,
      maxTranscripts: 5,
    },
  });
};
export function upload(identity: boolean, replacement = false): RequestHandler {
  return async (req, res) => {
    const id = replacement ? uuid.parse(req.params.id) : undefined;
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    res.status(201).json({
      data: await s.uploadDocument(
        req.principal!.id,
        documentSchema.parse(req.body),
        files?.file?.[0],
        identity,
        id,
        files?.transcripts ?? [],
      ),
    });
  };
}
export function list(identity = false): RequestHandler {
  return async (req, res) => {
    res.json(await listDocuments(req.principal!.id, identity, req.query));
  };
}
export const get: RequestHandler = async (req, res) => {
  res.json({
    data: s.publicDocument(await s.ownedDocument(uuid.parse(req.params.id), req.principal!.id)),
  });
};
export const history: RequestHandler = async (req, res) => {
  res.json({ data: await s.verificationHistory(uuid.parse(req.params.id), req.principal!.id) });
};
export const patch: RequestHandler = async (req, res) => {
  const input = metadataSchema.parse(req.body),
    id = uuid.parse(req.params.id);
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Document" WHERE id=${id}::uuid FOR UPDATE`;
    const d = await tx.document.findFirst({
      where: { id, applicantId: req.principal!.id },
      include: { replacement: true },
    });
    requireCondition(d, 404, 'NOT_FOUND', 'Document not found');
    requireCondition(
      d.status === 'UPLOADED' && !d.replacement,
      409,
      'REPLACEMENT_REQUIRED',
      'Submit a replacement to change a reviewed document',
    );
    const updated = await tx.document.update({ where: { id }, data: input });
    await audit(tx, req.principal!.id, 'document.metadata_updated', id);
    return updated;
  });
  res.json({ data: s.publicDocument(result) });
};
export function download(asAdmin = false): RequestHandler {
  return async (req, res) => {
    const id = uuid.parse(req.params.id);
    const d = await s.downloadDocument(id, req.principal!.id, asAdmin);
    res
      .set({
        'Content-Type': d.mimeType,
        'Content-Disposition': `attachment; filename="document-${id}.${d.mimeType === 'application/pdf' ? 'pdf' : d.mimeType === 'image/png' ? 'png' : 'jpg'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(d.buffer);
  };
}
export function evidence(asAdmin = false): RequestHandler {
  return async (req, res) => {
    res.status(201).json({
      data: await s.addEvidence(uuid.parse(req.params.id), req.principal!.id, req.body, asAdmin),
    });
  };
}
