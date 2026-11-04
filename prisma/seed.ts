import { prisma } from '../src/config/prisma.js';
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
  const industries = [];
  for (const name of [
    'Manufacturing and Industrial Automation',
    'Energy and Utilities',
    'Industrial Software',
    'Robotics and Mechatronics',
    'Electronics and Instrumentation',
  ])
    industries.push(
      await prisma.industry.upsert({
        where: { name },
        create: { name, description: `Engineering careers in ${name.toLowerCase()}.` },
        update: {},
      }),
    );
  for (const [index, title] of [
    'PLC Programmer',
    'Industrial Software Engineer',
    'Mechatronics Engineer',
  ].entries()) {
    const role = await prisma.jobRole.upsert({
      where: { title },
      create: {
        title,
        description: `Practical engineering work as a ${title}.`,
        industries: { create: { industryId: industries[index % industries.length]!.id } },
      },
      update: {},
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
    if (index < 2)
      await prisma.assessmentBlueprint.upsert({
        where: { jobRoleId_version: { jobRoleId: role.id, version: 1 } },
        create: {
          jobRoleId: role.id,
          frameworkId: framework.id,
          version: 1,
          title: `${title} initial assessment`,
          durationMinutes: 60,
          instructions:
            'Review engineering fundamentals, arrange a quiet setting and bring examples of your practical work. Session launch details are not available in this milestone.',
          active: true,
        },
        update: {},
      });
  }
  await prisma.institution.upsert({
    where: { name: 'Dedan Kimathi University of Technology' },
    create: { name: 'Dedan Kimathi University of Technology', country: 'KE' },
    update: {},
  });
  await prisma.company.upsert({
    where: { name: 'Example Industrial Systems (demonstration)' },
    create: {
      name: 'Example Industrial Systems (demonstration)',
      description:
        'Fictional preference catalogue entry. No partnership, vacancy, or employer relationship is implied.',
      industries: { create: { industryId: industries[0]!.id } },
    },
    update: {},
  });
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
