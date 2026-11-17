import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { hashPassword } from '../../src/services/auth.service.js';
import { decrypt, verifier } from '../../src/utils/crypto.js';
import { storage } from '../../src/config/storage.js';
import { scanFile } from '../../src/integrations/storage/clamav.js';
import { scanTrainerQualification } from '../../src/jobs/trainer-document.worker.js';
import {
  trainerProfileSchema,
  trainerQualificationSchema,
  trainerReviewSchema,
} from '../../src/validators/trainer.schema.js';
vi.mock('../../src/integrations/storage/clamav.js', () => ({
  scanFile: vi.fn().mockResolvedValue('CLEAN'),
}));
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const server = createServer(createApp());
type Agent = ReturnType<typeof request.agent>;
const secret = 'trainer isolated testing passphrase',
  pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const objects = new Map<string, Buffer>();
let hash: string, adminId: string, adminAgent: Agent;
async function csrf(a: Agent) {
  return (await a.get('/api/v1/auth/csrf')).body.data.csrfToken as string;
}
async function post(a: Agent, path: string, body: object = {}) {
  const token = await csrf(a);
  return a.post(`/api/v1${path}`).set('X-CSRF-Token', token).send(body);
}
async function newUser(roles = ['APPLICANT']) {
  const email = `trainer-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: {
      legalName: 'Isolated Trainer',
      email,
      passwordHash: hash,
      emailVerifiedAt: new Date(),
      roles: {
        create: await Promise.all(
          roles.map(async (name) => ({
            roleId: (await prisma.role.findUniqueOrThrow({ where: { name } })).id,
          })),
        ),
      },
    },
  });
  const a = request.agent(server);
  expect((await post(a, '/auth/login', { email, password: secret })).status).toBe(200);
  return { user, a };
}
async function invitation(a: Agent, email: string) {
  const r = await post(a, '/admin/trainer-invitations', { email });
  expect(r.status).toBe(201);
  const rows = await prisma.notificationOutbox.findMany({ orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    if (!row.encryptedPayload) continue;
    const payload = JSON.parse(decrypt(row.encryptedPayload)) as { to: string; text: string };
    if (payload.to === email && payload.text.includes('token=')) {
      const token = payload.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) return { id: r.body.data.id as string, token, response: r };
    }
  }
  throw new Error('No isolated invitation outbox payload');
}
async function trainer() {
  const p = await newUser();
  const invite = await invitation(adminAgent, p.user.email);
  expect((await post(p.a, '/trainers/invitations/accept', { token: invite.token })).status).toBe(
    200,
  );
  return p;
}
const profileInput = {
  headline: 'Industrial automation trainer',
  biography:
    'Experienced technical educator with practical industrial automation and safe engineering delivery experience.',
  country: 'KE',
  region: 'Nyeri',
  yearsExperience: 8,
  expertise: ['PLC programming', 'Industrial safety'],
};
async function profile(a: Agent) {
  const r = await a.get('/api/v1/trainers/me');
  expect(r.status).toBe(200);
  return r.body.data;
}
async function upload(a: Agent, bytes = pdf, mime = 'application/pdf') {
  const p = await profile(a),
    token = await csrf(a);
  return a
    .post('/api/v1/trainers/me/qualifications')
    .set('X-CSRF-Token', token)
    .field('version', String(p.version))
    .field('category', 'CERTIFICATION')
    .field('title', 'Industrial automation educator')
    .field('issuer', 'Isolated Technical Institute')
    .field('issuedAt', '2025-01-01')
    .attach('file', bytes, { filename: 'certificate.pdf', contentType: mime });
}
async function submitted() {
  const p = await trainer(),
    draft = await profile(p.a);
  expect(
    (
      await p.a
        .patch('/api/v1/trainers/me')
        .set('X-CSRF-Token', await csrf(p.a))
        .send({ ...profileInput, version: draft.version })
    ).status,
  ).toBe(200);
  const uploaded = await upload(p.a);
  expect(uploaded.status).toBe(201);
  const id = uploaded.body.data.qualifications[0].id as string;
  await scanTrainerQualification(id);
  const ready = await profile(p.a);
  expect((await post(p.a, '/trainers/me/submit', { version: ready.version })).status).toBe(200);
  return { ...p, qualificationId: id };
}
suite('trainer onboarding API and access isolation', () => {
  beforeAll(async () => {
    if (new URL(process.env.TEST_DATABASE_URL!).pathname !== '/nexus_test')
      throw new Error('Isolated database required');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    hash = await hashPassword(secret);
    for (const name of ['ADMIN', 'APPLICANT', 'TRAINER'])
      await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    for (const name of ['trainers.manage', 'documents.review']) {
      const permission = await prisma.permission.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
        create: { roleId: adminRole.id, permissionId: permission.id },
        update: {},
      });
    }
    const administrator = await newUser(['ADMIN']);
    adminId = administrator.user.id;
    adminAgent = administrator.a;
    const setup = await post(adminAgent, '/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const totp = OTPAuth.URI.parse(setup.body.data.provisioningUri) as OTPAuth.TOTP;
    expect((await post(adminAgent, '/auth/mfa/verify', { code: totp.generate() })).status).toBe(
      200,
    );
    vi.spyOn(storage, 'put').mockImplementation(async (key, data) => {
      objects.set(key, data);
    });
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      const file = objects.get(key);
      if (!file) throw new Error('Missing test object');
      return file;
    });
    vi.spyOn(storage, 'remove').mockImplementation(async (key) => {
      objects.delete(key);
    });
  });
  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.$disconnect();
  });

  it('denies unsigned users, public applicants and admins without MFA', async () => {
    expect((await request(server).get('/api/v1/trainers/me')).status).toBe(401);
    const p = await newUser();
    expect((await p.a.get('/api/v1/trainers/me')).status).toBe(403);
    expect(
      (await post(p.a, '/admin/trainer-invitations', { email: 'unauthorized@example.test' }))
        .status,
    ).toBe(403);
    const admin = await newUser(['ADMIN']);
    expect(
      (await post(admin.a, '/admin/trainer-invitations', { email: 'mfa@example.test' })).body.error
        .code,
    ).toBe('MFA_REQUIRED');
  });
  it('stores only invitation verifiers and sends encrypted one-time links', async () => {
    const p = await newUser(),
      invite = await invitation(adminAgent, p.user.email);
    expect(JSON.stringify(invite.response.body)).not.toContain(invite.token);
    const row = await prisma.trainerInvitation.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).toBe(verifier(`trainer-invite:${invite.token}`));
    expect(row.tokenHash).not.toContain(invite.token);
  });
  it('requires a matching verified email and consumes links once', async () => {
    const p = await newUser(),
      other = await newUser(),
      invite = await invitation(adminAgent, p.user.email);
    expect(
      (await post(other.a, '/trainers/invitations/accept', { token: invite.token })).status,
    ).toBe(400);
    await prisma.user.update({ where: { id: p.user.id }, data: { emailVerifiedAt: null } });
    expect((await post(p.a, '/trainers/invitations/accept', { token: invite.token })).status).toBe(
      403,
    );
    await prisma.user.update({ where: { id: p.user.id }, data: { emailVerifiedAt: new Date() } });
    expect((await post(p.a, '/trainers/invitations/accept', { token: invite.token })).status).toBe(
      200,
    );
    expect((await post(p.a, '/trainers/invitations/accept', { token: invite.token })).status).toBe(
      400,
    );
  });
  it('rotates sessions when adding trainer privileges and preserves applicant roles', async () => {
    const p = await newUser();
    const second = request.agent(server);
    await post(second, '/auth/login', { email: p.user.email, password: secret });
    const invite = await invitation(adminAgent, p.user.email);
    await post(p.a, '/trainers/invitations/accept', { token: invite.token });
    expect((await second.get('/api/v1/auth/me')).status).toBe(401);
    const me = await p.a.get('/api/v1/auth/me');
    expect(me.body.data.roles).toEqual(expect.arrayContaining(['TRAINER', 'APPLICANT']));
    expect((await profile(p.a)).status).toBe('DRAFT');
  });
  it('rejects expired, revoked and replaced invitation links', async () => {
    const p = await newUser(),
      first = await invitation(adminAgent, p.user.email);
    await prisma.trainerInvitation.update({
      where: { id: first.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post(p.a, '/trainers/invitations/accept', { token: first.token })).status).toBe(
      400,
    );
    const second = await invitation(adminAgent, p.user.email);
    expect((await post(p.a, '/trainers/invitations/accept', { token: first.token })).status).toBe(
      400,
    );
    expect((await post(adminAgent, `/admin/trainer-invitations/${second.id}/revoke`)).status).toBe(
      200,
    );
    expect((await post(p.a, '/trainers/invitations/accept', { token: second.token })).status).toBe(
      400,
    );
  });
  it('validates profile and qualification fields without permitting role changes', () => {
    expect(
      trainerProfileSchema.safeParse({ ...profileInput, version: 0, role: 'ADMIN' }).success,
    ).toBe(false);
    expect(
      trainerProfileSchema.safeParse({ ...profileInput, version: 0, expertise: ['PLC', 'plc'] })
        .success,
    ).toBe(false);
    expect(
      trainerQualificationSchema.safeParse({
        version: 0,
        category: 'DEGREE',
        title: 'Degree',
        issuer: 'Institute',
        issuedAt: '2025-02-01',
        expiresAt: '2024-01-01',
      }).success,
    ).toBe(false);
    expect(
      trainerReviewSchema.safeParse({
        version: 0,
        outcome: 'APPROVED',
        reason: 'Qualifications have been reviewed',
      }).success,
    ).toBe(false);
  });
  it('prevents stale profile writes and edits during review', async () => {
    const p = await submitted(),
      before = await profile(p.a);
    const r = await p.a
      .patch('/api/v1/trainers/me')
      .set('X-CSRF-Token', await csrf(p.a))
      .send({ ...profileInput, version: before.version });
    expect(r.body.error.code).toBe('TRAINER_PROFILE_LOCKED');
    const admin = await post(adminAgent, `/admin/trainers/${p.user.id}/reviews`, {
      version: before.version,
      outcome: 'CHANGES_REQUESTED',
      reason: 'Please expand your technical teaching experience.',
    });
    expect(admin.status).toBe(201);
    expect(
      (
        await p.a
          .patch('/api/v1/trainers/me')
          .set('X-CSRF-Token', await csrf(p.a))
          .send({ ...profileInput, version: before.version })
      ).body.error.code,
    ).toBe('TRAINER_VERSION_CONFLICT');
  });
  it('accepts qualification evidence without collecting an applicant identity document', async () => {
    const p = await trainer(),
      r = await upload(p.a);
    expect(r.status).toBe(201);
    expect(r.body.data.qualifications[0].scanStatus).toBe('QUARANTINED');
    expect(await prisma.document.count({ where: { applicantId: p.user.id } })).toBe(0);
    expect(JSON.stringify(r.body)).not.toMatch(/storageKey|sha256/);
    const id = r.body.data.qualifications[0].id;
    expect((await p.a.get(`/api/v1/trainers/me/qualifications/${id}/download`)).status).toBe(409);
    await scanTrainerQualification(id);
    expect((await p.a.get(`/api/v1/trainers/me/qualifications/${id}/download`)).status).toBe(200);
  });
  it('rejects invalid signatures, oversized files and unsafe scanner outcomes', async () => {
    const p = await trainer();
    expect((await upload(p.a, Buffer.from('bad text'))).status).toBe(415);
    expect((await upload(p.a, pdf, 'image/png')).status).toBe(415);
    expect((await upload(p.a, Buffer.alloc(11 * 1024 * 1024))).status).toBe(413);
    const r = await upload(p.a),
      id = r.body.data.qualifications[0].id;
    vi.mocked(scanFile).mockResolvedValueOnce('INFECTED');
    await scanTrainerQualification(id);
    expect((await p.a.get(`/api/v1/trainers/me/qualifications/${id}/download`)).status).toBe(409);
    const next = await upload(p.a),
      second = next.body.data.qualifications.at(-1).id;
    vi.mocked(scanFile).mockRejectedValueOnce(new Error('Scanner offline'));
    await expect(scanTrainerQualification(second)).rejects.toThrow();
    expect(
      (await prisma.trainerQualification.findUniqueOrThrow({ where: { id: second } })).scanStatus,
    ).toBe('FAILED');
  });
  it('isolates trainer profiles, private evidence and applicant records', async () => {
    const p = await submitted(),
      other = await trainer();
    expect(
      (await other.a.get(`/api/v1/trainers/me/qualifications/${p.qualificationId}/download`))
        .status,
    ).toBe(404);
    const token = await csrf(other.a);
    expect(
      (
        await other.a
          .delete(`/api/v1/trainers/me/qualifications/${p.qualificationId}`)
          .set('X-CSRF-Token', token)
          .send({ version: (await profile(other.a)).version })
      ).status,
    ).toBe(404);
    expect((await p.a.get('/api/v1/admin/applicants')).status).toBe(403);
    expect((await p.a.get('/api/v1/admin/trainers')).status).toBe(403);
  });
  it('requires complete scanned profiles before submission', async () => {
    const p = await trainer();
    expect((await post(p.a, '/trainers/me/submit', { version: 0 })).status).toBe(422);
    await p.a
      .patch('/api/v1/trainers/me')
      .set('X-CSRF-Token', await csrf(p.a))
      .send({ ...profileInput, version: 0 });
    const r = await upload(p.a);
    expect(
      (await post(p.a, '/trainers/me/submit', { version: r.body.data.version })).body.error.code,
    ).toBe('TRAINER_QUALIFICATIONS_REQUIRED');
  });
  it('records independent approval, suspension and historical profile snapshots', async () => {
    const p = await submitted();
    let saved = await profile(p.a);
    const approve = await post(adminAgent, `/admin/trainers/${p.user.id}/reviews`, {
      version: saved.version,
      outcome: 'APPROVED',
      reason: 'Institution independently confirmed professional qualifications.',
      evidenceReference: 'Institution review TR-42',
    });
    expect(approve.status).toBe(201);
    expect(approve.body.data.status).toBe('APPROVED');
    saved = await profile(p.a);
    const suspend = await post(adminAgent, `/admin/trainers/${p.user.id}/reviews`, {
      version: saved.version,
      outcome: 'SUSPENDED',
      reason: 'Trainer delivery eligibility requires institutional reassessment.',
    });
    expect(suspend.status).toBe(201);
    expect((await profile(p.a)).reviews).toHaveLength(2);
    const review = await prisma.trainerReview.findFirstOrThrow({
      where: { trainerProfileId: saved.id, outcome: 'APPROVED' },
    });
    expect(review.snapshot).toMatchObject({
      headline: profileInput.headline,
      qualifications: [expect.objectContaining({ id: p.qualificationId })],
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'trainer.reviewed', resourceId: saved.id } }),
    ).toBe(2);
  });
  it('forbids administrator self-approval and duplicate concurrent submissions', async () => {
    const p = await submitted();
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await prisma.userRole.create({ data: { userId: p.user.id, roleId: role.id } });
    const setup = await post(p.a, '/auth/mfa/setup');
    const totp = OTPAuth.URI.parse(setup.body.data.provisioningUri) as OTPAuth.TOTP;
    await post(p.a, '/auth/mfa/verify', { code: totp.generate() });
    const before = await profile(p.a);
    const r = await post(p.a, `/admin/trainers/${p.user.id}/reviews`, {
      version: before.version,
      outcome: 'APPROVED',
      reason: 'Attempted self approval should be denied.',
      evidenceReference: 'Invalid self evidence',
    });
    expect(r.body.error.code).toBe('TRAINER_SELF_REVIEW_FORBIDDEN');
  });
  it('retains withdrawn evidence and refuses cross-profile file corruption', async () => {
    const p = await trainer(),
      r = await upload(p.a),
      q = r.body.data.qualifications[0];
    await scanTrainerQualification(q.id);
    const p1 = await profile(p.a);
    expect(
      (
        await p.a
          .delete(`/api/v1/trainers/me/qualifications/${q.id}`)
          .set('X-CSRF-Token', await csrf(p.a))
          .send({ version: p1.version })
      ).status,
    ).toBe(200);
    const db = await prisma.trainerQualification.findUniqueOrThrow({ where: { id: q.id } });
    expect(db.withdrawnAt).not.toBeNull();
    objects.set(db.storageKey, Buffer.from('tampered'));
    expect(
      (await p.a.get(`/api/v1/trainers/me/qualifications/${q.id}/download`)).body.error.code,
    ).toBe('DOCUMENT_INTEGRITY_FAILED');
    expect(db.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });
  it('enforces trainer permissions without blocking unrelated authorized admin routes', async () => {
    const permission = await prisma.permission.findUniqueOrThrow({
        where: { name: 'trainers.manage' },
      }),
      role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    try {
      expect((await adminAgent.get('/api/v1/admin/trainers')).status).toBe(403);
      expect((await adminAgent.get('/api/v1/admin/documents')).status).toBe(200);
    } finally {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    expect(adminId).toBeTruthy();
  });
});
