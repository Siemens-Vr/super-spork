import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../config/prisma.js';
import { documentListQuery, qualificationCategories } from '../validators/document-list.schema.js';
import { documentInclude, publicDocument } from './document.service.js';

const currentDocuments: Prisma.DocumentWhereInput = {
  replacement: null,
  OR: [{ qualificationId: null }, { qualification: { replacement: null } }],
};

export async function listDocuments(applicantId: string, identity: boolean, query: unknown) {
  const { limit, cursor, eligibleForAssessment } = documentListQuery.parse(query);
  const where: Prisma.DocumentWhereInput = {
    applicantId,
    category: identity
      ? { in: ['NATIONAL_ID', 'PASSPORT'] }
      : { notIn: ['NATIONAL_ID', 'PASSPORT'] },
    ...(eligibleForAssessment
      ? {
          AND: [
            currentDocuments,
            {
              category: { in: [...qualificationCategories] },
              scanStatus: 'CLEAN',
              status: { not: 'REJECTED' },
            },
          ],
        }
      : {}),
  };
  // Counts and version flags are independent of which page the caller has loaded.
  const [rows, total, current, authenticated] = await prisma.$transaction(
    [
      prisma.document.findMany({
        where: cursor
          ? {
              AND: [
                where,
                {
                  OR: [
                    { createdAt: { lt: new Date(cursor.createdAt) } },
                    { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: documentInclude,
        take: limit + 1,
      }),
      prisma.document.count({ where }),
      prisma.document.count({ where: { AND: [where, currentDocuments] } }),
      prisma.document.count({
        where: { AND: [where, currentDocuments, { status: 'AUTHENTICATED' }] },
      }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return {
    data: data.map(publicDocument),
    meta: {
      limit,
      total,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
            ).toString('base64url')
          : null,
      summary: { current, authenticated },
    },
  };
}
