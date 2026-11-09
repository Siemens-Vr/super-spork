import type { PrismaClient } from '../src/generated/prisma/client.js';
import { prisma } from '../src/config/prisma.js';
import { industryCatalogue } from './seed-industries.js';
import source from './data/east-african-companies.json' with { type: 'json' };

export const companyCatalogue = source;

export function normalizeCompanyName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en');
}

export async function seedCompanies(client: PrismaClient = prisma) {
  return client.$transaction(async (tx) => {
    const names = new Set<string>();
    const knownIndustries = new Set(industryCatalogue.map((industry) => industry.name));
    for (const company of companyCatalogue.companies) {
      const key = normalizeCompanyName(company.name);
      if (names.has(key)) throw new Error(`Duplicate company in seed: ${company.name}`);
      names.add(key);
      if (
        !company.industryNames.length ||
        company.industryNames.some((name) => !knownIndustries.has(name))
      )
        throw new Error(`Unknown or missing industries for ${company.name}`);
    }

    const existing = await tx.company.findMany({ select: { id: true, name: true } });
    const matches = new Map<string, (typeof existing)[number]>();
    for (const company of existing) {
      const key = normalizeCompanyName(company.name);
      if (!names.has(key)) continue;
      if (matches.has(key)) throw new Error(`Ambiguous existing company: ${company.name}`);
      matches.set(key, company);
    }

    await tx.industry.createMany({ data: industryCatalogue, skipDuplicates: true });
    const industries = await tx.industry.findMany({ select: { id: true, name: true } });
    const industryIds = new Map(industries.map((industry) => [industry.name, industry.id]));
    const inserted = await tx.company.createMany({
      data: companyCatalogue.companies
        .filter((company) => !matches.has(normalizeCompanyName(company.name)))
        .map(({ name, description, website, country }) => ({
          name,
          description,
          website,
          country,
        })),
      skipDuplicates: true,
    });
    const added = await tx.company.findMany({
      where: { name: { in: companyCatalogue.companies.map((company) => company.name) } },
      select: { id: true, name: true },
    });
    for (const company of added) matches.set(normalizeCompanyName(company.name), company);

    const links = await tx.companyIndustry.createMany({
      data: companyCatalogue.companies.flatMap((company) => {
        const companyId = matches.get(normalizeCompanyName(company.name))!.id;
        return company.industryNames.map((name) => ({
          companyId,
          industryId: industryIds.get(name)!,
        }));
      }),
      skipDuplicates: true,
    });
    return {
      catalogueSize: companyCatalogue.companies.length,
      created: inserted.count,
      industryLinksCreated: links.count,
    };
  });
}

if (
  process.argv[1]?.endsWith('/seed-companies.ts') ||
  process.argv[1]?.endsWith('/seed-companies.js')
) {
  try {
    console.log(JSON.stringify(await seedCompanies()));
  } finally {
    await prisma.$disconnect();
  }
}
