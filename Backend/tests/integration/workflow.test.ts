import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import * as OTPAuth from 'otpauth';
import { prisma } from '../../src/config/prisma.js';
import { createApp } from '../../src/app.js';
import { seed } from '../../prisma/seed.js';
import {
  interviewer,
  type InterviewInput,
} from '../../src/integrations/assessment-interview/provider.js';
import { speechProviders } from '../../src/integrations/speech/providers.js';
import { env } from '../../src/config/env.js';
import { AppError } from '../../src/errors/app-error.js';
import { seedInstitutions } from '../../prisma/seed-institutions.js';
import { industryCatalogue, seedIndustries } from '../../prisma/seed-industries.js';
import { companyCatalogue, seedCompanies } from '../../prisma/seed-companies.js';
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
    .attach('file', pdf, { filename: 'identity.pdf', contentType: 'application/pdf' });
  expect(r.status).toBe(201);
  expect(r.body.data.title).toBe('identity.pdf');
  return r.body.data.id as string;
}
async function readyApplicant(withTarget = true) {
  const person = await applicant();
  const identityId = await uploadIdentity(person.a);
  await scanDocument(identityId);
  const token = await csrf(person.a);
  expect(
    (
      await person.a.patch('/api/v1/applicants/me').set('X-CSRF-Token', token).send({
        discipline: 'Mechatronics',
      })
    ).status,
  ).toBe(200);
  const b = await prisma.assessmentBlueprint.findFirstOrThrow({ where: { active: true } });
  let targetId: string | undefined;
  if (withTarget) {
    const link = await prisma.jobRoleIndustry.findFirstOrThrow({
      where: { jobRoleId: b.jobRoleId },
    });
    const target = await post(person.a, '/assessments/targets', {
      jobRoleId: b.jobRoleId,
      industryIds: [link.industryId],
      companyIds: [],
      qualificationIds: [],
    });
    expect(target.status).toBe(201);
    targetId = target.body.data.id;
    expect(
      (await post(person.a, `/assessments/targets/${targetId}/prepare`, { blueprintId: b.id }))
        .status,
    ).toBe(200);
  }
  return { ...person, blueprintId: b.id, identityId, targetId };
}
async function targetFixture() {
  const p = await readyApplicant(false);
  const blueprint = await prisma.assessmentBlueprint.findUniqueOrThrow({
    where: { id: p.blueprintId },
    include: {
      jobRole: { include: { industries: true } },
      framework: { include: { competencies: true } },
    },
  });
  const input = {
    jobRoleId: blueprint.jobRoleId,
    industryIds: [blueprint.jobRole.industries[0]!.industryId],
    companyIds: [] as string[],
    qualificationIds: [] as string[],
  };
  return { p, blueprint, input };
}
async function completeRequest(
  a: Agent,
  attemptId: string,
  results: object[],
  key = 'assessment-completion-key',
) {
  return a
    .post(`/api/v1/admin/assessment-attempts/${attemptId}/complete`)
    .set('X-CSRF-Token', await csrf(a))
    .set('Idempotency-Key', key)
    .send({ results });
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
const preflightInput = {
  confirmed: true,
  mode: 'TEXT',
  devices: { camera: 'NOT_REQUESTED', microphone: 'NOT_REQUESTED', speakerConfirmed: false },
  privacyAcknowledged: true,
  audioProcessingConsent: true,
};
async function interactionFixture(policy: object = {}, current = true) {
  const p = await readyApplicant(false);
  const manufacturing = await prisma.industry.findUniqueOrThrow({
    where: { name: 'Manufacturing and Industrial Production' },
  });
  const index = ++sequence;
  const role = await prisma.jobRole.create({
    data: {
      title: `Mechatronics interview test ${index}`,
      description: 'Isolated scenario assessment fixture.',
      industries: { create: { industryId: manufacturing.id } },
    },
  });
  const competencies = await Promise.all(
    [1, 2, 3].map((i) =>
      prisma.competency.create({
        data: {
          code: `INTERVIEW-${index}-${i}`,
          name: `Technical competency ${i}`,
          description: 'Evaluate safe engineering reasoning using the approved scenario.',
        },
      }),
    ),
  );
  const framework = await prisma.competencyFramework.create({
    data: {
      jobRoleId: role.id,
      title: 'Isolated approved rubric',
      version: 1,
      approved: true,
      competencies: {
        create: competencies.map((c, i) => ({
          competencyId: c.id,
          weight: i === 0 ? 40 : 30,
          requiredScore: 70,
        })),
      },
    },
  });
  const blueprint = await prisma.assessmentBlueprint.create({
    data: {
      jobRoleId: role.id,
      frameworkId: framework.id,
      version: 1,
      title: 'Isolated interview blueprint',
      durationMinutes: 60,
      instructions: 'Explain your reasoning and safe engineering practice.',
      active: true,
      interactionPolicy: policy,
    },
  });
  for (const [i, c] of competencies.entries()) {
    const scenario = await prisma.assessmentScenario.create({
      data: {
        code: `INTERVIEW-${index}-${i}`,
        version: 1,
        title: `Engineering scenario ${i + 1}`,
        prompt: `Approved engineering scenario ${i + 1}: explain how you would investigate a simulated sensor fault safely, using evidence and explicit assumptions.`,
        evaluationCriteria:
          'Assess evidence-based reasoning and safe fault isolation. Never score accent or confidence.',
        competencyIds: [c.id],
        maxFollowups: 1,
        approved: true,
      },
    });
    await prisma.blueprintScenario.create({
      data: { blueprintId: blueprint.id, scenarioId: scenario.id, position: i },
    });
  }
  const target = await post(p.a, '/assessments/targets', {
    jobRoleId: role.id,
    industryIds: [manufacturing.id],
    companyIds: [],
    qualificationIds: [],
  });
  expect(target.status).toBe(201);
  const prepared = await post(p.a, `/assessments/targets/${target.body.data.id}/prepare`, {
    blueprintId: blueprint.id,
  });
  expect(prepared.status).toBe(200);
  const a = await availability(blueprint.id);
  const booking = await createBooking(p.id, a.slots[0]!.id, `interaction-${index}`);
  if (current)
    await prisma.assessmentSlot.update({
      where: { id: booking.slotId },
      data: { startsAt: new Date(Date.now() - 60000), endsAt: new Date(Date.now() + 3600000) },
    });
  vi.spyOn(interviewer, 'ready').mockReturnValue(true);
  vi.spyOn(interviewer, 'invoke').mockImplementation(async (input: InterviewInput) =>
    input.followups === 0
      ? {
          action: 'FOLLOW_UP',
          message: 'What evidence would distinguish the controller from the sensor?',
          evaluations: [],
        }
      : {
          action: 'COMPLETE',
          message: 'Your response has been recorded. We will move to the next scenario.',
          evaluations: input.requirements.map((r) => ({
            competencyId: r.competencyId,
            score: 50,
            evidence:
              'The confirmed answer identifies a test but omits explicit verification of safe isolation.',
          })),
        },
  );
  return { p, blueprint, booking, attemptId: prepared.body.data.id as string };
}
function wav(seconds = 1) {
  const bytes = 16000 * 2 * seconds,
    buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF');
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(bytes, 40);
  return buffer;
}
async function answer(
  a: Agent,
  sessionId: string,
  promptId: string,
  key: string,
  extra: object = {},
) {
  return a
    .post(`/api/v1/assessment-sessions/${sessionId}/responses`)
    .set('X-CSRF-Token', await csrf(a))
    .set('Idempotency-Key', key)
    .send({
      promptId,
      origin: 'TEXT',
      confirmed: true,
      text: 'I would inspect the event logs and compare the observed sensor input against the approved drawing, using an authorised safe investigation.',
      ...extra,
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
      'TRUNCATE TABLE "User", "Role", "Permission", "Institution", "Industry", "Company", "JobRole", "Competency", "AssessmentScenario", "NotificationOutbox", "RateLimitBucket" CASCADE',
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
  it('supports the simplified profile and hides retired fields on existing records', async () => {
    const p = await applicant();
    const retired = {
      region: 'Nyeri',
      educationLevel: 'BACHELOR',
      institution: 'Example Technical Institution',
      professionalStatus: 'GRADUATE',
      graduationYear: 2025,
      summary: 'Retired profile description',
    };
    await prisma.applicantProfile.update({ where: { userId: p.id }, data: retired });
    expect((await p.a.get('/api/v1/applicants/me/onboarding')).body.data.profileComplete).toBe(
      false,
    );
    const changed = await p.a
      .patch('/api/v1/applicants/me')
      .set('X-CSRF-Token', await csrf(p.a))
      .send({ discipline: 'Mechatronics Engineering', country: 'KE' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.profile.discipline).toBe('Mechatronics Engineering');
    const read = await p.a.get('/api/v1/applicants/me');
    const admin = await adminSession();
    const inspection = await admin.get(`/api/v1/admin/applicants/${p.id}`);
    expect(inspection.status).toBe(200);
    for (const key of Object.keys(retired)) {
      expect(changed.body.data.profile).not.toHaveProperty(key);
      expect(read.body.data.profile).not.toHaveProperty(key);
      expect(inspection.body.data.profile).not.toHaveProperty(key);
    }
    expect((await p.a.get('/api/v1/applicants/me/onboarding')).body.data.profileComplete).toBe(
      true,
    );
    expect((await p.a.get('/api/v1/assessments/eligibility')).body.data.reasons).not.toContain(
      'PROFILE_INCOMPLETE',
    );
    const rejected = await p.a
      .patch('/api/v1/applicants/me')
      .set('X-CSRF-Token', await csrf(p.a))
      .send(retired);
    expect(rejected.status).toBe(422);
    expect((await p.a.get('/api/v1/applicants/me')).body.data.profile.discipline).toBe(
      'Mechatronics Engineering',
    );
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
  it('lists all 27 engineering industries and searches them for applicant selection', async () => {
    const p = await applicant();
    const response = await p.a.get('/api/v1/industries?limit=100');
    expect(response.status).toBe(200);
    expect(response.body.meta.total).toBe(27);
    expect(response.body.data.map((row: { name: string }) => row.name).sort()).toEqual(
      industryCatalogue.map((row) => row.name).sort(),
    );
    expect(
      response.body.data.every((row: { description: string }) => row.description.length > 0),
    ).toBe(true);
    const search = await p.a.get('/api/v1/industries?search=water');
    expect(search.status).toBe(200);
    expect(search.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Water, Wastewater and Sanitation',
    ]);
    const softwareRole = await prisma.jobRole.findUniqueOrThrow({
      where: { title: 'Industrial Software Engineer' },
      include: { industries: { include: { industry: true } } },
    });
    expect(softwareRole.industries.map((link) => link.industry.name)).toEqual([
      'Software, Computing and Digital Infrastructure',
    ]);
  });
  it('reseeds industries without overwriting maintained entries or breaking existing links', async () => {
    const p = await readyApplicant();
    const target = await prisma.assessmentTarget.findUniqueOrThrow({
      where: { id: p.targetId! },
      include: { industries: true, companies: true },
    });
    const industryId = target.industries[0]!.industryId;
    const original = await prisma.industry.findUniqueOrThrow({ where: { id: industryId } });
    const custom = await prisma.industry.create({
      data: {
        name: 'Custom catalogue entry (test)',
        description: 'Preserve older catalogue entries.',
      },
    });
    const total = await prisma.industry.count();
    const relations = await prisma.industry.findUniqueOrThrow({
      where: { id: industryId },
      include: { companies: true, jobRoles: true, assessmentTargets: true },
    });
    try {
      await prisma.industry.update({
        where: { id: industryId },
        data: { active: false, description: 'Administrator-maintained description.' },
      });
      expect(await seedIndustries()).toEqual({ catalogueSize: 27, created: 0 });
      expect((await seedIndustries()).created).toBe(0);
      expect(await prisma.industry.count()).toBe(total);
      expect(await prisma.industry.findUnique({ where: { id: industryId } })).toMatchObject({
        active: false,
        description: 'Administrator-maintained description.',
      });
      expect(await prisma.industry.findUnique({ where: { id: custom.id } })).toEqual(custom);
      const after = await prisma.industry.findUniqueOrThrow({
        where: { id: industryId },
        include: { companies: true, jobRoles: true, assessmentTargets: true },
      });
      expect(after.companies).toEqual(relations.companies);
      expect(after.jobRoles).toEqual(relations.jobRoles);
      expect(after.assessmentTargets).toEqual(relations.assessmentTargets);
      expect(
        await prisma.assessmentTarget.findUnique({
          where: { id: p.targetId! },
          include: { industries: true, companies: true },
        }),
      ).toEqual(target);
      expect(
        (await p.a.get(`/api/v1/industries?search=${encodeURIComponent(original.name)}`)).body.data,
      ).toEqual([]);
    } finally {
      await prisma.industry.update({
        where: { id: industryId },
        data: { active: original.active, description: original.description },
      });
      await prisma.industry.delete({ where: { id: custom.id } });
    }
  });
  it('exposes seeded employers through company search and industry filters', async () => {
    const p = await applicant();
    const all = await p.a.get('/api/v1/companies?limit=100');
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(40);
    expect(all.body.data.map((row: { name: string }) => row.name).sort()).toEqual(
      companyCatalogue.companies.map((row) => row.name).sort(),
    );
    const industry = await prisma.industry.findUniqueOrThrow({
      where: { name: 'Automotive and Electric Mobility' },
    });
    const match = await p.a.get(`/api/v1/companies?search=kiira&industryIds=${industry.id}`);
    expect(match.status).toBe(200);
    expect(match.body.data).toHaveLength(1);
    expect(match.body.data[0]).toMatchObject({ name: 'Kiira Motors Corporation', country: 'UG' });
    expect(
      match.body.data[0].industries.some(
        (link: { industryId: string }) => link.industryId === industry.id,
      ),
    ).toBe(true);
    const wrongIndustry = await prisma.industry.findUniqueOrThrow({
      where: { name: 'Pharmaceuticals and Biotechnology' },
    });
    expect(
      (await p.a.get(`/api/v1/companies?search=kiira&industryIds=${wrongIndustry.id}`)).body.data,
    ).toEqual([]);
  });
  it('repairs older career links and prepares a Mechatronics target with its seeded blueprint', async () => {
    const career = await prisma.jobRole.findUniqueOrThrow({
      where: { title: 'Mechatronics Engineer' },
    });
    const industryNames = [
      'Manufacturing and Industrial Production',
      'Energy and Power',
      'Automotive and Electric Mobility',
    ];
    const industries = await prisma.industry.findMany({ where: { name: { in: industryNames } } });
    await prisma.jobRoleIndustry.delete({
      where: { jobRoleId_industryId: { jobRoleId: career.id, industryId: industries[0]!.id } },
    });
    await seed();
    await seed();
    expect(await prisma.jobRole.findUnique({ where: { id: career.id } })).toEqual(career);
    expect(
      await prisma.jobRoleIndustry.count({
        where: { jobRoleId: career.id, industryId: { in: industries.map((row) => row.id) } },
      }),
    ).toBe(3);
    const companies = await prisma.company.findMany({
      where: {
        name: {
          in: ['Gearbox Europlacer', 'Kenya Electricity Generating Company (KenGen)', 'BasiGo'],
        },
      },
    });
    expect(companies).toHaveLength(3);
    const p = await readyApplicant(false);
    const response = await post(p.a, '/assessments/targets', {
      jobRoleId: career.id,
      industryIds: industries.map((row) => row.id),
      companyIds: companies.map((row) => row.id),
      qualificationIds: [],
    });
    expect(response.status).toBe(201);
    expect(response.body.data.jobRoleId).toBe(career.id);
    expect(response.body.data.industries).toHaveLength(3);
    expect(response.body.data.companies).toHaveLength(3);
    const blueprints = await prisma.assessmentBlueprint.findMany({
      where: { jobRoleId: career.id },
      include: { framework: true },
    });
    expect(blueprints).toHaveLength(1);
    const blueprint = blueprints[0]!;
    expect(blueprint).toMatchObject({ active: true, durationMinutes: 60 });
    expect(blueprint.framework).toMatchObject({
      jobRoleId: career.id,
      approved: true,
      scope: 'CORE',
    });
    const prepared = await post(p.a, `/assessments/targets/${response.body.data.id}/prepare`, {
      blueprintId: blueprint.id,
    });
    expect(prepared.status).toBe(200);
    expect(prepared.body.data.blueprintId).toBe(blueprint.id);
    expect(prepared.body.data.requirements).toHaveLength(3);
    expect(
      prepared.body.data.requirements.reduce(
        (sum: number, row: { weight: number }) => sum + row.weight,
        0,
      ),
    ).toBe(100);
    expect(
      prepared.body.data.requirements.every(
        (row: { requiredScore: number }) => row.requiredScore === 70,
      ),
    ).toBe(true);
    expect(
      (await p.a.get(`/api/v1/assessments/targets/${response.body.data.id}`)).body.data.status,
    ).toBe('PREPARED');
  });
  it('reseeds companies without overwriting admin edits and restores missing links only once', async () => {
    const original = await prisma.company.findUniqueOrThrow({ where: { name: 'Kenya Airways' } });
    const unrelated = await prisma.company.create({
      data: { name: 'Maintained test employer', description: 'Not part of the seed catalogue.' },
    });
    const links = await prisma.companyIndustry.findMany({ where: { companyId: original.id } });
    const total = await prisma.company.count();
    try {
      await prisma.company.update({
        where: { id: original.id },
        data: {
          name: 'KENYA  Airways',
          active: false,
          country: 'TZ',
          website: 'https://maintained.example',
          description: 'Administrator-maintained description.',
        },
      });
      await prisma.companyIndustry.delete({
        where: {
          companyId_industryId: { companyId: original.id, industryId: links[0]!.industryId },
        },
      });
      expect(await seedCompanies()).toEqual({
        catalogueSize: 40,
        created: 0,
        industryLinksCreated: 1,
      });
      expect(await seedCompanies()).toEqual({
        catalogueSize: 40,
        created: 0,
        industryLinksCreated: 0,
      });
      expect(await prisma.company.count()).toBe(total);
      expect(await prisma.company.findUnique({ where: { id: original.id } })).toMatchObject({
        name: 'KENYA  Airways',
        active: false,
        country: 'TZ',
        website: 'https://maintained.example',
        description: 'Administrator-maintained description.',
      });
      expect(await prisma.company.findUnique({ where: { id: unrelated.id } })).toEqual(unrelated);
      expect(await prisma.companyIndustry.count({ where: { companyId: original.id } })).toBe(
        links.length,
      );
    } finally {
      await prisma.company.update({
        where: { id: original.id },
        data: {
          name: original.name,
          active: original.active,
          country: original.country,
          website: original.website,
          description: original.description,
        },
      });
      await prisma.company.delete({ where: { id: unrelated.id } });
    }
  });
  it('rejects ambiguous existing company names without changing the catalogue', async () => {
    const duplicate = await prisma.company.create({
      data: { name: 'KENYA AIRWAYS', description: 'Ambiguous imported record.' },
    });
    const count = await prisma.company.count();
    const linkCount = await prisma.companyIndustry.count();
    try {
      await expect(seedCompanies()).rejects.toThrow('Ambiguous existing company');
      expect(await prisma.company.count()).toBe(count);
      expect(await prisma.companyIndustry.count()).toBe(linkCount);
    } finally {
      await prisma.company.delete({ where: { id: duplicate.id } });
    }
  });
  it('searches institution names and aliases, filters types and paginates without duplicates', async () => {
    const p = await applicant();
    const abbreviation = await p.a.get(
      '/api/v1/institutions?search=JKUAT&type=UNIVERSITY&limit=10',
    );
    expect(abbreviation.status).toBe(200);
    expect(abbreviation.body.data).toHaveLength(1);
    expect(abbreviation.body.data[0].name).toBe(
      'Jomo Kenyatta University of Agriculture and Technology',
    );
    expect((await p.a.get('/api/v1/institutions?search=JKUAT&type=COLLEGE')).body.data).toEqual([]);
    const tvet = await p.a.get('/api/v1/institutions?offersTvet=true&limit=10');
    expect(tvet.body.data).toHaveLength(10);
    expect(tvet.body.data.every((row: { offersTvet: boolean }) => row.offersTvet)).toBe(true);
    const first = await p.a.get('/api/v1/institutions?type=COLLEGE&page=1&limit=5');
    const second = await p.a.get('/api/v1/institutions?type=COLLEGE&page=2&limit=5');
    expect(first.body.meta.total).toBeGreaterThan(5);
    expect(
      new Set([...first.body.data, ...second.body.data].map((row: { id: string }) => row.id)).size,
    ).toBe(10);
    expect((await p.a.get('/api/v1/institutions?type=invalid')).status).toBe(422);
  });
  it('seeds the directory repeatedly without duplicating or reactivating existing institutions', async () => {
    const initial = await prisma.institution.count();
    const aliases = await prisma.institutionAlias.count();
    const row = await prisma.institution.findUniqueOrThrow({
      where: { name: 'University of Nairobi' },
    });
    await prisma.institution.update({
      where: { id: row.id },
      data: { active: false, website: 'https://example.test/maintained' },
    });
    try {
      expect((await seedInstitutions()).created).toBe(0);
      expect((await seedInstitutions()).created).toBe(0);
      expect(await prisma.institution.count()).toBe(initial);
      expect(await prisma.institutionAlias.count()).toBe(aliases);
      expect(await prisma.institution.findUnique({ where: { id: row.id } })).toMatchObject({
        active: false,
        website: 'https://example.test/maintained',
      });
    } finally {
      await prisma.institution.update({
        where: { id: row.id },
        data: { active: row.active, website: row.website },
      });
    }
  });
  it('supports institution search, typed institutions and linked quarantined transcripts', async () => {
    const p = await applicant();
    await uploadIdentity(p.a);
    const institutions = await p.a.get('/api/v1/institutions?search=Dedan');
    expect(institutions.status).toBe(200);
    expect(institutions.body.data).toHaveLength(1);
    const institution = institutions.body.data[0];
    const r = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'DIPLOMA')
      .field('courseName', 'Mechatronics Engineering')
      .field('institutionId', institution.id)
      .attach('file', pdf, { filename: 'diploma.pdf', contentType: 'application/pdf' })
      .attach('transcripts', pdf, { filename: 'year-1.pdf', contentType: 'application/pdf' })
      .attach('transcripts', pdf, { filename: 'year-2.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      title: 'diploma.pdf',
      courseName: 'Mechatronics Engineering',
      institutionName: institution.name,
      scanStatus: 'QUARANTINED',
    });
    expect(r.body.data.transcripts).toHaveLength(2);
    for (const transcript of r.body.data.transcripts) {
      expect(transcript).toMatchObject({
        category: 'TRANSCRIPT',
        courseName: 'Mechatronics Engineering',
        qualificationId: r.body.data.id,
        institutionId: institution.id,
        scanStatus: 'QUARANTINED',
      });
      expect((await p.a.get(`/api/v1/documents/${transcript.id}/download`)).status).toBe(409);
      await scanDocument(transcript.id);
      expect((await p.a.get(`/api/v1/documents/${transcript.id}/download`)).status).toBe(200);
    }
    const other = await applicant();
    expect((await other.a.get(`/api/v1/documents/${r.body.data.transcripts[0].id}`)).status).toBe(
      404,
    );
    expect(
      (await p.a.get(`/api/v1/documents/${r.body.data.id}`)).body.data.transcripts,
    ).toHaveLength(2);
    const replacement = await p.a
      .post(`/api/v1/documents/${r.body.data.id}/replace`)
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'DIPLOMA')
      .field('courseName', 'Advanced Mechatronics')
      .field('institutionName', 'Unlisted Institute')
      .attach('file', pdf, { filename: 'updated-diploma.pdf', contentType: 'application/pdf' })
      .attach('transcripts', pdf, {
        filename: 'updated-transcript.pdf',
        contentType: 'application/pdf',
      });
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.transcripts[0].qualificationId).toBe(replacement.body.data.id);
    expect(replacement.body.data.institutionName).toBe('Unlisted Institute');
    expect(replacement.body.data.courseName).toBe('Advanced Mechatronics');
    expect(await prisma.institution.count({ where: { name: 'Unlisted Institute' } })).toBe(0);
    expect(
      (await p.a.get(`/api/v1/documents/${r.body.data.id}`)).body.data.transcripts,
    ).toHaveLength(2);
  });
  it('enforces required attachments and cleans up failed uploads', async () => {
    const p = await applicant();
    await uploadIdentity(p.a);
    const upload = async (category: string, transcript?: Buffer, institutionId?: string) => {
      const req = p.a
        .post('/api/v1/documents')
        .set('X-CSRF-Token', await csrf(p.a))
        .field('category', category)
        .field('courseName', 'Software Engineering')
        .field(
          institutionId ? 'institutionId' : 'institutionName',
          institutionId ?? 'Local College',
        )
        .attach('file', pdf, { filename: 'certificate.pdf', contentType: 'application/pdf' });
      if (transcript)
        req.attach('transcripts', transcript, {
          filename: 'transcript.pdf',
          contentType: 'application/pdf',
        });
      return req;
    };
    const count = await prisma.document.count({ where: { applicantId: p.id } });
    const stored = files.size;
    expect((await upload('BACHELOR')).body.error.code).toBe('TRANSCRIPT_REQUIRED');
    expect((await upload('BACHELOR', Buffer.from('not a PDF'))).status).toBe(415);
    expect((await upload('SHORT_COURSE', pdf)).body.error.code).toBe('TRANSCRIPT_NOT_ALLOWED');
    expect((await upload('BACHELOR', pdf, crypto.randomUUID())).body.error.code).toBe(
      'INSTITUTION_INVALID',
    );
    expect(await prisma.document.count({ where: { applicantId: p.id } })).toBe(count);
    expect(files.size).toBe(stored);
    const inactive = await prisma.institution.create({
      data: { name: `Inactive ${++sequence}`, active: false },
    });
    expect(
      (await p.a.get(`/api/v1/institutions?search=${encodeURIComponent(inactive.name)}`)).body.data,
    ).toHaveLength(0);
    expect((await upload('SHORT_COURSE', undefined, inactive.id)).body.error.code).toBe(
      'INSTITUTION_INVALID',
    );
    const short = await upload('SHORT_COURSE');
    expect(short.status).toBe(201);
    expect(short.body.data).toMatchObject({
      title: 'certificate.pdf',
      institutionName: 'Local College',
      expiresAt: null,
    });
    expect((await upload('PROFESSIONAL_REGISTRATION')).status).toBe(422);
    const professional = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'PROFESSIONAL_REGISTRATION')
      .field('issuer', 'Engineering Board')
      .field('issuedAt', '2026-01-01')
      .field('expiresAt', '2028-12-31')
      .attach('file', pdf, { filename: 'licence.pdf', contentType: 'application/pdf' });
    expect(professional.status).toBe(201);
    expect(professional.body.data.expiresAt).toBe('2028-12-31T00:00:00.000Z');
  });
  it.each(['BACHELOR', 'MASTER', 'PHD', 'DIPLOMA'])(
    'requires certificate, transcripts and course metadata for %s',
    async (category) => {
      const p = await applicant();
      await uploadIdentity(p.a);
      const upload = async (courseName: string, certificate = true, transcript = true) => {
        const req = p.a
          .post('/api/v1/documents')
          .set('X-CSRF-Token', await csrf(p.a))
          .field('category', category)
          .field('courseName', courseName)
          .field('issuedAt', '  ')
          .field('expiresAt', ' \t ')
          .field('institutionName', 'Unlisted Engineering College');
        if (certificate)
          req.attach('file', pdf, { filename: 'certificate.pdf', contentType: 'application/pdf' });
        if (transcript)
          req.attach('transcripts', pdf, {
            filename: 'transcript.pdf',
            contentType: 'application/pdf',
          });
        return req;
      };
      const missingCourse = await upload('');
      expect(missingCourse.status).toBe(422);
      expect(
        missingCourse.body.error.details.some(
          (issue: { path: string }) => issue.path === 'courseName',
        ),
      ).toBe(true);
      expect((await upload('Software Engineering', false)).body.error.code).toBe('FILE_REQUIRED');
      expect((await upload('Software Engineering', true, false)).body.error.code).toBe(
        'TRANSCRIPT_REQUIRED',
      );
      const response = await upload('Software Engineering');
      expect(response.status).toBe(201);
      expect(response.body.data.issuedAt).toBeNull();
      expect(response.body.data.expiresAt).toBeNull();
      expect(response.body.data).toMatchObject({
        category,
        courseName: 'Software Engineering',
        institutionName: 'Unlisted Engineering College',
      });
      expect(response.body.data.transcripts[0]).toMatchObject({
        qualificationId: response.body.data.id,
        courseName: 'Software Engineering',
      });
      expect(
        (await prisma.document.findUniqueOrThrow({ where: { id: response.body.data.id } }))
          .courseName,
      ).toBe('Software Engineering');
    },
  );
  it('supports short courses, industry certifications, professional credentials, standalone transcripts and other documents', async () => {
    const p = await applicant();
    await uploadIdentity(p.a);
    const cases = [
      { category: 'SHORT_COURSE', courseName: 'Software Engineering' },
      {
        category: 'INDUSTRY_CERTIFICATION',
        certificationName: 'Automation Professional',
        issuer: 'Automation Institute',
        issuedAt: '2026-01-01',
      },
      {
        category: 'PROFESSIONAL_REGISTRATION',
        issuer: 'Engineering Board',
        issuedAt: '2026-01-01',
        expiresAt: '2028-12-31',
      },
      {
        category: 'TRANSCRIPT',
        institutionName: 'Engineering College',
        courseName: 'Mechatronics Engineering',
      },
      { category: 'OTHER', title: 'Engineering competition award' },
    ];
    for (const fields of cases) {
      const req = p.a.post('/api/v1/documents').set('X-CSRF-Token', await csrf(p.a));
      for (const [name, value] of Object.entries(fields)) req.field(name, value);
      const result = await req.attach('file', pdf, {
        filename: 'credential.pdf',
        contentType: 'application/pdf',
      });
      expect(result.status).toBe(201);
      expect(result.body.data.category).toBe(fields.category);
      if (fields.courseName) expect(result.body.data.courseName).toBe(fields.courseName);
      if (fields.certificationName)
        expect(result.body.data.certificationName).toBe(fields.certificationName);
      if (fields.issuer) expect(result.body.data.issuer).toBe(fields.issuer);
      if (fields.category === 'OTHER') expect(result.body.data.title).toBe(fields.title);
      if (fields.category === 'INDUSTRY_CERTIFICATION')
        expect(result.body.data.expiresAt).toBeNull();
      expect(result.body.data.transcripts).toEqual([]);
    }
  });
  it('enforces file size and transcript count without storing partial submissions', async () => {
    const p = await applicant();
    await uploadIdentity(p.a);
    const count = await prisma.document.count({ where: { applicantId: p.id } });
    const oversized = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'SHORT_COURSE')
      .field('courseName', 'Software Engineering')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), {
        filename: 'large.pdf',
        contentType: 'application/pdf',
      });
    expect(oversized.status).toBe(413);
    const req = p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'MASTER')
      .field('courseName', 'Mechatronics Engineering')
      .field('institutionName', 'Engineering College')
      .attach('file', pdf, { filename: 'certificate.pdf', contentType: 'application/pdf' });
    for (let i = 0; i < 6; i++)
      req.attach('transcripts', pdf, { filename: `year-${i}.pdf`, contentType: 'application/pdf' });
    expect((await req).status).toBe(413);
    expect(await prisma.document.count({ where: { applicantId: p.id } })).toBe(count);
    const maximum = p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'MASTER')
      .field('courseName', 'Mechatronics Engineering')
      .field('institutionName', 'Engineering College')
      .attach('file', pdf, { filename: 'certificate.pdf', contentType: 'application/pdf' });
    for (let i = 0; i < 5; i++)
      maximum.attach('transcripts', pdf, {
        filename: `year-${i}.pdf`,
        contentType: 'application/pdf',
      });
    const accepted = await maximum;
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.transcripts).toHaveLength(5);
  });
  it('requires identity before academic uploads', async () => {
    const p = await applicant();
    const r = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'BACHELOR')
      .field('courseName', 'Mechatronics Engineering')
      .field('title', 'BEng Mechatronics')
      .field('institutionName', 'Example College')
      .attach('transcripts', pdf, { filename: 'transcript.pdf', contentType: 'application/pdf' })
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
  it('rejects invalid careers and duplicate target selections', async () => {
    const { p, input } = await targetFixture();
    expect(
      (await post(p.a, '/assessments/targets', { ...input, jobRoleId: crypto.randomUUID() }))
        .status,
    ).toBe(422);
    expect(
      (
        await post(p.a, '/assessments/targets', {
          ...input,
          industryIds: [input.industryIds[0], input.industryIds[0]],
        })
      ).status,
    ).toBe(422);
  });
  it('enforces target rank limits independently of the API', async () => {
    const { p, input } = await targetFixture();
    const target = await post(p.a, '/assessments/targets', input);
    expect(target.status).toBe(201);
    const industry = await prisma.industry.findFirstOrThrow({
      where: { id: { notIn: input.industryIds } },
    });
    await expect(
      prisma.assessmentTargetIndustry.create({
        data: {
          targetId: target.body.data.id,
          industryId: industry.id,
          rank: 4,
        },
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
      .field('courseName', 'Mechatronics Engineering')
      .field('title', 'BEng Mechatronics test certificate')
      .field('institutionName', 'Example College')
      .attach('transcripts', pdf, { filename: 'transcript.pdf', contentType: 'application/pdf' })
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
      .put(`/api/v1/assessments/targets/${p.targetId}`)
      .set('X-CSRF-Token', await csrf(p.a))
      .send({ industryIds: [industry.id], companyIds: [], jobRoleId: role.id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('TARGET_LOCKED');
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
  it('allows one active target under concurrent requests and draft edits, including at the database boundary', async () => {
    const { p, input } = await targetFixture();
    const token = await csrf(p.a);
    const responses = await Promise.all(
      [1, 2].map(() =>
        p.a.post('/api/v1/assessments/targets').set('X-CSRF-Token', token).send(input),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const target = responses.find((r) => r.status === 201)!.body.data;
    expect(target.status).toBe('DRAFT');
    expect((await p.a.get('/api/v1/assessments/targets')).body.meta.total).toBe(1);
    await expect(
      prisma.assessmentTarget.create({ data: { applicantId: p.id, jobRoleId: input.jobRoleId } }),
    ).rejects.toThrow();
    const other = await prisma.jobRole.findFirstOrThrow({
      where: { id: { not: input.jobRoleId } },
      include: { industries: true },
    });
    const update = {
      ...input,
      jobRoleId: other.id,
      industryIds: [other.industries[0]!.industryId],
    };
    const changed = await p.a
      .put(`/api/v1/assessments/targets/${target.id}`)
      .set('X-CSRF-Token', await csrf(p.a))
      .send(update);
    expect(changed.status).toBe(200);
    expect(changed.body.data.jobRoleId).toBe(other.id);
    const eligibility = await p.a.get('/api/v1/assessments/eligibility');
    const blueprints = await prisma.assessmentBlueprint.findMany({
      where: { jobRoleId: other.id },
    });
    expect(
      eligibility.body.data.blueprints.every((b: { blueprintId: string }) =>
        blueprints.some((row) => row.id === b.blueprintId),
      ),
    ).toBe(true);
  });
  it('rejects duplicate choices, unrelated sectors/employers and unowned or unclean qualifications', async () => {
    const { p, input } = await targetFixture();
    const unrelated = await prisma.industry.findFirstOrThrow({
      where: { active: true, jobRoles: { none: { jobRoleId: input.jobRoleId } } },
    });
    expect(
      (
        await post(p.a, '/assessments/targets', {
          ...input,
          industryIds: [input.industryIds[0], input.industryIds[0]],
        })
      ).status,
    ).toBe(422);
    expect(
      (await post(p.a, '/assessments/targets', { ...input, industryIds: [unrelated.id] })).body
        .error.code,
    ).toBe('CAREER_INDUSTRY_MISMATCH');
    const company = await prisma.company.create({
      data: {
        name: `Unrelated employer ${++sequence}`,
        description: 'Isolated fixture employer',
        industries: { create: { industryId: unrelated.id } },
      },
    });
    expect(
      (await post(p.a, '/assessments/targets', { ...input, companyIds: [company.id] })).body.error
        .code,
    ).toBe('COMPANY_INDUSTRY_MISMATCH');
    const other = await readyApplicant();
    expect(
      (await post(p.a, '/assessments/targets', { ...input, qualificationIds: [other.identityId] }))
        .body.error.code,
    ).toBe('QUALIFICATION_INVALID');
    const qualification = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'SHORT_COURSE')
      .field('courseName', 'Mechatronics Engineering')
      .attach('file', pdf, { filename: 'course.pdf', contentType: 'application/pdf' });
    expect(qualification.status).toBe(201);
    expect(
      (
        await post(p.a, '/assessments/targets', {
          ...input,
          qualificationIds: [qualification.body.data.id],
        })
      ).status,
    ).toBe(422);
  });
  it('checks qualification ownership even for clean academic documents', async () => {
    const { p, input } = await targetFixture();
    const other = await readyApplicant();
    const upload = await other.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(other.a))
      .field('category', 'SHORT_COURSE')
      .field('courseName', 'Mechatronics Engineering')
      .attach('file', pdf, { filename: 'course.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    await scanDocument(upload.body.data.id);
    expect(
      (
        await post(p.a, '/assessments/targets', {
          ...input,
          qualificationIds: [upload.body.data.id],
        })
      ).body.error.code,
    ).toBe('QUALIFICATION_INVALID');
  });
  it('filters career and company lookup by selected industries and validates the filter', async () => {
    const { p, input } = await targetFixture();
    const unrelated = await prisma.industry.findFirstOrThrow({
      where: { active: true, jobRoles: { none: { jobRoleId: input.jobRoleId } } },
    });
    const company = await prisma.company.create({
      data: {
        name: `Filtered employer ${++sequence}`,
        description: 'Isolated catalogue filter fixture',
        industries: { create: { industryId: unrelated.id } },
      },
    });
    const selected = await p.a.get(
      `/api/v1/companies?industryIds=${input.industryIds.join(',')}&limit=100`,
    );
    expect(selected.status).toBe(200);
    expect(selected.body.data.some((c: { id: string }) => c.id === company.id)).toBe(false);
    expect(
      (await p.a.get(`/api/v1/companies?industryIds=${unrelated.id}&limit=100`)).body.data.some(
        (c: { id: string }) => c.id === company.id,
      ),
    ).toBe(true);
    const careers = await p.a.get(
      `/api/v1/careers?industryIds=${input.industryIds.join(',')}&limit=100`,
    );
    expect(careers.status).toBe(200);
    expect(
      (
        await p.a.get(
          `/api/v1/careers?industryIds=${[...input.industryIds, unrelated.id].join(',')}&limit=100`,
        )
      ).body.data.some((role: { id: string }) => role.id === input.jobRoleId),
    ).toBe(false);
    expect(careers.body.data.some((role: { id: string }) => role.id === input.jobRoleId)).toBe(
      true,
    );
    expect((await p.a.get('/api/v1/careers?industryIds=invalid')).status).toBe(422);
    expect(
      (
        await p.a.get(
          `/api/v1/companies?industryIds=${input.industryIds[0]},${input.industryIds[0]}`,
        )
      ).status,
    ).toBe(422);
  });
  it('requires an explicit prepared target and removes preference compatibility routes', async () => {
    const { p, blueprint, input } = await targetFixture();
    const token = await csrf(p.a);
    expect((await p.a.get('/api/v1/applicants/me/career-preferences')).status).toBe(404);
    expect(
      (
        await p.a
          .put('/api/v1/applicants/me/career-preferences')
          .set('X-CSRF-Token', token)
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (await post(p.a, `/assessments/bookings/${crypto.randomUUID()}/prepare`, {})).status,
    ).toBe(404);
    expect((await eligibility(p.id)).reasons).toContain('TARGET_REQUIRED');
    const window = await availability(blueprint.id);
    await expect(
      createBooking(p.id, window.slots[0]!.id, 'no-target-booking'),
    ).rejects.toMatchObject({ code: 'ASSESSMENT_NOT_ELIGIBLE' });
    expect(await prisma.assessmentTarget.count({ where: { applicantId: p.id } })).toBe(0);
    const target = await post(p.a, '/assessments/targets', input);
    expect(target.status).toBe(201);
    await expect(
      createBooking(p.id, window.slots[0]!.id, 'draft-target-booking'),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_PREPARED' });
    expect(await prisma.assessmentAttempt.count({ where: { targetId: target.body.data.id } })).toBe(
      0,
    );
    expect(
      (
        await post(p.a, `/assessments/targets/${target.body.data.id}/prepare`, {
          blueprintId: blueprint.id,
        })
      ).status,
    ).toBe(200);
    const booking = await createBooking(p.id, window.slots[0]!.id, 'prepared-target-booking');
    expect(booking.targetId).toBe(target.body.data.id);
  });
  it('creates no learning gaps for full demonstrated scores and completes results idempotently under concurrent retries', async () => {
    const { p, blueprint, input } = await targetFixture();
    const target = await post(p.a, '/assessments/targets', input);
    expect(target.status).toBe(201);
    const prepared = await post(p.a, `/assessments/targets/${target.body.data.id}/prepare`, {
      blueprintId: blueprint.id,
    });
    expect(prepared.status).toBe(200);
    const attempt = prepared.body.data;
    const window = await availability(blueprint.id);
    const booking = await createBooking(p.id, window.slots[0]!.id, 'no-gaps-assessment');
    await prisma.assessmentSlot.update({
      where: { id: booking.slotId },
      data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000) },
    });
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).status).toBe(200);
    await expect(
      cancelBooking(p.id, booking.id, 'Cannot cancel a started assessment'),
    ).rejects.toMatchObject({ code: 'ASSESSMENT_IN_PROGRESS' });
    const admin = await adminSession();
    const token = await csrf(admin);
    const results = attempt.requirements.map((r: { id: string }) => ({
      requirementId: r.id,
      score: 100,
      evidence: 'All approved competency criteria were demonstrated in observed practical work.',
    }));
    const responses = await Promise.all(
      [1, 2].map(() =>
        admin
          .post(`/api/v1/admin/assessment-attempts/${attempt.id}/complete`)
          .set('X-CSRF-Token', token)
          .set('Idempotency-Key', 'concurrent-completion-key')
          .send({ results }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const completed = responses[0]!.body.data;
    expect(completed.overallScore).toBe(100);
    expect(completed.learningPlan.status).toBe('COMPLETED');
    expect(completed.learningPlan.items).toEqual([]);
    expect(await prisma.learningPlan.count({ where: { attemptId: attempt.id } })).toBe(1);
    expect((await p.a.get('/api/v1/assessments/eligibility')).body.data.reasons).toContain(
      'TARGET_REQUIRED',
    );
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).status).toBe(409);
  });
  it('freezes all four inputs, merges approved context rubrics, records results and unlocks the next career without losing history', async () => {
    const { p, blueprint, input } = await targetFixture();
    const admin = await adminSession();
    const company = await prisma.company.create({
      data: {
        name: `Automation employer ${++sequence}`,
        description: 'Isolated fixture employer',
        industries: { create: { industryId: input.industryIds[0]! } },
      },
    });
    const upload = await p.a
      .post('/api/v1/documents')
      .set('X-CSRF-Token', await csrf(p.a))
      .field('category', 'SHORT_COURSE')
      .field('courseName', 'Mechatronics Engineering')
      .attach('file', pdf, { filename: 'course.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);
    await scanDocument(upload.body.data.id);
    input.companyIds = [company.id];
    input.qualificationIds = [upload.body.data.id];
    const competencyId = blueprint.framework.competencies[0]!.competencyId;
    let version = (
      await prisma.competencyFramework.aggregate({
        where: { jobRoleId: input.jobRoleId },
        _max: { version: true },
      })
    )._max.version!;
    const framework = async (
      scope: string,
      context: object,
      requiredScore: number,
      approved = true,
    ) => {
      const response = await post(admin, '/admin/frameworks', {
        jobRoleId: input.jobRoleId,
        version: ++version,
        title: `${scope} fixture requirements`,
        scope,
        ...context,
        approved,
        competencies: [
          {
            competencyId,
            weight: 100,
            requiredScore,
            learningObjective:
              'Practise the approved automation exercises and demonstrate the required competency.',
            learningResources: ['https://example.test/approved-learning'],
          },
        ],
      });
      expect(response.status).toBe(201);
      return response.body.data;
    };
    const oldIndustry = await framework('INDUSTRY', { industryId: input.industryIds[0] }, 80);
    const industry = await framework('INDUSTRY', { industryId: input.industryIds[0] }, 90);
    const employer = await framework('COMPANY', { companyId: company.id }, 85);
    const course = await framework('COURSE', { courseName: 'Mechatronics Engineering' }, 60);
    const unapproved = await framework(
      'INDUSTRY',
      { industryId: input.industryIds[0] },
      100,
      false,
    );
    const created = await post(p.a, '/assessments/targets', input);
    expect(created.status).toBe(201);
    const targetId = created.body.data.id;
    expect(JSON.stringify(created.body)).not.toContain('storageKey');
    const prepared = await post(p.a, `/assessments/targets/${targetId}/prepare`, {
      blueprintId: blueprint.id,
    });
    expect(prepared.status).toBe(200);
    const attempt = prepared.body.data;
    expect(attempt.contextSnapshot.qualifications[0].courseName).toBe('Mechatronics Engineering');
    expect(attempt.contextSnapshot.companies[0].id).toBe(company.id);
    const contextual = attempt.requirements.find(
      (r: { competencyId: string }) => r.competencyId === competencyId,
    );
    expect(contextual.requiredScore).toBe(90);
    expect(contextual.sources.map((s: { frameworkId: string }) => s.frameworkId)).toEqual(
      expect.arrayContaining([industry.id, employer.id, course.id]),
    );
    expect(contextual.sources.map((s: { frameworkId: string }) => s.frameworkId)).not.toEqual(
      expect.arrayContaining([oldIndustry.id]),
    );
    expect(JSON.stringify(attempt)).not.toContain(unapproved.id);
    const snapshot = attempt.contextSnapshot;
    await prisma.applicantProfile.update({
      where: { userId: p.id },
      data: { discipline: 'Later course name' },
    });
    await prisma.company.update({
      where: { id: company.id },
      data: { name: `Renamed employer ${++sequence}` },
    });
    expect(
      (await p.a.get(`/api/v1/assessments/attempts/${attempt.id}`)).body.data.contextSnapshot,
    ).toEqual(snapshot);
    expect(
      (await post(p.a, `/assessments/targets/${targetId}/prepare`, { blueprintId: blueprint.id }))
        .body.data.id,
    ).toBe(attempt.id);
    expect(
      (
        await p.a
          .put(`/api/v1/assessments/targets/${targetId}`)
          .set('X-CSRF-Token', await csrf(p.a))
          .send(input)
      ).body.error.code,
    ).toBe('TARGET_LOCKED');
    await expect(
      prisma.assessmentTargetIndustry.deleteMany({ where: { targetId } }),
    ).rejects.toThrow();
    await expect(
      prisma.assessmentRequirement.update({
        where: { id: contextual.id },
        data: { requiredScore: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.assessmentAttempt.update({ where: { id: attempt.id }, data: { contextSnapshot: {} } }),
    ).rejects.toThrow();
    const results = attempt.requirements.map((r: { id: string; competencyId: string }) => ({
      requirementId: r.id,
      score: r.competencyId === competencyId ? 50 : 100,
      evidence: 'Assessor observed and reviewed the practical assessment evidence.',
    }));
    expect((await completeRequest(p.a, attempt.id, results)).status).toBe(403);
    expect((await completeRequest(admin, attempt.id, results)).body.error.code).toBe(
      'ATTEMPT_NOT_STARTED',
    );
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).body.error.code).toBe(
      'ASSESSMENT_WINDOW_CLOSED',
    );
    const window = await availability(blueprint.id);
    const booked = await createBooking(p.id, window.slots[0]!.id, 'frozen-target-booking');
    expect(booked.targetId).toBe(targetId);
    // Move only this isolated fixture's slot into its live window, without changing the system clock.
    await prisma.assessmentSlot.update({
      where: { id: booked.slotId },
      data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000) },
    });
    await prisma.document.update({ where: { id: p.identityId }, data: { scanStatus: 'INFECTED' } });
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).body.error.code).toBe(
      'IDENTITY_SUBMISSION_REQUIRED',
    );
    await prisma.document.update({ where: { id: p.identityId }, data: { scanStatus: 'CLEAN' } });
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).status).toBe(200);
    expect((await post(p.a, `/assessments/attempts/${attempt.id}/start`, {})).status).toBe(200);
    expect((await post(p.a, '/assessments/targets', input)).body.error.code).toBe(
      'ACTIVE_TARGET_EXISTS',
    );
    expect((await completeRequest(admin, attempt.id, results.slice(1))).body.error.code).toBe(
      'RESULTS_INCOMPLETE',
    );
    expect((await completeRequest(admin, attempt.id, [...results, results[0]])).status).toBe(422);
    expect((await completeRequest(admin, attempt.id, [{ ...results[0], score: 101 }])).status).toBe(
      422,
    );
    const completed = await completeRequest(admin, attempt.id, results);
    expect(completed.status).toBe(200);
    const weighted = attempt.requirements.reduce(
      (sum: number, r: { id: string; weight: number }) =>
        sum +
        results.find((row: { requirementId: string }) => row.requirementId === r.id).score *
          r.weight,
      0,
    );
    const weights = attempt.requirements.reduce(
      (sum: number, r: { weight: number }) => sum + r.weight,
      0,
    );
    expect(completed.body.data.overallScore).toBe(Math.round((weighted / weights) * 100) / 100);
    expect(
      completed.body.data.results.find(
        (r: { requirementId: string }) => r.requirementId === contextual.id,
      ).gap,
    ).toBe(40);
    expect(completed.body.data.learningPlan.items).toHaveLength(1);
    expect(completed.body.data.learningPlan.items[0].resources).toEqual([
      'https://example.test/approved-learning',
    ]);
    expect(
      (await prisma.assessmentBooking.findUniqueOrThrow({ where: { id: booked.id } })).status,
    ).toBe('COMPLETED');
    expect((await completeRequest(admin, attempt.id, [...results].reverse())).status).toBe(200);
    expect(
      (await completeRequest(admin, attempt.id, results, 'different-completion-key')).status,
    ).toBe(409);
    expect(
      (
        await completeRequest(
          admin,
          attempt.id,
          results.map((r: object) => ({ ...r, score: 100 })),
        )
      ).status,
    ).toBe(409);
    const other = await applicant();
    expect((await other.a.get(`/api/v1/assessments/targets/${targetId}`)).status).toBe(404);
    expect((await other.a.get(`/api/v1/assessments/attempts/${attempt.id}`)).status).toBe(404);
    expect(
      (
        await post(other.a, `/assessments/targets/${targetId}/prepare`, {
          blueprintId: blueprint.id,
        })
      ).status,
    ).toBe(404);
    const plan = completed.body.data.learningPlan;
    expect((await other.a.get(`/api/v1/assessments/learning-plans/${plan.id}`)).status).toBe(404);
    expect(
      (
        await other.a
          .patch(`/api/v1/assessments/learning-plans/${plan.id}/items/${plan.items[0].id}`)
          .set('X-CSRF-Token', await csrf(other.a))
          .send({ status: 'COMPLETED' })
      ).status,
    ).toBe(404);
    const nextRole = await prisma.jobRole.findFirstOrThrow({
      where: { id: { not: input.jobRoleId } },
      include: { industries: true },
    });
    const next = await post(p.a, '/assessments/targets', {
      ...input,
      jobRoleId: nextRole.id,
      industryIds: [nextRole.industries[0]!.industryId],
      companyIds: [],
    });
    expect(next.status).toBe(201);
    expect((await p.a.get('/api/v1/assessments/targets')).body.meta.total).toBe(2);
    expect(
      (await p.a.get(`/api/v1/assessments/attempts/${attempt.id}`)).body.data.contextSnapshot,
    ).toEqual(snapshot);
    expect(
      (
        await p.a
          .patch(`/api/v1/assessments/learning-plans/${plan.id}/items/${plan.items[0].id}`)
          .set('X-CSRF-Token', await csrf(p.a))
          .send({ status: 'COMPLETED' })
      ).body.data.status,
    ).toBe('COMPLETED');
    expect(
      (await p.a.get(`/api/v1/assessments/attempts/${attempt.id}`)).body.data.results.find(
        (r: { requirementId: string }) => r.requirementId === contextual.id,
      ).gap,
    ).toBe(40);
    await expect(
      prisma.assessmentCompetencyResult.update({
        where: { requirementId: contextual.id },
        data: { score: 100 },
      }),
    ).rejects.toThrow();
    const noMfa = await adminSession(false);
    expect((await noMfa.get(`/api/v1/admin/assessment-attempts/${attempt.id}`)).status).toBe(403);
    const unprivileged = await adminSession();
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { name: 'assessments.review' },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    await prisma.rolePermission.delete({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    });
    try {
      expect(
        (await unprivileged.get(`/api/v1/admin/assessment-attempts/${attempt.id}`)).status,
      ).toBe(403);
    } finally {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
  });
  it('keeps scenarios private before explicit, time-gated session start', async () => {
    const { p, booking } = await interactionFixture({}, false);
    expect(
      (await p.a.get('/api/v1/assessments/00000000-0000-4000-8000-000000000000/preflight')).status,
    ).toBe(404);
    const setup = await p.a.get(`/api/v1/assessments/${booking.id}/preflight`);
    expect(setup.status).toBe(200);
    expect(setup.body.data.canStart).toBe(false);
    expect(setup.body.data.browserReadinessIsSelfReported).toBe(true);
    expect(JSON.stringify(setup.body)).not.toContain('Approved engineering scenario');
    expect(
      (await post(p.a, `/assessments/${booking.id}/start`, preflightInput)).body.error.code,
    ).toBe('ASSESSMENT_WINDOW_CLOSED');
    expect(
      await prisma.assessmentInteractionSession.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
    expect(
      (await post(p.a, `/assessments/${booking.id}/start`, { ...preflightInput, confirmed: false }))
        .status,
    ).toBe(422);
  });
  it('requires camera policy or an audited admin accommodation and initializes once', async () => {
    const { p, booking, attemptId } = await interactionFixture({
      cameraRequired: true,
      cameraPurpose: 'A human assessor requires a local equipment readiness preview.',
    });
    expect(
      (
        await post(p.a, `/assessments/${booking.id}/start`, {
          ...preflightInput,
          devices: { ...preflightInput.devices, camera: 'DENIED' },
        })
      ).body.error.code,
    ).toBe('CAMERA_REQUIRED');
    const a = await adminSession();
    expect(
      (
        await a
          .put(`/api/v1/admin/assessment-attempts/${attemptId}/accommodation`)
          .set('X-CSRF-Token', await csrf(a))
          .send({
            waiveCamera: true,
            reason: 'Approve a camera exception for the isolated accessibility test.',
          })
      ).status,
    ).toBe(200);
    const first = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    expect(first.status).toBe(200);
    const second = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      await prisma.assessmentInteractionSession.count({ where: { bookingId: booking.id } }),
    ).toBe(1);
    expect(first.body.data.messages).toHaveLength(1);
    expect(first.body.data.messages[0].text).toContain('Approved engineering scenario');
    expect(JSON.stringify(first.body)).not.toContain('evaluationCriteria');
    expect(
      (
        await a
          .put(`/api/v1/admin/assessment-attempts/${attemptId}/accommodation`)
          .set('X-CSRF-Token', await csrf(a))
          .send({ waiveCamera: true, reason: 'Changing an already frozen session must fail.' })
      ).status,
    ).toBe(409);
  });
  it('rejects voice mode without microphone readiness and requires approved scenario coverage', async () => {
    const { p, booking, blueprint } = await interactionFixture();
    expect(
      (
        await post(p.a, `/assessments/${booking.id}/start`, {
          ...preflightInput,
          mode: 'VOICE',
          devices: { camera: 'UNAVAILABLE', microphone: 'DENIED', speakerConfirmed: true },
        })
      ).body.error.code,
    ).toBe('VOICE_PREFLIGHT_REQUIRED');
    const link = await prisma.blueprintScenario.findFirstOrThrow({
      where: { blueprintId: blueprint.id },
    });
    await prisma.assessmentScenario.update({
      where: { id: link.scenarioId },
      data: { approved: false },
    });
    expect(
      (await post(p.a, `/assessments/${booking.id}/start`, preflightInput)).body.error.code,
    ).toBe('APPROVED_SCENARIOS_REQUIRED');
    vi.mocked(interviewer.ready).mockReturnValue(false);
    expect(
      (await post(p.a, `/assessments/${booking.id}/start`, preflightInput)).body.error.code,
    ).toBe('AI_PROVIDER_UNAVAILABLE');
  });
  it('persists controlled followups and generates reviewed results through the existing skills-gap workflow', async () => {
    const { p, booking } = await interactionFixture();
    const started = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    expect(started.status).toBe(200);
    let session = started.body.data;
    expect(
      (
        await answer(p.a, session.id, session.currentPromptId, 'partial-answer-01', {
          confirmed: false,
        })
      ).status,
    ).toBe(422);
    for (let i = 0; i < 6; i++) {
      const response = await answer(
        p.a,
        session.id,
        session.currentPromptId,
        `confirmed-answer-${i}`,
      );
      expect(response.status).toBe(200);
      session = response.body.data;
    }
    expect(session.status).toBe('AWAITING_REVIEW');
    expect(session.progress.completedScenarios).toBe(3);
    expect(session.evaluation).toBeUndefined();
    expect(
      (await p.a.get(`/api/v1/assessment-sessions/${session.id}/results`)).body.data,
    ).toMatchObject({ provisional: true, reviewRequired: true });
    expect(
      (await answer(p.a, session.id, session.messages.at(-1).id, 'after-completion')).status,
    ).toBe(409);
    const a = await adminSession();
    const approved = await a
      .post(`/api/v1/admin/assessment-sessions/${session.id}/approve-results`)
      .set('X-CSRF-Token', await csrf(a))
      .set('Idempotency-Key', 'approved-session-results')
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body.data.results).toHaveLength(3);
    expect(approved.body.data.learningPlan.items).toHaveLength(3);
    const final = await p.a.get(`/api/v1/assessment-sessions/${session.id}/results`);
    expect(final.body.data.provisional).toBe(false);
    expect(final.body.data.attempt.overallScore).toBe(50);
    expect(
      (await prisma.assessmentTarget.findUniqueOrThrow({ where: { id: booking.targetId! } }))
        .status,
    ).toBe('COMPLETED');
  });
  it('records final transcripts and corrections and prevents cross-applicant session access', async () => {
    const { p, booking } = await interactionFixture();
    const start = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    expect(start.status).toBe(200);
    const s = start.body.data;
    expect(
      (
        await post(p.a, `/assessment-sessions/${s.id}/audio/transcribe`, {
          text: 'partial',
          isFinal: false,
          language: 'en',
        })
      ).status,
    ).toBe(422);
    const transcript = await post(p.a, `/assessment-sessions/${s.id}/audio/transcribe`, {
      text: 'The P L C input is 24 V.',
      isFinal: true,
      language: 'en',
    });
    expect(transcript.status).toBe(200);
    const extra = {
      origin: 'VOICE',
      transcriptionId: transcript.body.data.id,
      text: 'The PLC input is 24 V.',
    };
    const response = await answer(p.a, s.id, s.currentPromptId, 'voice-confirmed-answer', extra);
    expect(response.status).toBe(200);
    const calls = vi.mocked(interviewer.invoke).mock.calls.length;
    const retry = await answer(p.a, s.id, s.currentPromptId, 'voice-confirmed-answer', extra);
    expect(retry.status).toBe(200);
    expect(vi.mocked(interviewer.invoke).mock.calls.length).toBe(calls);
    expect(
      (
        await answer(p.a, s.id, s.currentPromptId, 'voice-confirmed-answer', {
          ...extra,
          text: 'Different answer',
        })
      ).status,
    ).toBe(409);
    expect(
      await prisma.transcriptCorrection.findFirst({
        where: { transcriptionId: transcript.body.data.id },
      }),
    ).toMatchObject({
      originalText: 'The P L C input is 24 V.',
      confirmedText: 'The PLC input is 24 V.',
    });
    const other = await applicant();
    for (const suffix of ['', '/current-scenario', '/results', '/progress'])
      expect((await other.a.get(`/api/v1/assessment-sessions/${s.id}${suffix}`)).status).toBe(404);
    expect(
      (
        await post(other.a, `/assessment-sessions/${s.id}/audio/transcribe`, {
          text: 'hello',
          isFinal: true,
          language: 'en',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await post(other.a, `/assessment-sessions/${s.id}/speech/synthesize`, {
          messageId: s.currentPromptId,
        })
      ).status,
    ).toBe(404);
    expect((await request(server).get(`/api/v1/assessment-sessions/${s.id}`)).status).toBe(401);
  });
  it('resumes interrupted graph checkpoints without duplicating the confirmed response', async () => {
    const { p, booking } = await interactionFixture();
    const start = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    const s = start.body.data;
    vi.mocked(interviewer.invoke).mockRejectedValueOnce(
      new AppError(503, 'AI_PROVIDER_UNAVAILABLE', 'Provider unavailable'),
    );
    expect(
      (await answer(p.a, s.id, s.currentPromptId, 'interrupted-confirmed-answer')).status,
    ).toBe(503);
    expect((await p.a.get(`/api/v1/assessment-sessions/${s.id}`)).body.data).toMatchObject({
      status: 'INTERRUPTED',
      hasPendingResponse: true,
    });
    // Simulate a worker crash: a live lease blocks concurrent processing, but
    // its expiry lets another process recover the same saved answer/checkpoint.
    await prisma.assessmentInteractionSession.update({
      where: { id: s.id },
      data: { leaseToken: crypto.randomUUID(), leaseExpiresAt: new Date(Date.now() + 60000) },
    });
    expect((await post(p.a, `/assessment-sessions/${s.id}/resume`, {})).body.error.code).toBe(
      'SESSION_BUSY',
    );
    await prisma.assessmentInteractionSession.update({
      where: { id: s.id },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const resumed = await post(p.a, `/assessment-sessions/${s.id}/resume`, {});
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe('ACTIVE');
    expect(await prisma.assessmentResponse.count({ where: { sessionId: s.id } })).toBe(1);
    expect(
      await prisma.assessmentConversationMessage.count({
        where: { sessionId: s.id, role: 'APPLICANT' },
      }),
    ).toBe(1);
    expect(
      await prisma.assessmentGraphCheckpoint.count({ where: { sessionId: s.id } }),
    ).toBeGreaterThan(0);
    expect(
      (
        await post(p.a, `/assessment-sessions/${s.id}/events`, {
          kind: 'DEVICE_DISCONNECTED',
          device: 'microphone',
        })
      ).status,
    ).toBe(200);
    await prisma.assessmentSlot.update({
      where: { id: booking.slotId },
      data: { startsAt: new Date(Date.now() - 7200000), endsAt: new Date(Date.now() - 3600000) },
    });
    expect(
      (await answer(p.a, s.id, resumed.body.data.currentPromptId, 'outside-session-window')).body
        .error.code,
    ).toBe('ASSESSMENT_WINDOW_CLOSED');
  });
  it('rejects unsafe audio and preserves text fallback after STT and TTS outages', async () => {
    const { p, booking } = await interactionFixture();
    const start = await post(p.a, `/assessments/${booking.id}/start`, preflightInput);
    const s = start.body.data;
    const upload = async (buffer: Buffer) =>
      p.a
        .post(`/api/v1/assessment-sessions/${s.id}/audio/transcribe`)
        .set('X-CSRF-Token', await csrf(p.a))
        .attach('audio', buffer, { filename: 'response.wav', contentType: 'audio/wav' });
    expect((await upload(Buffer.from('not an audio file'))).status).toBe(415);
    expect((await upload(Buffer.alloc(8 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await upload(wav(181))).body.error.code).toBe('AUDIO_TOO_LONG');
    const oldStt = env.STT_PROVIDER,
      oldTts = env.TTS_PROVIDER;
    try {
      env.STT_PROVIDER = 'compatible';
      env.TTS_PROVIDER = 'compatible';
      vi.spyOn(speechProviders, 'transcribe').mockRejectedValue(
        new AppError(503, 'STT_UNAVAILABLE', 'Transcription unavailable'),
      );
      vi.spyOn(speechProviders, 'synthesize').mockRejectedValue(
        new AppError(503, 'TTS_UNAVAILABLE', 'Speech unavailable'),
      );
      expect((await upload(wav())).body.error.code).toBe('STT_UNAVAILABLE');
      expect(
        await prisma.assessmentTranscription.findFirst({
          where: { sessionId: s.id, status: 'FAILED' },
        }),
      ).toBeTruthy();
      expect(
        (
          await post(p.a, `/assessment-sessions/${s.id}/speech/synthesize`, {
            messageId: s.currentPromptId,
          })
        ).body.error.code,
      ).toBe('TTS_UNAVAILABLE');
      expect(
        (
          await post(p.a, `/assessment-sessions/${s.id}/speech/synthesize`, {
            messageId: s.currentPromptId,
            text: 'Arbitrary expensive synthesis',
          })
        ).status,
      ).toBe(422);
      expect((await answer(p.a, s.id, s.currentPromptId, 'typed-fallback-answer')).status).toBe(
        200,
      );
    } finally {
      env.STT_PROVIDER = oldStt;
      env.TTS_PROVIDER = oldTts;
    }
  });
});
