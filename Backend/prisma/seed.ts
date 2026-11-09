import { prisma } from '../src/config/prisma.js';
import { seedInstitutions } from './seed-institutions.js';
import { seedIndustries } from './seed-industries.js';
import { seedCompanies } from './seed-companies.js';
import { seedAssessmentScenarios } from './seed-assessment-scenarios.js';
export const applicantPermissions = [
  'profile.read.self',
  'profile.update.self',
  'documents.upload.self',
  'documents.read.self',
  'assessments.schedule.self',
];
export const adminPermissions = [
  'documents.verify',
  'documents.review',
  'industries.manage',
  'companies.manage',
  'careers.manage',
  'assessments.manage',
  'assessments.review',
  'users.manage',
  'audit.read',
];
export async function seed() {
  for (const [name, permissions] of [
    ['APPLICANT', applicantPermissions],
    ['ADMIN', adminPermissions],
  ] as const) {
    const role = await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    for (const name of permissions) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }
  await seedIndustries();
  const manufacturing = await prisma.industry.findUniqueOrThrow({
    where: { name: 'Manufacturing and Industrial Production' },
  });
  const software = await prisma.industry.findUniqueOrThrow({
    where: { name: 'Software, Computing and Digital Infrastructure' },
  });
  const automotive = await prisma.industry.findUniqueOrThrow({
    where: { name: 'Automotive and Electric Mobility' },
  });
  const energy = await prisma.industry.findUniqueOrThrow({ where: { name: 'Energy and Power' } });
  for (const [index, { title, industryIds }] of [
    { title: 'PLC Programmer', industryIds: [manufacturing.id] },
    { title: 'Industrial Software Engineer', industryIds: [software.id] },
    { title: 'Mechatronics Engineer', industryIds: [manufacturing.id, energy.id, automotive.id] },
  ].entries()) {
    const role = await prisma.jobRole.upsert({
      where: { title },
      create: {
        title,
        description: `Practical engineering work as a ${title}.`,
        industries: { create: industryIds.map((industryId) => ({ industryId })) },
      },
      update: {},
    });
    // Reconcile missing seed links on older databases while preserving maintained career data.
    await prisma.jobRoleIndustry.createMany({
      data: industryIds.map((industryId) => ({ jobRoleId: role.id, industryId })),
      skipDuplicates: true,
    });
    const competencies = [];
    for (const [i, name] of [
      'Engineering fundamentals',
      'Practical problem solving',
      'Safety and professional practice',
    ].entries()) {
      const code = `${index + 1}-COMP-${i + 1}`;
      competencies.push(
        await prisma.competency.upsert({
          where: { code },
          create: {
            code,
            name,
            description: `Demonstrate ${name.toLowerCase()} through approved evidence.`,
          },
          update: {},
        }),
      );
    }
    const framework = await prisma.competencyFramework.upsert({
      where: { jobRoleId_version: { jobRoleId: role.id, version: 1 } },
      create: {
        jobRoleId: role.id,
        version: 1,
        title: `${title} competency framework`,
        approved: true,
        competencies: {
          create: competencies.map((c, i) => ({ competencyId: c.id, weight: i === 0 ? 40 : 30 })),
        },
      },
      update: {},
    });
    if (framework.approved && framework.scope === 'CORE')
      await prisma.assessmentBlueprint.upsert({
        where: { jobRoleId_version: { jobRoleId: role.id, version: 1 } },
        create: {
          jobRoleId: role.id,
          frameworkId: framework.id,
          version: 1,
          title: index === 2 ? `${title} development assessment` : `${title} initial assessment`,
          durationMinutes: 60,
          instructions:
            index === 2
              ? 'Development assessment using a sample rubric. Explain your engineering fundamentals, practical troubleshooting approach, and safe professional practice using examples from mechatronics projects. An assessor must evaluate your evidence. This rubric requires subject-matter review before use for real applicant decisions.'
              : 'Review engineering fundamentals, arrange a quiet setting and bring examples of your practical work. Session launch details are not available in this milestone.',
          active: true,
        },
        update: {},
      });
  }
  await seedAssessmentScenarios();
  await seedInstitutions();
  await seedCompanies();
}
if (process.argv[1]?.endsWith('/seed.ts') || process.argv[1]?.endsWith('/seed.js')) {
  try {
    await seed();
    console.log(
      'Non-sensitive catalogue and permissions seeded. No administrator or availability was created.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
