import { writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { format } from 'prettier';
import { z } from 'zod';
import * as auth from '../src/validators/auth.schema.js';
import * as career from '../src/validators/career.schema.js';
import * as document from '../src/validators/document.schema.js';
import * as assessment from '../src/validators/assessment.schema.js';
import * as admin from '../src/validators/admin.schema.js';
import { profileSchema } from '../src/validators/applicant.schema.js';
type Schema = Record<string, unknown>;
const str = { type: 'string' },
  id = { type: 'string', format: 'uuid' },
  date = { type: 'string', format: 'date-time' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema) => ({ type: 'array', items });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const json = (schema: z.ZodType) => {
  const { $schema: _schema, ...result } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  });
  return result;
};
const schemas: Record<string, Schema> = {
  Error: object(
    {
      error: object(
        {
          code: str,
          message: str,
          requestId: str,
          details: array(object({ path: str, message: str })),
        },
        ['code', 'message', 'requestId'],
      ),
    },
    ['error'],
  ),
  Message: object({ message: str }),
  Csrf: object({ csrfToken: str }, ['csrfToken']),
  Login: object({ csrfToken: str, mfaRequired: { type: 'boolean' } }),
  Principal: object({
    id,
    email: { type: 'string', format: 'email' },
    legalName: str,
    phone: { type: ['string', 'null'] },
    emailVerifiedAt: { type: ['string', 'null'], format: 'date-time' },
    roles: array(str),
    permissions: array(str),
  }),
  Profile: object({
    id,
    legalName: str,
    email: str,
    phone: str,
    emailVerifiedAt: date,
    profile: object({
      id,
      userId: id,
      country: str,
      region: str,
      educationLevel: str,
      institution: str,
      discipline: str,
      professionalStatus: str,
      graduationYear: { type: 'integer' },
      summary: str,
      consentVersion: str,
      consentAt: date,
      createdAt: date,
      updatedAt: date,
    }),
  }),
  Onboarding: object({
    emailVerified: { type: 'boolean' },
    profileComplete: { type: 'boolean' },
    identitySubmitted: { type: 'boolean' },
    documents: array(ref('Document')),
    careerSelected: { type: 'boolean' },
    assessmentScheduled: { type: 'boolean' },
    verificationBlocksOnboarding: { const: false },
  }),
  Document: object({
    id,
    applicantId: id,
    category: {
      type: 'string',
      enum: [...document.identityCategories, ...document.academicCategories],
    },
    title: str,
    issuer: { type: ['string', 'null'] },
    institutionId: { type: ['string', 'null'], format: 'uuid' },
    issuedAt: { type: ['string', 'null'], format: 'date-time' },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    verificationUrl: { type: ['string', 'null'] },
    mimeType: str,
    size: { type: 'integer' },
    scanStatus: { type: 'string', enum: ['QUARANTINED', 'CLEAN', 'INFECTED', 'FAILED'] },
    status: {
      type: 'string',
      enum: [
        'UPLOADED',
        'UNDER_REVIEW',
        'ADDITIONAL_EVIDENCE_REQUIRED',
        'AUTHENTICATED',
        'REJECTED',
        'DISPUTED',
      ],
    },
    replacesId: { type: ['string', 'null'], format: 'uuid' },
    createdAt: date,
    updatedAt: date,
  }),
  Review: object({
    id,
    documentId: id,
    reviewerId: id,
    method: str,
    outcome: str,
    reason: str,
    internalNotes: { type: ['string', 'null'] },
    evidenceReference: { type: ['string', 'null'] },
    createdAt: date,
  }),
  Evidence: object({
    id,
    documentId: id,
    authorId: id,
    note: str,
    reference: { type: ['string', 'null'] },
    createdAt: date,
  }),
  StatusHistory: object({
    id,
    documentId: id,
    fromStatus: { type: ['string', 'null'] },
    toStatus: str,
    actorId: id,
    reason: str,
    createdAt: date,
  }),
  VerificationHistory: object({
    reviews: array(object({ id, method: str, outcome: str, reason: str, createdAt: date })),
    history: array(
      object({
        fromStatus: { type: ['string', 'null'] },
        toStatus: str,
        reason: str,
        createdAt: date,
      }),
    ),
    evidence: array(ref('Evidence')),
  }),
  Industry: object({
    id,
    name: str,
    description: str,
    active: { type: 'boolean' },
    createdAt: date,
    updatedAt: date,
  }),
  Company: object({
    id,
    name: str,
    description: str,
    website: { type: ['string', 'null'] },
    country: str,
    active: { type: 'boolean' },
    industries: array(object({ industryId: id, industry: ref('Industry') })),
    createdAt: date,
    updatedAt: date,
  }),
  Career: object({
    id,
    title: str,
    description: str,
    active: { type: 'boolean' },
    industries: array(object({ industryId: id, industry: ref('Industry') })),
    blueprints: array(ref('Blueprint')),
    createdAt: date,
    updatedAt: date,
  }),
  Preferences: object({
    id,
    applicantId: id,
    primaryRoleId: id,
    primaryRole: ref('Career'),
    industries: array(
      object({ industryId: id, rank: { type: 'integer' }, industry: ref('Industry') }),
    ),
    companies: array(object({ companyId: id, rank: { type: 'integer' }, company: ref('Company') })),
    updatedAt: date,
  }),
  Competency: object({ id, code: str, name: str, description: str }),
  Framework: object({
    id,
    jobRoleId: id,
    version: { type: 'integer' },
    title: str,
    approved: { type: 'boolean' },
    competencies: array(
      object({ competencyId: id, weight: { type: 'integer' }, competency: ref('Competency') }),
    ),
    createdAt: date,
  }),
  Blueprint: object({
    id,
    jobRoleId: id,
    frameworkId: id,
    version: { type: 'integer' },
    title: str,
    durationMinutes: { type: 'integer' },
    instructions: str,
    active: { type: 'boolean' },
    requiresAuthenticatedIdentity: { type: 'boolean' },
    requiresAuthenticatedAcademic: { type: 'boolean' },
    jobRole: ref('Career'),
    framework: ref('Framework'),
    createdAt: date,
  }),
  Eligibility: object({
    eligible: { type: 'boolean' },
    reasons: array(str),
    blueprints: array(object({ blueprintId: id, reasons: array(str) })),
    timezone: str,
  }),
  Slot: object({
    id,
    startsAt: date,
    endsAt: date,
    timezone: str,
    remainingCapacity: { type: 'integer' },
  }),
  BookingEvent: object({
    id,
    bookingId: id,
    actorId: id,
    action: str,
    reason: { type: ['string', 'null'] },
    createdAt: date,
  }),
  Booking: object(
    {
      bookingId: id,
      applicantId: id,
      jobRole: ref('Career'),
      blueprint: object({ id, title: str, version: { type: 'integer' } }),
      startsAt: date,
      endsAt: date,
      timezone: str,
      status: {
        type: 'string',
        enum: ['SCHEDULED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED', 'EXPIRED', 'MISSED'],
      },
      durationMinutes: { type: 'integer' },
      instructions: str,
      rescheduledFromId: { type: ['string', 'null'], format: 'uuid' },
      rescheduleCount: { type: 'integer' },
      events: array(ref('BookingEvent')),
    },
    ['bookingId', 'applicantId', 'startsAt', 'endsAt', 'status'],
  ),
  Availability: object({
    id,
    blueprintId: id,
    startsAt: date,
    endsAt: date,
    capacity: { type: 'integer' },
    minNoticeMinutes: { type: 'integer' },
    maxHorizonDays: { type: 'integer' },
    cancellationNoticeMinutes: { type: 'integer' },
    rescheduleLimit: { type: 'integer' },
    timezone: str,
    active: { type: 'boolean' },
    slots: array(ref('Slot')),
  }),
  Session: object({ id: str, createdAt: date, expiresAt: date, current: { type: 'boolean' } }),
  MfaSetup: object({ provisioningUri: str, recoveryCodes: array(str) }),
  Institution: object({
    id,
    name: str,
    country: str,
    website: { type: ['string', 'null'] },
    active: { type: 'boolean' },
    createdAt: date,
    updatedAt: date,
  }),
  Suggestion: object({
    id,
    applicantId: id,
    name: str,
    website: { type: ['string', 'null'] },
    status: str,
    decisionReason: { type: ['string', 'null'] },
    createdAt: date,
  }),
  Applicant: object({
    id,
    legalName: str,
    email: str,
    phone: { type: ['string', 'null'] },
    status: str,
    createdAt: date,
    profile: ref('Profile'),
    documents: array(ref('Document')),
    preferences: ref('Preferences'),
  }),
  AuditLog: object({
    id,
    actorId: { type: ['string', 'null'], format: 'uuid' },
    action: str,
    resourceId: { type: ['string', 'null'] },
    details: { type: ['object', 'null'], additionalProperties: true },
    createdAt: date,
  }),
};
const inputs = {
  Register: auth.registerSchema,
  LoginInput: auth.loginSchema,
  VerifyCode: auth.codeSchema,
  EmailInput: auth.emailSchema,
  ResetPassword: auth.resetSchema,
  Reauthenticate: auth.reauthSchema,
  MfaCode: auth.mfaSchema,
  GoogleComplete: auth.googleCompleteSchema,
  ProfileUpdate: profileSchema,
  PreferencesInput: career.careerSchema,
  SuggestionInput: career.suggestionSchema,
  DocumentMetadata: document.documentSchema,
  DocumentUpdate: document.metadataSchema,
  ReviewInput: document.reviewSchema,
  EvidenceInput: document.evidenceSchema,
  BookingInput: assessment.bookingSchema,
  CancelInput: assessment.reasonSchema,
  RescheduleInput: assessment.rescheduleSchema,
  AvailabilityInput: assessment.availabilitySchema,
  AvailabilityUpdate: admin.availabilityPatchSchema,
  AccountStatus: admin.accountStatusSchema,
  SuggestionReview: admin.suggestionReviewSchema,
};
for (const [name, schema] of Object.entries(inputs)) schemas[name] = json(schema);
const uploadProperties = schemas.DocumentMetadata!.properties as Record<string, unknown>;
schemas.Upload = {
  ...schemas.DocumentMetadata,
  properties: { ...uploadProperties, file: { type: 'string', format: 'binary' } },
  required: [...(schemas.DocumentMetadata!.required as string[]), 'file'],
};
const paths: Record<string, Record<string, unknown>> = {};
interface Options {
  input?: string;
  output?: Schema;
  status?: number;
  public?: boolean;
  multipart?: boolean;
  description?: string;
  parameters?: unknown[];
  redirect?: boolean;
  download?: boolean;
}
const query = (name: string, schema: Schema, required = false) => ({
  in: 'query',
  name,
  required,
  schema,
});
const pages = [
  query('page', { type: 'integer', minimum: 1, default: 1 }),
  query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
  query('search', str),
];
function add(method: string, path: string, summary: string, tag: string, o: Options = {}) {
  const status = o.status ?? 200;
  const parameters: unknown[] = [
    ...Array.from(path.matchAll(/\{(\w+)\}/g), (m) => ({
      in: 'path',
      name: m[1],
      required: true,
      schema: m[1] === 'id' && path.includes('/sessions/') ? str : id,
    })),
    ...(o.parameters ?? []),
  ];
  if (!['get', 'head', 'options'].includes(method))
    parameters.push({
      in: 'header',
      name: 'X-CSRF-Token',
      required: true,
      schema: str,
      description:
        'Fetch GET /auth/csrf using the same cookie jar. Refresh after login, MFA or reauthentication.',
    });
  const output = o.output ?? ref('Message');
  const responses: Record<string, unknown> = {
    [String(status)]: {
      description: o.redirect ? 'Browser redirect' : status === 204 ? 'No content' : 'Success',
      ...(status === 204
        ? {}
        : o.redirect
          ? { headers: { Location: { schema: { type: 'string', format: 'uri' } } } }
          : {
              content: {
                [o.download ? 'application/octet-stream' : 'application/json']: {
                  schema: o.download
                    ? { type: 'string', format: 'binary' }
                    : object(
                        {
                          data: output,
                          meta: object({
                            page: { type: 'integer' },
                            limit: { type: 'integer' },
                            total: { type: 'integer' },
                          }),
                        },
                        ['data'],
                      ),
                },
              },
            }),
    },
  };
  for (const error of [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503])
    responses[String(error)] = {
      description: (
        {
          400: 'Invalid request or code',
          401: 'Authentication required or failed',
          403: 'Permission, CSRF, verification, or MFA required',
          404: 'Resource not found',
          409: 'Workflow, capacity, eligibility, or uniqueness conflict',
          413: 'Request too large',
          415: 'Unsupported file signature or MIME type',
          422: 'Validation failed',
          429: 'Rate limit exceeded',
          500: 'Internal error',
          503: 'External dependency unavailable',
        } as Record<number, string>
      )[error],
      content: { 'application/json': { schema: ref('Error') } },
    };
  paths[path] ??= {};
  paths[path]![method] = {
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    tags: [tag],
    summary,
    description: o.description,
    security: o.public ? [] : [{ sessionCookie: [] }],
    parameters,
    ...(o.input
      ? {
          requestBody: {
            required: true,
            content: {
              [o.multipart ? 'multipart/form-data' : 'application/json']: { schema: ref(o.input) },
            },
          },
        }
      : {}),
    responses,
  };
}
add('get', '/auth/csrf', 'Obtain synchronizer CSRF token', 'Authentication', {
  public: true,
  output: ref('Csrf'),
});
for (const [path, summary, input, status] of [
  ['register', 'Register applicant', 'Register', 202],
  ['verify-email', 'Verify email OTP', 'VerifyCode', 200],
  ['resend-verification', 'Resend verification OTP', 'EmailInput', 202],
  ['forgot-password', 'Request password recovery OTP', 'EmailInput', 202],
  ['reset-password', 'Recover password and revoke sessions', 'ResetPassword', 200],
] as const)
  add('post', `/auth/${path}`, summary, 'Authentication', {
    public: true,
    input,
    status,
    description:
      'Purpose-bound OTPs expire after five minutes by default. Registration and code requests return a generic message even for an existing or unknown account.',
  });
add('post', '/auth/login', 'Sign in and rotate session', 'Authentication', {
  public: true,
  input: 'LoginInput',
  output: ref('Login'),
});
add('get', '/auth/me', 'Read current identity and permissions', 'Authentication', {
  output: ref('Principal'),
});
for (const path of ['logout', 'logout-all'])
  add(
    'post',
    `/auth/${path}`,
    path === 'logout' ? 'Revoke current session' : 'Revoke every session',
    'Authentication',
    { status: 204 },
  );
add('get', '/auth/sessions', 'List active sessions', 'Authentication', {
  output: array(ref('Session')),
});
add('delete', '/auth/sessions/{id}', 'Revoke an owned session', 'Authentication', { status: 204 });
add('post', '/auth/reauthenticate', 'Reauthenticate before account linking', 'Authentication', {
  input: 'Reauthenticate',
  output: ref('Csrf'),
});
add('get', '/auth/google', 'Start Google authorization code flow', 'Authentication', {
  public: true,
  status: 302,
  redirect: true,
});
add(
  'get',
  '/auth/google/callback',
  'Validate Google response and establish session',
  'Authentication',
  {
    public: true,
    parameters: [query('state', str, true), query('code', str, true)],
    output: object({
      authenticated: { type: 'boolean' },
      csrfToken: str,
      registrationRequired: { type: 'boolean' },
      requiredFields: array(str),
    }),
    description:
      'OIDC verifies issuer, audience, expiration, state, nonce and PKCE. An email collision requires explicit authenticated linking.',
  },
);
add(
  'post',
  '/auth/google/complete',
  'Complete Google registration with phone and consent',
  'Authentication',
  { public: true, input: 'GoogleComplete', status: 201, output: ref('Login') },
);
add(
  'post',
  '/auth/google/link',
  'Explicitly link Google after recent reauthentication',
  'Authentication',
  { status: 302, redirect: true },
);
add(
  'post',
  '/auth/mfa/setup',
  'Enroll admin TOTP and receive one-time recovery codes',
  'Authentication',
  {
    output: ref('MfaSetup'),
    description:
      'Admin role and authentication within the preceding five minutes required. Secrets are displayed once; do not log responses.',
  },
);
add(
  'post',
  '/auth/mfa/verify',
  'Verify TOTP or recovery code and rotate session',
  'Authentication',
  { input: 'MfaCode', output: object({ csrfToken: str, mfaVerified: { type: 'boolean' } }) },
);
add('get', '/applicants/me', 'Read private applicant profile', 'Applicants', {
  output: ref('Profile'),
});
add('patch', '/applicants/me', 'Update applicant profile', 'Applicants', {
  input: 'ProfileUpdate',
  output: ref('Profile'),
});
add(
  'get',
  '/applicants/me/onboarding',
  'Read independent onboarding and verification tracks',
  'Applicants',
  { output: ref('Onboarding') },
);
add('get', '/applicants/me/career-preferences', 'Read ranked career preferences', 'Applicants', {
  output: { anyOf: [ref('Preferences'), { type: 'null' }] },
});
add(
  'put',
  '/applicants/me/career-preferences',
  'Replace industries, companies and primary role',
  'Applicants',
  {
    input: 'PreferencesInput',
    output: ref('Preferences'),
    description:
      'At most three distinct industries and three distinct companies. Submit identity first. Cancel an active booking before changing primary role.',
  },
);
for (const prefix of ['/identity/documents', '/documents']) {
  add('post', prefix, 'Upload private quarantined document', 'Documents', {
    input: 'Upload',
    multipart: true,
    status: 201,
    output: ref('Document'),
    description: prefix.startsWith('/identity')
      ? 'Category must be NATIONAL_ID or PASSPORT. Files are limited to 10 MB by default.'
      : 'Academic category required. A current identity document must have been submitted first.',
  });
  add('get', prefix, 'List owned documents', 'Documents', { output: array(ref('Document')) });
  add(
    'post',
    `${prefix}/{id}/replace`,
    'Replace document while retaining prior review history',
    'Documents',
    { input: 'Upload', multipart: true, status: 201, output: ref('Document') },
  );
}
add('get', '/identity/status', 'Read identity submissions and review status', 'Documents', {
  output: array(ref('Document')),
});
add('get', '/documents/{id}', 'Read owned document metadata', 'Documents', {
  output: ref('Document'),
});
add(
  'patch',
  '/documents/{id}',
  'Edit metadata before review; use replacement afterward',
  'Documents',
  { input: 'DocumentUpdate', output: ref('Document') },
);
add(
  'get',
  '/documents/{id}/verification',
  'Read applicant-visible review outcomes and history',
  'Documents',
  { output: ref('VerificationHistory') },
);
add(
  'get',
  '/documents/{id}/download',
  'Download owned clean document as an attachment',
  'Documents',
  { download: true },
);
add(
  'post',
  '/documents/{id}/evidence',
  'Respond to additional evidence or dispute review',
  'Documents',
  { input: 'EvidenceInput', output: ref('Evidence'), status: 201 },
);
for (const [path, output] of [
  ['industries', 'Industry'],
  ['companies', 'Company'],
  ['careers', 'Career'],
] as const)
  add('get', `/${path}`, `Browse active ${path}`, 'Career catalogue', {
    output: array(ref(output)),
    parameters: pages,
  });
add('get', '/careers/{id}', 'Read career and assessment blueprints', 'Career catalogue', {
  output: ref('Career'),
});
add(
  'get',
  '/careers/{id}/competencies',
  'Read approved versioned competency frameworks',
  'Career catalogue',
  { output: array(ref('Framework')) },
);
add('post', '/companies/suggestions', 'Suggest a company for moderation', 'Career catalogue', {
  input: 'SuggestionInput',
  output: ref('Suggestion'),
  status: 201,
});
add(
  'get',
  '/assessments/eligibility',
  'Read assessment eligibility and unmet policy requirements',
  'Assessments',
  { output: ref('Eligibility') },
);
add(
  'get',
  '/assessments/blueprints/{id}',
  'Read approved role assessment information',
  'Assessments',
  { output: ref('Blueprint') },
);
add(
  'get',
  '/assessments/available-slots',
  'Read generated UTC slots with remaining capacity',
  'Assessments',
  {
    output: array(ref('Slot')),
    parameters: [query('blueprintId', id, true), query('from', date), query('to', date)],
  },
);
const idem = {
  in: 'header',
  name: 'Idempotency-Key',
  required: true,
  schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' },
  description:
    'Unique per applicant and operation. Retry with the same key and payload; changed payload returns 409.',
};
add('post', '/assessments/bookings', 'Reserve assessment capacity transactionally', 'Assessments', {
  input: 'BookingInput',
  output: ref('Booking'),
  status: 201,
  parameters: [idem],
  description:
    'One active booking per applicant. No AI session or scores are generated. Successful retries return the original booking.',
});
add('get', '/assessments/bookings', 'Read booking history and upcoming assessment', 'Assessments', {
  output: array(ref('Booking')),
  parameters: pages,
});
add(
  'get',
  '/assessments/bookings/{id}',
  'Read owned booking confirmation and event history',
  'Assessments',
  { output: ref('Booking') },
);
add(
  'post',
  '/assessments/bookings/{id}/cancel',
  'Cancel booking under its availability policy',
  'Assessments',
  { input: 'CancelInput', output: object({ id, status: { const: 'CANCELLED' } }) },
);
add(
  'post',
  '/assessments/bookings/{id}/reschedule',
  'Reschedule atomically and preserve previous booking',
  'Assessments',
  { input: 'RescheduleInput', output: ref('Booking'), status: 201, parameters: [idem] },
);
const adminDescription =
  'Requires ADMIN role, the operation-specific permission, verified email, and a recent successful MFA verification. All consequential changes are audited.';
add('get', '/admin/applicants', 'Search applicants', 'Administration', {
  output: array(ref('Applicant')),
  parameters: [
    ...pages,
    query('status', { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'] }),
  ],
  description: adminDescription,
});
add('get', '/admin/applicants/{id}', 'Inspect private applicant record', 'Administration', {
  output: ref('Applicant'),
  description: adminDescription,
});
add(
  'patch',
  '/admin/applicants/{id}/status',
  'Restrict or reactivate applicant and revoke sessions',
  'Administration',
  { input: 'AccountStatus', output: object({ id, status: str }), description: adminDescription },
);
add('get', '/admin/documents', 'List identity and academic submissions', 'Administration', {
  output: array(ref('Document')),
  parameters: [
    ...pages,
    query('status', str),
    query('applicantId', id),
    query('identity', { type: 'string', enum: ['true', 'false'] }),
  ],
  description: adminDescription,
});
add(
  'get',
  '/admin/documents/{id}',
  'Inspect document, private notes, evidence and history',
  'Administration',
  {
    output: {
      allOf: [
        ref('Document'),
        object({
          reviews: array(ref('Review')),
          evidence: array(ref('Evidence')),
          history: array(ref('StatusHistory')),
        }),
      ],
    },
    description: adminDescription,
  },
);
add(
  'get',
  '/admin/documents/{id}/download',
  'Download clean document for authorized review',
  'Administration',
  { download: true, description: adminDescription },
);
add(
  'post',
  '/admin/documents/{id}/reviews',
  'Record an independent verification decision',
  'Administration',
  {
    input: 'ReviewInput',
    output: object({ id, status: str }),
    status: 201,
    description: `${adminDescription} AI-assisted analysis cannot authenticate a document. Authentication requires independent evidence.`,
  },
);
add(
  'post',
  '/admin/documents/{id}/evidence',
  'Record independent review evidence',
  'Administration',
  { input: 'EvidenceInput', output: ref('Evidence'), status: 201, description: adminDescription },
);
for (const [path, schema, output] of [
  ['industries', admin.industrySchema, 'Industry'],
  ['companies', admin.companySchema, 'Company'],
  ['careers', admin.roleSchema, 'Career'],
  ['institutions', admin.institutionSchema, 'Institution'],
  ['competencies', admin.competencySchema, 'Competency'],
  ['frameworks', admin.frameworkSchema, 'Framework'],
  ['blueprints', admin.blueprintSchema, 'Blueprint'],
] as const) {
  const name = `Admin_${path}`;
  schemas[name] = json(schema);
  schemas[`${name}_update`] = json(
    path === 'frameworks'
      ? z.object({ approved: z.literal(true) }).strict()
      : path === 'blueprints'
        ? admin.activationSchema
        : path === 'industries'
          ? admin.industrySchema.partial()
          : path === 'companies'
            ? admin.companySchema.partial()
            : path === 'careers'
              ? admin.roleSchema.partial()
              : path === 'institutions'
                ? admin.institutionSchema.partial()
                : admin.competencySchema.partial(),
  );
  add('get', `/admin/${path}`, `List ${path} including inactive records`, 'Administration', {
    output: array(ref(output)),
    parameters: pages,
    description: adminDescription,
  });
  add('post', `/admin/${path}`, `Create ${path} record`, 'Administration', {
    input: name,
    output: ref(output),
    status: 201,
    description: adminDescription,
  });
  add('patch', `/admin/${path}/{id}`, `Update ${path} record`, 'Administration', {
    input: `${name}_update`,
    output: ref(output),
    description: `${adminDescription} Published competency definitions and blueprint contents are immutable; create a new version to change them.`,
  });
}
add('get', '/admin/company-suggestions', 'List moderated company suggestions', 'Administration', {
  output: array(ref('Suggestion')),
  parameters: pages,
  description: adminDescription,
});
add(
  'post',
  '/admin/company-suggestions/{id}/review',
  'Approve or reject a company suggestion',
  'Administration',
  { input: 'SuggestionReview', output: ref('Suggestion'), description: adminDescription },
);
add('get', '/admin/availability', 'List assessment availability policies', 'Administration', {
  output: array(ref('Availability')),
  parameters: pages,
  description: adminDescription,
});
add(
  'post',
  '/admin/availability',
  'Configure availability and generate assessment slots',
  'Administration',
  {
    input: 'AvailabilityInput',
    output: ref('Availability'),
    status: 201,
    description: `${adminDescription} Uses explicit timezone-aware start/end timestamps; windows for the same blueprint cannot overlap.`,
  },
);
add(
  'patch',
  '/admin/availability/{id}',
  'Activate availability or change unused capacity',
  'Administration',
  { input: 'AvailabilityUpdate', output: ref('Availability'), description: adminDescription },
);
add(
  'get',
  '/admin/bookings',
  'Filter assessment bookings by status, date and applicant',
  'Administration',
  {
    output: array(ref('Booking')),
    parameters: [
      ...pages,
      query('status', str),
      query('from', date),
      query('to', date),
      query('applicantId', id),
    ],
    description: adminDescription,
  },
);
add(
  'get',
  '/admin/bookings/{id}',
  'Inspect booking confirmation and audit history',
  'Administration',
  { output: ref('Booking'), description: adminDescription },
);
add(
  'post',
  '/admin/bookings/{id}/cancel',
  'Cancel assessment with an audited reason',
  'Administration',
  {
    input: 'CancelInput',
    output: object({ id, status: { const: 'CANCELLED' } }),
    description: adminDescription,
  },
);
add('get', '/admin/audit-logs', 'Read authorized audit trail', 'Administration', {
  output: array(ref('AuditLog')),
  parameters: [...pages, query('resourceId', str)],
  description: adminDescription,
});
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'VML NEXUS API',
    version: '0.1.0',
    description:
      'Applicant onboarding, private credential review, career preferences and assessment scheduling. No AI interview or competency scoring is implemented. Fetch /auth/csrf first; send its token with every state-changing request, including registration and login. Swagger UI fetches it automatically for Try it out. Cookies are managed by the browser. See docs/authentication.md for the admin MFA flow.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    'Authentication',
    'Applicants',
    'Documents',
    'Career catalogue',
    'Assessments',
    'Administration',
  ].map((name) => ({ name })),
  paths,
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'nexus.sid',
        description:
          'Signed HTTP-only session cookie. Production uses __Host-nexus.sid over HTTPS. Obtain through login; never copy session credentials into source code.',
      },
    },
    schemas,
  },
};
writeFileSync(
  'docs/openapi.yaml',
  await format(YAML.stringify(spec, { lineWidth: 100, aliasDuplicateObjects: false }), {
    parser: 'yaml',
    singleQuote: true,
    printWidth: 100,
  }),
);
console.log(
  `OpenAPI 3.1: ${Object.values(paths).reduce((sum, p) => sum + Object.keys(p).length, 0)} operations generated.`,
);
