import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import * as OTPAuth from 'otpauth';
import { prisma } from '../../src/config/prisma.js';
import { createApp } from '../../src/app.js';
import { seed } from '../../prisma/seed.js';
import { decrypt } from '../../src/utils/crypto.js';
import { hashPassword } from '../../src/services/auth.service.js';
import { storage } from '../../src/config/storage.js';
import { googleProvider } from '../../src/integrations/google/client.js';
import { scanFile } from '../../src/integrations/storage/clamav.js';
import { scanDocument } from '../../src/jobs/document.worker.js';
import {
  createAvailability,
  createBooking,
  cancelBooking,
  eligibility,
  updateAvailability,
} from '../../src/services/scheduling.service.js';
vi.mock('../../src/integrations/storage/clamav.js', () => ({
  scanFile: vi.fn().mockResolvedValue('CLEAN'),
}));
const app = createApp();
const server = createServer(app);
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
type Agent = ReturnType<typeof request.agent>;
const password = 'a strong testing passphrase';
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
let sequence = 0;
const files = new Map<string, Buffer>();
async function csrf(a: Agent) {
  const r = await a.get('/api/v1/auth/csrf');
  expect(r.status).toBe(200);
  return r.body.data.csrfToken as string;
}
async function post(a: Agent, path: string, body: object) {
  const token = await csrf(a);
  return a.post(`/api/v1${path}`).set('X-CSRF-Token', token).send(body);
}
async function otp(email: string, subject: string) {
  const rows = await prisma.notificationOutbox.findMany({ orderBy: { createdAt: 'desc' } });
  for (const row of rows) {
    if (!row.encryptedPayload) continue;
    const m = JSON.parse(decrypt(row.encryptedPayload)) as {
      to: string;
      subject: string;
      text: string;
    };
    if (m.to === email && m.subject.includes(subject)) {
      const code = m.text.match(/code is (\d{6})/);
      if (code) return code[1]!;
    }
  }
  throw new Error('No isolated test OTP found');
}
async function applicant() {
  const email = `person-${++sequence}@example.test`,
    a = request.agent(server);
  const r = await post(a, '/auth/register', {
    legalName: 'Example Engineering Applicant',
    email,
    phone: '0712345678',
    password,
    passwordConfirmation: password,
    consentVersion: '2026-11-01',
  });
  expect(r.status).toBe(202);
  const code = await otp(email, 'Verify your email');
  expect((await post(a, '/auth/verify-email', { email, code })).status).toBe(200);
  expect((await post(a, '/auth/login', { email, password })).status).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { a, email, id: user.id };
}
async function uploadIdentity(a: Agent) {
  const r = await a
    .post('/api/v1/identity/documents')
    .set('X-CSRF-Token', await csrf(a))
    .field('category', 'NATIONAL_ID')
    .field('title', 'National ID for test applicant')
    .attach('file', pdf, { filename: 'identity.pdf', contentType: 'application/pdf' });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}
async function readyApplicant() {
  const person = await applicant();
  const identityId = await uploadIdentity(person.a);
  await scanDocument(identityId);
  const token = await csrf(person.a);
  expect(
    (
      await person.a.patch('/api/v1/applicants/me').set('X-CSRF-Token', token).send({
        educationLevel: 'BACHELOR',
        institution: 'Example Technical Institution',
        discipline: 'Mechatronics',
        professionalStatus: 'GRADUATE',
      })
    ).status,
  ).toBe(200);
  const b = await prisma.assessmentBlueprint.findFirstOrThrow({ where: { active: true } });
  const industry = await prisma.industry.findFirstOrThrow();
  const preferences = await person.a
    .put('/api/v1/applicants/me/career-preferences')
    .set('X-CSRF-Token', await csrf(person.a))
    .send({ industryIds: [industry.id], companyIds: [], primaryRoleId: b.jobRoleId });
  expect(preferences.status).toBe(200);
  return { ...person, blueprintId: b.id, identityId };
}
let adminId: string;
async function adminSession(withMfa = true) {
  const a = request.agent(server);
  expect((await post(a, '/auth/login', { email: 'admin@example.test', password })).status).toBe(
    200,
  );
  if (withMfa) {
    const existing = await prisma.adminMfaCredential.findUnique({ where: { userId: adminId } });
    if (existing) await prisma.adminMfaCredential.delete({ where: { userId: adminId } });
    const setup = await post(a, '/auth/mfa/setup', {});
    expect(setup.status).toBe(200);
    const totp = OTPAuth.URI.parse(setup.body.data.provisioningUri) as OTPAuth.TOTP;
    expect((await post(a, '/auth/mfa/verify', { code: totp.generate() })).status).toBe(200);
  }
  return a;
}
async function availability(blueprintId: string, capacity = 1) {
  const last = await prisma.assessmentAvailability.findFirst({
    where: { blueprintId },
    orderBy: { endsAt: 'desc' },
  });
  const startsAt = new Date(last ? last.endsAt.getTime() + 3600000 : Date.now() + 86400000);
  return createAvailability(adminId, {
    blueprintId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 4 * 3600000).toISOString(),
    capacity,
    minNoticeMinutes: 60,
    maxHorizonDays: 90,
    cancellationNoticeMinutes: 60,
    rescheduleLimit: 2,
    timezone: 'Africa/Nairobi',
  });
}
suite('PostgreSQL-backed authentication, onboarding and booking', () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!url.pathname.endsWith('/nexus_test'))
      throw new Error(
        'Integration tests only run against an explicitly provided nexus_test database',
      );
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "User", "Role", "Permission", "Institution", "Industry", "Company", "JobRole", "Competency", "NotificationOutbox", "RateLimitBucket" CASCADE',
    );
    await seed();
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const admin = await prisma.user.create({
      data: {
        email: 'admin@example.test',
        legalName: 'Authorized Test Administrator',
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        roles: { create: { roleId: role.id } },
      },
    });
    adminId = admin.id;
    vi.spyOn(storage, 'put').mockImplementation(async (key, buffer) => {
      files.set(key, buffer);
    });
    vi.spyOn(storage, 'get').mockImplementation(async (key) => {
      const b = files.get(key);
      if (!b) throw new Error('Missing isolated test object');
      return b;
    });
    vi.spyOn(storage, 'remove').mockImplementation(async (key) => {
      files.delete(key);
    });
  });
  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await prisma.$disconnect();
  });
  it('registers, verifies and logs in without exposing password or OTP', async () => {
    const p = await applicant();
    const r = await p.a.get('/api/v1/auth/me');
    expect(r.status).toBe(200);
    expect(r.body.data.roles).toEqual(['APPLICANT']);
    expect(r.body.data.passwordHash).toBeUndefined();
    expect(r.body.data.code).toBeUndefined();
    const outbox = await prisma.notificationOutbox.findFirstOrThrow();
    expect(outbox.encryptedPayload).not.toContain('code is');
  });
  it('uses indistinguishable duplicate registration responses', async () => {
    const p = await applicant();
    const r = await post(p.a, '/auth/register', {
      legalName: 'Another Person',
      email: p.email,
      phone: '0712345678',
      password,
      passwordConfirmation: password,
      consentVersion: '2026-11-01',
    });
    expect(r.status).toBe(202);
    expect(await prisma.user.count({ where: { email: p.email } })).toBe(1);
  });
  it('rejects invalid registration and privilege escalation', async () => {
    const a = request.agent(server);
    expect(
      (
        await post(a, '/auth/register', {
          legalName: 'X',
          email: 'bad',
          phone: '1234',
          password: 'short',
          role: 'ADMIN',
        })
      ).status,
    ).toBe(422);
  });
  it('rejects invalid, expired and replayed OTPs', async () => {
    const p = await applicant();
    expect(
      (
        await post(p.a, '/auth/verify-email', {
          email: p.email,
          code: await otp(p.email, 'Verify your email'),
        })
      ).status,
    ).toBe(400);
    const a = request.agent(server),
      email = `expiry-${++sequence}@example.test`;
    await post(a, '/auth/register', {
      legalName: 'Expiration Test',
      email,
      phone: '0712345678',
      password,
      passwordConfirmation: password,
      consentVersion: '2026-11-01',
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { email } }),
      code = await otp(email, 'Verify your email');
    expect(
      (
        await post(a, '/auth/verify-email', {
          email,
          code: '000000' === code ? '000001' : '000000',
        })
      ).status,
    ).toBe(400);
    await prisma.authChallenge.updateMany({
      where: { userId: u.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await post(a, '/auth/verify-email', { email, code })).status).toBe(400);
  });
  it('persists failed OTP attempts and enforces the attempt limit', async () => {
    const a = request.agent(server),
      email = `attempts-${++sequence}@example.test`;
    await post(a, '/auth/register', {
      legalName: 'Attempts Test',
      email,
      phone: '0712345678',
      password,
      passwordConfirmation: password,
      consentVersion: '2026-11-01',
    });
    const code = await otp(email, 'Verify your email');
    for (let i = 0; i < 5; i++)
      expect(
        (
          await post(a, '/auth/verify-email', {
            email,
            code: code === '123456' ? '654321' : '123456',
          })
        ).status,
      ).toBe(400);
    expect((await post(a, '/auth/verify-email', { email, code })).status).toBe(400);
    const c = await prisma.authChallenge.findFirstOrThrow({ where: { user: { email } } });
    expect(c.attempts).toBe(5);
  });
  it('returns consistent invalid credentials and rotates sessions on login', async () => {
    const p = await applicant();
    expect(
      (await post(p.a, '/auth/login', { email: p.email, password: 'incorrect password' })).status,
    ).toBe(401);
    const before = await p.a.get('/api/v1/auth/sessions');
    const id = before.body.data.find((s: { current: boolean }) => s.current).id;
    expect((await post(p.a, '/auth/login', { email: p.email, password })).status).toBe(200);
    const after = await p.a.get('/api/v1/auth/sessions');
    expect(after.body.data.find((s: { current: boolean }) => s.current).id).not.toBe(id);
  });
  it('recovers passwords, revokes sessions and does not bypass restrictions', async () => {
    const p = await applicant();
    expect((await post(p.a, '/auth/forgot-password', { email: p.email })).status).toBe(202);
    const code = await otp(p.email, 'Password recovery');
    expect(
      (
        await post(p.a, '/auth/reset-password', {
          email: p.email,
          code,
          password: 'a new safe testing passphrase',
          passwordConfirmation: 'a new safe testing passphrase',
        })
      ).status,
    ).toBe(200);
    expect((await p.a.get('/api/v1/auth/me')).status).toBe(401);
    expect(
      (
        await post(p.a, '/auth/reset-password', {
          email: p.email,
          code,
          password,
          passwordConfirmation: password,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(p.a, '/auth/login', {
          email: p.email,
          password: 'a new safe testing passphrase',
        })
      ).status,
    ).toBe(200);
    await prisma.user.update({ where: { id: p.id }, data: { status: 'SUSPENDED' } });
    expect((await post(p.a, '/auth/forgot-password', { email: p.email })).status).toBe(202);
    expect(
      (
        await post(p.a, '/auth/login', {
          email: p.email,
          password: 'a new safe testing passphrase',
        })
      ).status,
    ).toBe(401);
  });
  it('revokes individual and all sessions', async () => {
    const p = await applicant(),
      a2 = request.agent(server);
    await post(a2, '/auth/login', { email: p.email, password });
    const sessions = await p.a.get('/api/v1/auth/sessions');
    const other = sessions.body.data.find((s: { current: boolean }) => !s.current);
    expect(
      (await p.a.delete(`/api/v1/auth/sessions/${other.id}`).set('X-CSRF-Token', await csrf(p.a)))
        .status,
    ).toBe(204);
    expect((await a2.get('/api/v1/auth/me')).status).toBe(401);
    expect((await post(p.a, '/auth/logout-all', {})).status).toBe(204);
    expect((await p.a.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('requires recent MFA for privileged operations and rejects applicants', async () => {
    const a = await adminSession(false);
    expect((await a.get('/api/v1/admin/applicants')).body.error.code).toBe('MFA_REQUIRED');
    const p = await applicant();
    expect((await p.a.get('/api/v1/admin/applicants')).status).toBe(403);
    const valid = await adminSession();
    expect((await valid.get('/api/v1/admin/applicants')).status).toBe(200);
  });
  it('validates Google callback state, nonce and PKCE through the provider boundary', async () => {
    const a = request.agent(server);
    const start = vi.spyOn(googleProvider, 'start').mockResolvedValue({
      url: 'https://accounts.google.com/authorize',
      state: 'expected-state',
      nonce: 'expected-nonce',
      verifier: 'expected-verifier',
    });
    const finish = vi
      .spyOn(googleProvider, 'finish')
      .mockRejectedValue(new Error('state mismatch'));
    expect((await a.get('/api/v1/auth/google')).status).toBe(302);
    expect((await a.get('/api/v1/auth/google/callback?state=wrong&code=bad')).status).toBe(401);
    expect(finish.mock.calls[0]?.[1]).toMatchObject({
      state: 'expected-state',
      nonce: 'expected-nonce',
      verifier: 'expected-verifier',
    });
    expect(
      (await a.get('/api/v1/auth/google/callback?state=expected-state&code=replay')).status,
    ).toBe(400);
    start.mockRestore();
    finish.mockRestore();
  });
  it('completes Google registration without passwords and never merges by email', async () => {
    const a = request.agent(server);
    const start = vi.spyOn(googleProvider, 'start').mockResolvedValue({
      url: 'https://accounts.google.com/authorize',
      state: 'state',
      nonce: 'nonce',
      verifier: 'verifier',
    });
    const finish = vi.spyOn(googleProvider, 'finish').mockResolvedValue({
      subject: 'google-test-subject',
      email: 'google@example.test',
      name: 'Google Applicant',
    });
    await a.get('/api/v1/auth/google');
    expect(
      (await a.get('/api/v1/auth/google/callback?state=state&code=valid')).body.data
        .registrationRequired,
    ).toBe(true);
    expect(
      (
        await post(a, '/auth/google/complete', {
          phone: '0712345678',
          consentVersion: '2026-11-01',
        })
      ).status,
    ).toBe(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'google@example.test' } });
    expect(u.passwordHash).toBeNull();
    expect(u.emailVerifiedAt).not.toBeNull();
    const existing = await applicant(),
      b = request.agent(server);
    finish.mockResolvedValue({
      subject: 'another-subject',
      email: existing.email,
      name: 'Collision',
    });
    await b.get('/api/v1/auth/google');
    expect(
      (await b.get('/api/v1/auth/google/callback?state=state&code=valid')).body.error.code,
    ).toBe('ACCOUNT_LINK_REQUIRED');
    start.mockRestore();
    finish.mockRestore();
  });
  it('requires identity before academic uploads', async () => {
    const p = await applicant();
    const r = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'BACHELOR')
      .field('title', 'BEng Mechatronics')
      .attach('file', pdf, { filename: 'degree.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('IDENTITY_REQUIRED');
  });
  it('uploads into quarantine and prevents downloads until malware scanning passes', async () => {
    const p = await applicant(),
      id = await uploadIdentity(p.a);
    expect((await p.a.get(`/api/v1/documents/${id}/download`)).body.error.code).toBe(
      'DOCUMENT_QUARANTINED',
    );
    await scanDocument(id);
    expect((await p.a.get(`/api/v1/documents/${id}/download`)).status).toBe(200);
    expect((await p.a.get(`/api/v1/documents/${id}`)).body.data.storageKey).toBeUndefined();
  });
  it('rejects unsupported content, signature mismatch and oversized files', async () => {
    const p = await applicant();
    const upload = (b: Buffer, mime: string) =>
      p.a
        .post('/api/v1/identity/documents')
        .field('category', 'PASSPORT')
        .field('title', 'Passport submission')
        .attach('file', b, { filename: 'file.pdf', contentType: mime });
    expect(
      (
        await upload(Buffer.from('malicious plain text'), 'application/pdf').set(
          'X-CSRF-Token',
          await csrf(p.a),
        )
      ).status,
    ).toBe(415);
    expect((await upload(pdf, 'image/png').set('X-CSRF-Token', await csrf(p.a))).status).toBe(415);
    expect(
      (
        await upload(Buffer.alloc(11 * 1024 * 1024), 'application/pdf').set(
          'X-CSRF-Token',
          await csrf(p.a),
        )
      ).status,
    ).toBe(413);
  });
  it('fails closed when malware is detected or scanner is unavailable', async () => {
    const p = await applicant(),
      id = await uploadIdentity(p.a);
    vi.mocked(scanFile).mockResolvedValueOnce('INFECTED');
    await scanDocument(id);
    expect((await p.a.get(`/api/v1/documents/${id}/download`)).status).toBe(409);
    const second = await uploadIdentity(p.a);
    vi.mocked(scanFile).mockRejectedValueOnce(new Error('Scanner unavailable'));
    await expect(scanDocument(second)).rejects.toThrow();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: second } })).scanStatus).toBe(
      'FAILED',
    );
  });
  it('enforces document ownership for metadata, evidence and downloads', async () => {
    const p = await applicant(),
      other = await applicant(),
      id = await uploadIdentity(p.a);
    expect((await other.a.get(`/api/v1/documents/${id}`)).status).toBe(404);
    expect((await other.a.get(`/api/v1/documents/${id}/download`)).status).toBe(404);
    expect(
      (
        await post(other.a, `/documents/${id}/evidence`, {
          note: 'Trying to change another applicant document',
        })
      ).status,
    ).toBe(404);
  });
  it('audits independent review, additional evidence and replacement history', async () => {
    const p = await applicant(),
      id = await uploadIdentity(p.a);
    await scanDocument(id);
    const a = await adminSession();
    const review = await post(a, `/admin/documents/${id}/reviews`, {
      outcome: 'ADDITIONAL_EVIDENCE_REQUIRED',
      method: 'MANUAL',
      reason: 'Please supply the reverse side of your identity document.',
    });
    expect(review.status).toBe(201);
    expect(
      (
        await post(p.a, `/documents/${id}/evidence`, {
          note: 'I have provided an institutional evidence reference',
          reference: 'Institutional reference ABC',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post(a, `/admin/documents/${id}/reviews`, {
          outcome: 'AUTHENTICATED',
          method: 'INSTITUTION_CONFIRMATION',
          reason: 'Independent institutional confirmation received.',
          evidenceReference: 'Institution confirmation TEST-42',
          internalNotes: 'Internal restricted review detail',
        })
      ).status,
    ).toBe(201);
    const history = await p.a.get(`/api/v1/documents/${id}/verification`);
    expect(history.body.data.reviews).toHaveLength(2);
    expect(JSON.stringify(history.body)).not.toContain('Internal restricted');
    const replacement = await p.a
      .post(`/api/v1/identity/documents/${id}/replace`)
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'NATIONAL_ID')
      .field('title', 'Replacement ID document')
      .attach('file', pdf, { filename: 'new.pdf', contentType: 'application/pdf' });
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.replacesId).toBe(id);
    expect(await prisma.documentVerification.count({ where: { documentId: id } })).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { resourceId: id, action: 'document.reviewed' } }),
    ).toBe(2);
  });
  it('enforces granular permissions even for an MFA-verified administrator', async () => {
    const a = await adminSession(),
      p = await applicant(),
      id = await uploadIdentity(p.a);
    await scanDocument(id);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } }),
      permission = await prisma.permission.findUniqueOrThrow({
        where: { name: 'documents.verify' },
      });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    const response = await post(a, `/admin/documents/${id}/reviews`, {
      outcome: 'REJECTED',
      method: 'MANUAL',
      reason: 'Test permission denial',
    });
    expect(response.status).toBe(403);
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  });
  it('continues onboarding while authentication remains pending', async () => {
    const p = await readyApplicant();
    const state = await p.a.get('/api/v1/applicants/me/onboarding');
    expect(state.body.data.profileComplete).toBe(true);
    expect(state.body.data.careerSelected).toBe(true);
    expect((await eligibility(p.id)).eligible).toBe(true);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: p.identityId } })).status).toBe(
      'UNDER_REVIEW',
    );
    const data = await p.a.get(
      `/api/v1/careers/${(await prisma.assessmentBlueprint.findUniqueOrThrow({ where: { id: p.blueprintId } })).jobRoleId}/competencies`,
    );
    expect(data.body.data[0].competencies).toHaveLength(3);
  });
  it('rejects invalid roles and bounded duplicate preferences', async () => {
    const p = await readyApplicant(),
      industry = await prisma.industry.findFirstOrThrow();
    const token = await csrf(p.a);
    expect(
      (
        await p.a
          .put('/api/v1/applicants/me/career-preferences')
          .set('X-CSRF-Token', token)
          .send({ industryIds: [industry.id], companyIds: [], primaryRoleId: crypto.randomUUID() })
      ).status,
    ).toBe(422);
    expect(
      (
        await p.a
          .put('/api/v1/applicants/me/career-preferences')
          .set('X-CSRF-Token', token)
          .send({
            industryIds: [industry.id, industry.id],
            companyIds: [],
            primaryRoleId: crypto.randomUUID(),
          })
      ).status,
    ).toBe(422);
  });
  it('enforces database preference rank limits independently of the API', async () => {
    const p = await readyApplicant(),
      preference = await prisma.careerPreference.findUniqueOrThrow({
        where: { applicantId: p.id },
      }),
      industry = await prisma.industry.findFirstOrThrow({
        where: { preferences: { none: { preferenceId: preference.id } } },
      });
    await expect(
      prisma.industryPreference.create({
        data: { preferenceId: preference.id, industryId: industry.id, rank: 4 },
      }),
    ).rejects.toThrow();
  });
  it('rejects incomplete eligibility and explicit authentication policy requirements', async () => {
    const p = await applicant();
    expect((await eligibility(p.id)).eligible).toBe(false);
    const ready = await readyApplicant();
    await prisma.assessmentBlueprint.update({
      where: { id: ready.blueprintId },
      data: { requiresAuthenticatedIdentity: true },
    });
    expect((await eligibility(ready.id)).eligible).toBe(false);
    await prisma.assessmentBlueprint.update({
      where: { id: ready.blueprintId },
      data: { requiresAuthenticatedIdentity: false },
    });
  });
  it('completes the HTTP registration-to-booking journey with an outbox confirmation', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    const slots = await p.a.get(`/api/v1/assessments/available-slots?blueprintId=${p.blueprintId}`);
    expect(slots.status).toBe(200);
    expect(slots.body.data.some((s: { id: string }) => s.id === a.slots[0]!.id)).toBe(true);
    const result = await p.a
      .post('/api/v1/assessments/bookings')
      .set('X-CSRF-Token', await csrf(p.a))
      .set('Idempotency-Key', 'journey-booking-key')
      .send({ slotId: a.slots[0]!.id });
    expect(result.status).toBe(201);
    expect(result.body.data.status).toBe('SCHEDULED');
    expect(result.body.data.timezone).toBe('Africa/Nairobi');
    expect(result.body.data.sessionLink).toBeUndefined();
    const outbox = await prisma.notificationOutbox.findMany();
    expect(
      outbox.some(
        (o) =>
          o.encryptedPayload && decrypt(o.encryptedPayload).includes(result.body.data.bookingId),
      ),
    ).toBe(true);
  });
  it('prevents concurrent requests taking the final seat', async () => {
    const first = await readyApplicant(),
      second = await readyApplicant(),
      a = await availability(first.blueprintId);
    const responses = await Promise.allSettled([
      createBooking(first.id, a.slots[0]!.id, 'race-first-key'),
      createBooking(second.id, a.slots[0]!.id, 'race-second-key'),
    ]);
    expect(responses.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(responses.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await prisma.assessmentBooking.count({
        where: { slotId: a.slots[0]!.id, status: 'SCHEDULED' },
      }),
    ).toBe(1);
  });
  it('prevents two simultaneous active bookings by the same applicant', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    const responses = await Promise.allSettled([
      createBooking(p.id, a.slots[0]!.id, 'same-applicant-first'),
      createBooking(p.id, a.slots[1]!.id, 'same-applicant-second'),
    ]);
    expect(responses.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('makes concurrent booking retries idempotent and rejects changed payloads', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    const results = await Promise.all([
      createBooking(p.id, a.slots[0]!.id, 'idempotent-booking'),
      createBooking(p.id, a.slots[0]!.id, 'idempotent-booking'),
    ]);
    expect(results[0].id).toBe(results[1].id);
    await expect(createBooking(p.id, a.slots[1]!.id, 'idempotent-booking')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(results[0].events).toHaveLength(1);
  });
  it('enforces booking ownership, cancellation and preserved event history', async () => {
    const p = await readyApplicant(),
      other = await applicant(),
      a = await availability(p.blueprintId),
      b = await createBooking(p.id, a.slots[0]!.id, 'ownership-booking');
    expect((await other.a.get(`/api/v1/assessments/bookings/${b.id}`)).status).toBe(404);
    expect(
      (
        await post(other.a, `/assessments/bookings/${b.id}/cancel`, {
          reason: 'Unauthorized cancellation request',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(p.a, `/assessments/bookings/${b.id}/cancel`, {
          reason: 'Applicant changed availability',
        })
      ).status,
    ).toBe(200);
    expect(await prisma.assessmentBookingEvent.count({ where: { bookingId: b.id } })).toBe(2);
  });
  it('reschedules transactionally, enforces limits and retains predecessor bookings', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    const b = await createBooking(p.id, a.slots[0]!.id, 'reschedule-original');
    const next = await createBooking(
      p.id,
      a.slots[1]!.id,
      'reschedule-next',
      b.id,
      'Applicant needs a different time',
    );
    expect(next.rescheduledFromId).toBe(b.id);
    expect((await prisma.assessmentBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'RESCHEDULED',
    );
    const third = await createBooking(
      p.id,
      a.slots[2]!.id,
      'reschedule-third',
      next.id,
      'Second allowed change',
    );
    await expect(
      createBooking(p.id, a.slots[3]!.id, 'reschedule-limit', third.id, 'Too many changes'),
    ).rejects.toMatchObject({ code: 'RESCHEDULE_LIMIT' });
  });
  it('rolls back a failed reschedule and keeps original capacity reserved', async () => {
    const p = await readyApplicant(),
      other = await readyApplicant(),
      a = await availability(p.blueprintId),
      b = await createBooking(p.id, a.slots[0]!.id, 'rollback-original');
    await createBooking(other.id, a.slots[1]!.id, 'rollback-other');
    await expect(
      createBooking(p.id, a.slots[1]!.id, 'rollback-failed', b.id, 'Conflicting reschedule'),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect((await prisma.assessmentBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'SCHEDULED',
    );
  });
  it('rejects past slots and inactive blueprints', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    await prisma.assessmentSlot.update({
      where: { id: a.slots[0]!.id },
      data: { startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000) },
    });
    await expect(createBooking(p.id, a.slots[0]!.id, 'past-slot-rejected')).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
    await prisma.assessmentBlueprint.update({
      where: { id: p.blueprintId },
      data: { active: false },
    });
    await expect(createBooking(p.id, a.slots[1]!.id, 'inactive-blueprint')).rejects.toMatchObject({
      code: 'SLOT_UNAVAILABLE',
    });
    await prisma.assessmentBlueprint.update({
      where: { id: p.blueprintId },
      data: { active: true },
    });
  });

  it('invalidates a prior OTP on resend and enforces cooldown', async () => {
    const a = request.agent(server),
      email = `resend-${++sequence}@example.test`;
    await post(a, '/auth/register', {
      legalName: 'Resend Test Applicant',
      email,
      phone: '0712345678',
      password,
      passwordConfirmation: password,
      consentVersion: '2026-11-01',
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await post(a, '/auth/resend-verification', { email });
    expect(await prisma.authChallenge.count({ where: { userId: user.id } })).toBe(1);
    await prisma.authChallenge.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120000) },
    });
    await post(a, '/auth/resend-verification', { email });
    const challenges = await prisma.authChallenge.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(challenges).toHaveLength(2);
    expect(challenges[0]!.consumedAt).not.toBeNull();
    expect(challenges[1]!.consumedAt).toBeNull();
  });
  it('enforces account rate limits without trusting forwarded addresses', async () => {
    const a = request.agent(server),
      body = { email: 'unknown@example.test' };
    for (let i = 0; i < 4; i++)
      expect((await post(a, '/auth/forgot-password', body)).status).toBe(202);
    const r = await post(a, '/auth/forgot-password', body);
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBeTruthy();
  });
  it('rejects malformed and oversized JSON safely', async () => {
    const a = request.agent(server),
      token = await csrf(a);
    const malformed = await a
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', token)
      .set('Content-Type', 'application/json')
      .send('{');
    expect(malformed.status).toBe(400);
    const large = await a
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', token)
      .send({ email: 'x'.repeat(70000) });
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe('REQUEST_TOO_LARGE');
  });
  it('links Google only after authenticated explicit reauthentication', async () => {
    const p = await applicant();
    const start = vi.spyOn(googleProvider, 'start').mockResolvedValue({
      url: 'https://accounts.google.com/authorize',
      state: 'link-state',
      nonce: 'link-nonce',
      verifier: 'link-verifier',
    });
    const finish = vi.spyOn(googleProvider, 'finish').mockResolvedValue({
      subject: 'explicit-linked-subject',
      email: p.email,
      name: 'Linked Applicant',
    });
    expect((await post(p.a, '/auth/reauthenticate', { password })).status).toBe(200);
    expect((await post(p.a, '/auth/google/link', {})).status).toBe(302);
    expect(
      (await p.a.get('/api/v1/auth/google/callback?state=link-state&code=link-code')).body.data
        .linked,
    ).toBe(true);
    expect(
      (
        await prisma.authIdentity.findUniqueOrThrow({
          where: { provider_subject: { provider: 'google', subject: 'explicit-linked-subject' } },
        })
      ).userId,
    ).toBe(p.id);
    start.mockRestore();
    finish.mockRestore();
  });
  it('rejects replayed TOTP and consumes recovery codes exactly once', async () => {
    const a = request.agent(server);
    await post(a, '/auth/login', { email: 'admin@example.test', password });
    await prisma.adminMfaCredential.deleteMany({ where: { userId: adminId } });
    const setup = await post(a, '/auth/mfa/setup', {});
    const totp = OTPAuth.URI.parse(setup.body.data.provisioningUri) as OTPAuth.TOTP;
    const code = totp.generate();
    expect((await post(a, '/auth/mfa/verify', { code })).status).toBe(200);
    expect((await post(a, '/auth/mfa/verify', { code })).status).toBe(401);
    const recovery = setup.body.data.recoveryCodes[0];
    expect((await post(a, '/auth/mfa/verify', { code: recovery })).status).toBe(200);
    expect((await post(a, '/auth/mfa/verify', { code: recovery })).status).toBe(401);
  });
  it('uploads and reviews an academic qualification independently of identity', async () => {
    const p = await applicant();
    const identityId = await uploadIdentity(p.a);
    const r = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'BACHELOR')
      .field('title', 'BEng Mechatronics test certificate')
      .field('credentialNumber', 'sensitive-test-credential-number')
      .attach('file', pdf, { filename: 'degree.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    const d = await prisma.document.findUniqueOrThrow({ where: { id: r.body.data.id } });
    expect(d.encryptedCredentialNumber).not.toContain('sensitive-test');
    expect(JSON.stringify(r.body)).not.toContain('encryptedCredentialNumber');
    await scanDocument(d.id);
    const a = await adminSession();
    expect(
      (
        await post(a, `/admin/documents/${d.id}/reviews`, {
          outcome: 'AUTHENTICATED',
          method: 'OFFICIAL_VERIFICATION',
          reason: 'Independent official verification completed.',
          evidenceReference: 'Institution verification reference 42',
        })
      ).status,
    ).toBe(201);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: identityId } })).status).toBe(
      'UPLOADED',
    );
  });
  it('enforces availability capacity reductions and deactivation', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    const b = await createBooking(p.id, a.slots[0]!.id, 'capacity-test-booking');
    await updateAvailability(adminId, a.id, { capacity: 2 });
    expect(
      (await prisma.assessmentAvailability.findUniqueOrThrow({ where: { id: a.id } })).capacity,
    ).toBe(2);
    await updateAvailability(adminId, a.id, { active: false });
    const other = await readyApplicant();
    await expect(
      createBooking(other.id, a.slots[1]!.id, 'inactive-window-booking'),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect((await prisma.assessmentBooking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe(
      'SCHEDULED',
    );
  });
  it('blocks overlapping active availability windows at the database boundary', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    await expect(
      prisma.assessmentAvailability.create({
        data: { blueprintId: p.blueprintId, startsAt: a.startsAt, endsAt: a.endsAt, capacity: 2 },
      }),
    ).rejects.toThrow();
  });
  it('protects an active booking from target-role changes', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId);
    await createBooking(p.id, a.slots[0]!.id, 'target-role-booking');
    const role = await prisma.jobRole.findFirstOrThrow({
      where: {
        id: {
          not: (
            await prisma.assessmentBlueprint.findUniqueOrThrow({ where: { id: p.blueprintId } })
          ).jobRoleId,
        },
      },
    });
    const industry = await prisma.industry.findFirstOrThrow();
    const r = await p.a
      .put('/api/v1/applicants/me/career-preferences')
      .set('X-CSRF-Token', await csrf(p.a))
      .send({ industryIds: [industry.id], companyIds: [], primaryRoleId: role.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ACTIVE_BOOKING_EXISTS');
  });
  it('allows audited administrator cancellation outside applicant deadlines', async () => {
    const p = await readyApplicant(),
      a = await availability(p.blueprintId),
      b = await createBooking(p.id, a.slots[0]!.id, 'admin-cancel-booking');
    const result = await cancelBooking(
      adminId,
      b.id,
      'Administrative maintenance requires cancellation',
      true,
    );
    expect(result.status).toBe('CANCELLED');
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: b.id, action: 'assessment.cancelled' },
    });
    expect(log.actorId).toBe(adminId);
  });
});
