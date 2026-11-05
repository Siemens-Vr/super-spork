import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/services/auth.service.js';
import { email, password } from '../src/validators/auth.schema.js';
import { audit } from '../src/utils/audit.js';
// Pipe a password on stdin; never put passwords in command arguments or shell history.
const input = z.object({ email, legalName: z.string().min(3).max(150), password }).parse({
  email: process.env.ADMIN_EMAIL,
  legalName: process.env.ADMIN_NAME,
  password: readFileSync(0, 'utf8').replace(/\r?\n$/, ''),
});
try {
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    if (
      (await tx.user.count({ where: { roles: { some: { role: { name: 'ADMIN' } } } } })) > 0 &&
      !process.argv.includes('--additional-admin')
    )
      throw new Error(
        'An admin already exists. An authorized operator must explicitly use --additional-admin.',
      );
    const role = await tx.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const user = await tx.user.create({
      data: {
        email: input.email,
        legalName: input.legalName,
        passwordHash,
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: role.id } },
      },
    });
    await audit(tx, user.id, 'admin.bootstrapped', user.id);
  });
  console.log(
    'Admin provisioned. Sign in, enroll MFA, and verify a TOTP before using admin routes.',
  );
} finally {
  await prisma.$disconnect();
}
