import { z } from 'zod';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { prisma } from '../src/config/prisma.js';
import { institutionTypes } from '../src/validators/institution.schema.js';
import source from './data/kenyan-institutions.json' with { type: 'json' };

export const institutionCatalogue = z
  .object({
    sourceUrl: z.url(),
    retrievedAt: z.iso.date(),
    institutions: z.array(
      z.object({
        name: z.string().trim().min(2).max(200),
        type: z.enum(institutionTypes),
        country: z.literal('KE'),
        offersTvet: z.boolean(),
        aliases: z.array(z.string().trim().min(2).max(200)),
      }),
    ),
  })
  .parse(source);

export function normalizeInstitutionName(name: string) {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export async function seedInstitutions(client: PrismaClient = prisma) {
  return client.$transaction(
    async (tx) => {
      const existing = await tx.institution.findMany({ where: { country: 'KE' } });
      const byName = new Map(existing.map((row) => [normalizeInstitutionName(row.name), row]));
      let created = 0;
      for (const entry of institutionCatalogue.institutions) {
        const matches = [
          ...new Map(
            [entry.name, ...entry.aliases]
              .map((name) => byName.get(normalizeInstitutionName(name)))
              .filter((row) => row !== undefined)
              .map((row) => [row.id, row] as const),
          ).values(),
        ];
        if (matches.length > 1)
          throw new Error(
            `Multiple existing institutions match ${entry.name}; review before importing`,
          );
        const match = matches[0];
        const record = match
          ? await tx.institution.update({
              where: { id: match.id },
              data: {
                ...(match.type === 'OTHER' ? { type: entry.type } : {}),
                ...(!match.offersTvet && entry.offersTvet ? { offersTvet: true } : {}),
                ...(!match.sourceUrl ? { sourceUrl: institutionCatalogue.sourceUrl } : {}),
              },
            })
          : await tx.institution.create({
              data: {
                name: entry.name,
                type: entry.type,
                country: entry.country,
                offersTvet: entry.offersTvet,
                sourceUrl: institutionCatalogue.sourceUrl,
              },
            });
        if (!match) created++;
        byName.set(normalizeInstitutionName(entry.name), record);
        const aliases = new Map(
          [entry.name, ...entry.aliases].map((name) => [normalizeInstitutionName(name), name]),
        );
        aliases.delete(normalizeInstitutionName(record.name));
        await tx.institutionAlias.createMany({
          data: [...aliases.values()].map((name) => ({ institutionId: record.id, name })),
          skipDuplicates: true,
        });
      }
      return { catalogueSize: institutionCatalogue.institutions.length, created };
    },
    { timeout: 60000 },
  );
}

if (
  process.argv[1]?.endsWith('/seed-institutions.ts') ||
  process.argv[1]?.endsWith('/seed-institutions.js')
) {
  try {
    console.log(JSON.stringify(await seedInstitutions()));
  } finally {
    await prisma.$disconnect();
  }
}
