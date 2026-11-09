import type { PrismaClient } from '../src/generated/prisma/client.js';
import { prisma } from '../src/config/prisma.js';
import source from './data/engineering-industries.json' with { type: 'json' };

export const industryCatalogue = source;

export async function seedIndustries(client: PrismaClient = prisma) {
  const result = await client.industry.createMany({
    data: industryCatalogue,
    skipDuplicates: true,
  });
  return { catalogueSize: industryCatalogue.length, created: result.count };
}

if (
  process.argv[1]?.endsWith('/seed-industries.ts') ||
  process.argv[1]?.endsWith('/seed-industries.js')
) {
  try {
    console.log(JSON.stringify(await seedIndustries()));
  } finally {
    await prisma.$disconnect();
  }
}
