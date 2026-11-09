import { writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { format } from 'prettier';
import { z } from 'zod';
import * as auth from '../src/validators/auth.schema.js';
import * as career from '../src/validators/career.schema.js';
import * as document from '../src/validators/document.schema.js';
import * as assessment from '../src/validators/assessment.schema.js';
import * as target from '../src/validators/assessment-target.schema.js';
import * as interaction from '../src/validators/assessment-interaction.schema.js';
import * as admin from '../src/validators/admin.schema.js';
import { profileSchema } from '../src/validators/applicant.schema.js';
import { institutionTypes } from '../src/validators/institution.schema.js';
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
      discipline: str,
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
    courseName: { type: ['string', 'null'] },
    certificationName: { type: ['string', 'null'] },
    issuer: { type: ['string', 'null'] },
    institutionId: { type: ['string', 'null'], format: 'uuid' },
    institutionName: { type: ['string', 'null'] },
    qualificationId: { type: ['string', 'null'], format: 'uuid' },
    transcripts: array(ref('Document')),
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
  Competency: object({ id, code: str, name: str, description: str }),
  Framework: object({
    id,
    jobRoleId: id,
    version: { type: 'integer' },
    title: str,
    approved: { type: 'boolean' },
    scope: { type: 'string', enum: ['CORE', 'INDUSTRY', 'COMPANY', 'COURSE'] },
    industryId: { type: ['string', 'null'], format: 'uuid' },
    companyId: { type: ['string', 'null'], format: 'uuid' },
    courseName: { type: ['string', 'null'] },
    competencies: array(
      object({
        competencyId: id,
        weight: { type: 'integer' },
        requiredScore: { type: 'integer', minimum: 1, maximum: 100 },
        learningObjective: { type: ['string', 'null'] },
        learningResources: array({ type: 'string', format: 'uri' }),
        competency: ref('Competency'),
      }),
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
    interactionPolicy: json(interaction.interactionPolicySchema),
    instructions: str,
    active: { type: 'boolean' },
    requiresAuthenticatedIdentity: { type: 'boolean' },
    requiresAuthenticatedAcademic: { type: 'boolean' },
    jobRole: ref('Career'),
    framework: ref('Framework'),
    createdAt: date,
  }),
  Eligibility: object({
    targetId: { type: ['string', 'null'], format: 'uuid' },
    attemptId: { type: ['string', 'null'], format: 'uuid' },
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
      targetId: { type: ['string', 'null'], format: 'uuid' },
      attemptId: { type: ['string', 'null'], format: 'uuid' },
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
    type: { type: 'string', enum: [...institutionTypes] },
    offersTvet: { type: 'boolean' },
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
    assessmentTargets: array(object({ id, jobRoleId: id, status: str, createdAt: date })),
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
  SuggestionInput: career.suggestionSchema,
  DocumentMetadata: document.documentSchema,
  DocumentUpdate: document.metadataSchema,
  ReviewInput: document.reviewSchema,
  EvidenceInput: document.evidenceSchema,
  BookingInput: assessment.bookingSchema,
  AssessmentTargetInput: target.targetSchema,
  PrepareTargetInput: target.prepareTargetSchema,
  CompleteAttemptInput: target.completeAttemptSchema,
  LearningProgressInput: target.learningProgressSchema,
  CancelInput: assessment.reasonSchema,
  RescheduleInput: assessment.rescheduleSchema,
  AvailabilityInput: assessment.availabilitySchema,
  AvailabilityUpdate: admin.availabilityPatchSchema,
  AccountStatus: admin.accountStatusSchema,
  SuggestionReview: admin.suggestionReviewSchema,
};
for (const [name, schema] of Object.entries(inputs)) schemas[name] = json(schema);
schemas.AssessmentRequirement = object({
  id,
  attemptId: id,
  competencyId: id,
  code: str,
  name: str,
  description: str,
  requiredScore: { type: 'integer' },
  weight: { type: 'integer' },
  sources: array(object({ frameworkId: id, version: { type: 'integer' }, scope: str })),
  learningObjective: str,
  learningResources: array({ type: 'string', format: 'uri' }),
});
schemas.AssessmentResult = object({
  id,
  attemptId: id,
  requirementId: id,
  score: { type: 'integer' },
  gap: { type: 'integer' },
  evidence: str,
  requirement: ref('AssessmentRequirement'),
});
schemas.LearningPlanItem = object({
  id,
  planId: id,
  resultId: id,
  priority: { type: 'integer' },
  objective: str,
  resources: array({ type: 'string', format: 'uri' }),
  status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] },
  completedAt: { type: ['string', 'null'], format: 'date-time' },
  result: ref('AssessmentResult'),
});
schemas.LearningPlan = object({
  id,
  attemptId: id,
  status: { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] },
  items: array(ref('LearningPlanItem')),
  createdAt: date,
  completedAt: { type: ['string', 'null'], format: 'date-time' },
});
schemas.AssessmentContext = object({
  schemaVersion: { const: 1 },
  career: ref('Career'),
  industries: array(object({ id, name: str, rank: { type: 'integer' } })),
  companies: array(object({ id, name: str, rank: { type: 'integer' } })),
  education: object({
    discipline: str,
  }),
  qualifications: array(ref('Document')),
  blueprint: ref('Blueprint'),
  frameworks: array(object({ id, version: { type: 'integer' }, scope: str, title: str })),
  scoring: object({
    scale: str,
    thresholdRule: str,
    weightRule: str,
    gapRule: str,
    overallRule: str,
  }),
});
schemas.AssessmentAttempt = object({
  id,
  targetId: id,
  blueprintId: id,
  contextSnapshot: ref('AssessmentContext'),
  requirements: array(ref('AssessmentRequirement')),
  results: array(ref('AssessmentResult')),
  learningPlan: { anyOf: [ref('LearningPlan'), { type: 'null' }] },
  startedAt: { type: ['string', 'null'], format: 'date-time' },
  completedAt: { type: ['string', 'null'], format: 'date-time' },
  assessorId: { type: ['string', 'null'], format: 'uuid' },
  overallScore: { type: ['number', 'null'] },
  createdAt: date,
});
schemas.AssessmentTarget = object({
  id,
  applicantId: id,
  jobRoleId: id,
  jobRole: ref('Career'),
  status: { type: 'string', enum: ['DRAFT', 'PREPARED', 'IN_PROGRESS', 'COMPLETED'] },
  industries: array(
    object({ targetId: id, industryId: id, rank: { type: 'integer' }, industry: ref('Industry') }),
  ),
  companies: array(
    object({ targetId: id, companyId: id, rank: { type: 'integer' }, company: ref('Company') }),
  ),
  qualifications: array(object({ targetId: id, documentId: id, document: ref('Document') })),
  attempt: {
    anyOf: [object({ id, blueprintId: id, startedAt: date, completedAt: date }), { type: 'null' }],
  },
  lockedAt: { type: ['string', 'null'], format: 'date-time' },
  completedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: date,
  updatedAt: date,
});
schemas.InteractionPolicy = json(interaction.interactionPolicySchema);
schemas.SessionStartInput = json(interaction.sessionStartSchema);
schemas.ConfirmedResponseInput = json(interaction.confirmedResponseSchema);
schemas.BrowserTranscriptionInput = json(interaction.browserTranscriptSchema);
schemas.SpeechInput = json(interaction.speechRequestSchema);
schemas.SessionEventInput = json(interaction.sessionEventSchema);
schemas.ScenarioInput = json(interaction.scenarioSchema);
schemas.ScenarioAssignmentInput = json(interaction.scenarioAssignmentSchema);
schemas.AccommodationInput = json(interaction.accommodationSchema);
schemas.Scenario = {
  ...json(interaction.scenarioSchema),
  properties: { ...(json(interaction.scenarioSchema).properties as object), id, createdAt: date },
};
schemas.Transcription = object({
  id,
  sessionId: id,
  status: { enum: ['PENDING', 'COMPLETED', 'FAILED'] },
  provider: str,
  model: { type: ['string', 'null'] },
  language: str,
  originalText: { type: ['string', 'null'] },
  durationMs: { type: ['integer', 'null'] },
  byteLength: { type: ['integer', 'null'] },
  createdAt: date,
});
schemas.AudioUpload = object(
  {
    audio: {
      type: 'string',
      format: 'binary',
      description:
        '16-bit PCM WAV, mono/stereo, 8–48 kHz. Maximum 8 MB and 180 seconds by default. Audio is processed transiently, never persisted.',
    },
  },
  ['audio'],
);
schemas.ConversationMessage = object({
  id,
  sessionId: id,
  sequence: { type: 'integer' },
  role: { enum: ['AI', 'APPLICANT'] },
  text: str,
  scenarioIndex: { type: 'integer' },
  createdAt: date,
});
schemas.SessionProgress = object({
  totalScenarios: { type: 'integer' },
  completedScenarios: { type: 'integer' },
  currentScenario: { type: ['integer', 'null'] },
});
schemas.SpeechConfiguration = object({
  stt: str,
  tts: str,
  language: str,
  maxAudioBytes: { type: 'integer' },
  maxAudioSeconds: { type: 'integer' },
  formats: array(str),
  rawAudioRetained: { const: false },
  videoTransmitted: { const: false },
});
schemas.AssessmentSession = object({
  id,
  bookingId: id,
  attemptId: id,
  status: { enum: ['ACTIVE', 'INTERRUPTED', 'AWAITING_REVIEW', 'COMPLETED'] },
  mode: { enum: ['TEXT', 'VOICE'] },
  language: str,
  policy: ref('InteractionPolicy'),
  preflight: { type: 'object' },
  messages: array(ref('ConversationMessage')),
  progress: ref('SessionProgress'),
  currentPromptId: { type: ['string', 'null'], format: 'uuid' },
  hasPendingResponse: { type: 'boolean' },
  endsAt: date,
  speech: ref('SpeechConfiguration'),
});
schemas.AssessmentPreflight = object({
  bookingId: id,
  attemptId: id,
  session: { anyOf: [object({ id, status: str }), { type: 'null' }] },
  startsAt: date,
  endsAt: date,
  timezone: str,
  canStart: { type: 'boolean' },
  policy: ref('InteractionPolicy'),
  aiReady: { type: 'boolean' },
  speech: ref('SpeechConfiguration'),
  browserReadinessIsSelfReported: { const: true },
  privacy: { type: 'object', additionalProperties: { type: 'string' } },
});
schemas.InteractionResults = {
  oneOf: [
    object({
      provisional: { const: true },
      reviewRequired: { const: true },
      competencies: array(
        object({
          requirementId: id,
          name: str,
          score: { type: 'integer' },
          gap: { type: 'integer' },
          evidence: str,
          requiredScore: { type: 'integer' },
          weight: { type: 'integer' },
        }),
      ),
      message: str,
    }),
    object({
      provisional: { const: false },
      reviewRequired: { const: false },
      attempt: ref('AssessmentAttempt'),
    }),
  ],
};

const uploadProperties = schemas.DocumentMetadata!.properties as Record<string, unknown>;
schemas.Upload = {
  ...schemas.DocumentMetadata,
  properties: {
    ...uploadProperties,
    file: {
      type: 'string',
      format: 'binary',
      description:
        'Required certificate/document file (one PDF, JPEG or PNG, at most 10 MB by default). For OTHER, supply a descriptive title; otherwise its filename becomes the title.',
    },
    transcripts: {
      type: 'array',
      items: { type: 'string', format: 'binary' },
      minItems: 1,
      maxItems: 5,
      description:
        'Required for BACHELOR, MASTER, PHD and DIPLOMA. Repeat this multipart field for each transcript.',
    },
  },
  required: [...(schemas.DocumentMetadata!.required as string[]), 'file'],
  allOf: Object.entries(document.academicDocumentRules).map(([category, rules]) => ({
    if: { properties: { category: { const: category } }, required: ['category'] },
    then: {
      required: [...rules.requiredFields, ...(rules.transcriptsRequired ? ['transcripts'] : [])],
      ...(rules.institutionRequired
        ? {
            oneOf: [
              {
                required: ['institutionId'],
                properties: {
                  institutionId: { type: 'string', format: 'uuid' },
                  institutionName: { const: '' },
                },
              },
              {
                required: ['institutionName'],
                properties: {
                  institutionName: { type: 'string', minLength: 2 },
                  institutionId: { const: '' },
                },
              },
            ],
          }
        : {}),
    },
  })),
};
schemas.IdentityUpload = object(
  {
    category: { type: 'string', enum: [...document.identityCategories] },
    file: { type: 'string', format: 'binary' },
  },
  ['category', 'file'],
);
schemas.Upload.description =
  'Choose category in Try it out. Required fields depend on category; the server enforces these rules.\n\n' +
  '| Category | Required metadata | Transcripts |\n| --- | --- | --- |\n' +
  Object.entries(document.academicDocumentRules)
    .map(
      ([category, rules]) =>
        `| ${category} (${rules.label}) | ${[...rules.requiredFields, ...(rules.institutionRequired ? ['institutionId OR institutionName'] : [])].join(', ')} | ${rules.transcriptsRequired ? '1–5 required' : 'Not accepted as attachments'} |`,
    )
    .join('\n') +
  '\n\nSearch GET /institutions?search=... and send the selected institutionId OR a typed institutionName, never both. Institution is optional for short courses and professional credentials. Swagger exposes all fields; the application frontend controls category-dependent visibility and institution autocomplete. Dates accept YYYY-MM-DD or an ISO datetime. Every file must be PDF, JPEG or PNG, at most 10 MB by default.';
const academicUploadProperties = schemas.Upload.properties as Record<string, unknown>;
academicUploadProperties.category = {
  type: 'string',
  enum: [...document.academicCategories],
  description:
    'Select a document category. BACHELOR, MASTER, PHD and DIPLOMA require a certificate plus transcripts.',
};
for (const [field, description] of Object.entries({
  courseName:
    'Course/programme studied, e.g. Software Engineering or Mechatronics Engineering. Required for degrees, diplomas, short courses and standalone transcripts.',
  certificationName: 'Name of the industry certification. Required for INDUSTRY_CERTIFICATION.',
  issuer:
    'Issuing organisation or professional body name. Required for INDUSTRY_CERTIFICATION and PROFESSIONAL_REGISTRATION.',
  title:
    'Descriptive name required for OTHER. Other categories use the uploaded filename as their title.',
  institutionId:
    'Select an active institution using GET /institutions?search=...; leave institutionName blank.',
  institutionName:
    'Type the institution name only when it is not listed; leave institutionId blank. This does not add an entry to the shared catalogue.',
  issuedAt:
    'Optional issue/award date for BACHELOR, MASTER, PHD and DIPLOMA; leave blank if unknown. Required only for industry certifications and professional registrations. Use YYYY-MM-DD or an ISO datetime; do not send the placeholder string.',
  expiresAt:
    'Leave blank for BACHELOR, MASTER, PHD and DIPLOMA. Required for professional registrations; optional for industry certifications. If supplied, use YYYY-MM-DD or an ISO datetime after issuedAt.',
})) {
  academicUploadProperties[field] = { ...(academicUploadProperties[field] as Schema), description };
}
for (const field of ['issuedAt', 'expiresAt']) {
  academicUploadProperties[field] = {
    ...(academicUploadProperties[field] as Schema),
    type: 'string',
    default: '',
    example: '',
  };
}
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
for (const prefix of ['/identity/documents', '/documents']) {
  add('post', prefix, 'Upload private quarantined document', 'Documents', {
    input: prefix.startsWith('/identity') ? 'IdentityUpload' : 'Upload',
    multipart: true,
    status: 201,
    output: ref('Document'),
    description: prefix.startsWith('/identity')
      ? 'Only category and file are required. Title is derived from the filename. Files are limited to 10 MB by default.'
      : String(schemas.Upload.description) +
        ' A current identity document must have been submitted first.',
  });
  add('get', prefix, 'List owned documents', 'Documents', { output: array(ref('Document')) });
  add(
    'post',
    `${prefix}/{id}/replace`,
    'Replace document while retaining prior review history',
    'Documents',
    {
      input: prefix.startsWith('/identity') ? 'IdentityUpload' : 'Upload',
      multipart: true,
      status: 201,
      output: ref('Document'),
      description:
        'Same requirements as a new upload, including fresh transcripts for degrees/diplomas. Prior documents and transcripts remain in the history.',
    },
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
  ['institutions', 'Institution'],
  ['companies', 'Company'],
  ['careers', 'Career'],
] as const)
  add('get', `/${path}`, `Browse active ${path}`, 'Career catalogue', {
    output: array(ref(output)),
    parameters:
      path === 'institutions'
        ? [
            ...pages,
            query('type', { type: 'string', enum: [...institutionTypes] }),
            query('offersTvet', { type: 'string', enum: ['true', 'false'] }),
          ]
        : path === 'companies' || path === 'careers'
          ? [
              ...pages,
              query('industryIds', {
                type: 'string',
                description:
                  path === 'careers'
                    ? 'Comma-separated UUIDs for up to three industries; career must match all selected industries.'
                    : 'Comma-separated UUIDs for up to three industries; company must match any selected industry.',
              }),
            ]
          : pages,
    ...(path === 'institutions'
      ? {
          description:
            'Search canonical institution names, abbreviations and alternative/campus names. Paginated results can be filtered by type or offersTvet. These are directory entries for applicant selection, not accreditation determinations.',
        }
      : {}),
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
add('get', '/assessments/targets', 'Read assessment target history', 'Assessments', {
  output: array(ref('AssessmentTarget')),
  parameters: pages,
});
add('post', '/assessments/targets', 'Choose one career and its assessment context', 'Assessments', {
  input: 'AssessmentTargetInput',
  output: ref('AssessmentTarget'),
  status: 201,
  description:
    'One active target per applicant. Choose 1–3 career-linked industries, 0–3 companies operating in those industries, and up to 10 of your current clean qualification documents. With no qualification documents, the profile discipline supplies course background. Complete the current assessment before creating another target.',
});
add(
  'get',
  '/assessments/targets/{id}',
  'Read owned career, industries, companies and qualifications',
  'Assessments',
  { output: ref('AssessmentTarget') },
);
add(
  'put',
  '/assessments/targets/{id}',
  'Replace choices while the target is a draft',
  'Assessments',
  { input: 'AssessmentTargetInput', output: ref('AssessmentTarget') },
);
add(
  'post',
  '/assessments/targets/{id}/prepare',
  'Freeze assessment context and approved competency requirements',
  'Assessments',
  {
    input: 'PrepareTargetInput',
    output: ref('AssessmentAttempt'),
    description:
      'Pins the core blueprint and snapshots the latest approved matching INDUSTRY, COMPANY and COURSE frameworks. Duplicate competencies use the highest required score and summed weights; missing context frameworks add no invented requirements. Course background never reduces core thresholds. Repeated preparation with the same blueprint returns the same attempt. Prepared choices and rubric rows are immutable.',
  },
);
add(
  'get',
  '/assessments/attempts/{id}',
  'Read owned frozen context, rubric, results and learning plan',
  'Assessments',
  { output: ref('AssessmentAttempt') },
);
add(
  'post',
  '/assessments/attempts/{id}/start',
  'Start the prepared assessment during its booked slot',
  'Assessments',
  {
    output: ref('AssessmentAttempt'),
    description:
      'Requires a scheduled booking for this target within its start/end window. Repeated starts while in progress return the same attempt. This records an assessment session; it does not launch an AI interviewer.',
  },
);
add(
  'get',
  '/assessments/learning-plans/{id}',
  'Read an owned upskilling plan and its assessed skill gaps',
  'Assessments',
  { output: ref('LearningPlan') },
);
add(
  'patch',
  '/assessments/learning-plans/{id}/items/{itemId}',
  'Record learning progress without changing assessment results',
  'Assessments',
  {
    input: 'LearningProgressInput',
    output: ref('LearningPlan'),
    description:
      'Progress is self-reported. Completing learning items does not certify mastery or remove the historical assessed gap; demonstrate improvement in another assessment.',
  },
);
add('post', '/assessments/bookings', 'Reserve assessment capacity transactionally', 'Assessments', {
  input: 'BookingInput',
  output: ref('Booking'),
  status: 201,
  parameters: [idem],
  description:
    'One active booking per applicant. Binds the booking to the active prepared target. Create and explicitly prepare an assessment target before booking. Complete the current assessment before creating the next target. Successful retries return the original booking.',
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
add(
  'get',
  '/admin/assessment-attempts/{id}',
  'Inspect an assessment for authorised grading',
  'Administration',
  {
    output: ref('AssessmentAttempt'),
    description: `${adminDescription} Requires assessments.review.`,
  },
);
add(
  'post',
  '/admin/assessment-attempts/{id}/complete',
  'Record assessor evidence, calculate skill gaps and create the learning plan',
  'Administration',
  {
    input: 'CompleteAttemptInput',
    output: ref('AssessmentAttempt'),
    parameters: [idem],
    description: `${adminDescription} Requires assessments.review and a started attempt. Submit exactly one 0–100 score and supporting evidence for each frozen requirement. Results, booking completion, target completion and learning recommendations commit atomically. The same idempotency key/results may be retried; changed results return 409. Overall score is the weighted mean; each skill gap is max(requiredScore-score,0). No employer selection or hiring decision is made.`,
  },
);
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
add(
  'get',
  '/assessments/{bookingId}/preflight',
  'Read booking entry policies without revealing scenarios',
  'Assessment sessions',
  {
    output: ref('AssessmentPreflight'),
    description:
      'Checks ownership. Readiness is reported by the browser, not attested by the backend. Preflight can be read before the booked start time.',
  },
);
add(
  'post',
  '/assessments/{bookingId}/start',
  'Confirm equipment, consent and start one interaction session',
  'Assessment sessions',
  {
    input: 'SessionStartInput',
    output: ref('AssessmentSession'),
    description:
      'Requires the scheduled start window and approved scenario coverage. Initialization is idempotent per prepared attempt. Device permission does not imply recording consent. No video is uploaded.',
  },
);
add(
  'get',
  '/assessment-sessions/{id}',
  'Read your persisted assessment conversation',
  'Assessment sessions',
  { output: ref('AssessmentSession') },
);
add(
  'get',
  '/assessment-sessions/{id}/current-scenario',
  'Read the current presented prompt only',
  'Assessment sessions',
  {
    output: object({
      progress: ref('SessionProgress'),
      prompt: { anyOf: [ref('ConversationMessage'), { type: 'null' }] },
    }),
  },
);
add(
  'post',
  '/assessment-sessions/{id}/responses',
  'Submit a confirmed text or voice-transcribed answer',
  'Assessment sessions',
  {
    input: 'ConfirmedResponseInput',
    output: ref('AssessmentSession'),
    parameters: [idem],
    description:
      'Partial transcriptions cannot advance the graph. Original transcripts and corrections are retained; raw audio is not. Retry with the same key and payload; use resume after interruption.',
  },
);
add(
  'post',
  '/assessment-sessions/{id}/audio/transcribe',
  'Transcribe transient WAV audio or register a final browser transcript',
  'Assessment sessions',
  {
    input: 'AudioUpload',
    output: ref('Transcription'),
    multipart: true,
    description:
      'Multipart field audio for the compatible STT adapter, or application/json BrowserTranscriptionInput when STT_PROVIDER=browser. Requires recorded audio-processing consent and an active owned session. Browser text is self-reported and must still be confirmed as an answer.',
  },
);
const transcriptionOperation = paths['/assessment-sessions/{id}/audio/transcribe']!.post as {
  requestBody: { content: Record<string, unknown> };
};
transcriptionOperation.requestBody.content['application/json'] = {
  schema: ref('BrowserTranscriptionInput'),
};
add(
  'post',
  '/assessment-sessions/{id}/speech/synthesize',
  'Speak an existing interviewer message',
  'Assessment sessions',
  {
    input: 'SpeechInput',
    output: object({ provider: { const: 'browser' }, text: str, language: str }),
    description:
      'Only a message ID belonging to this session is accepted; arbitrary text is rejected. Browser mode returns authoritative text for SpeechSynthesis. Compatible mode returns transient audio/wav. Failures do not advance the assessment.',
  },
);
const speechOperation = paths['/assessment-sessions/{id}/speech/synthesize']!.post as {
  responses: Record<string, { content: Record<string, unknown> }>;
};
speechOperation.responses['200']!.content['audio/wav'] = {
  schema: { type: 'string', format: 'binary' },
};
add(
  'get',
  '/assessment-sessions/{id}/progress',
  'Read scenario completion progress',
  'Assessment sessions',
  {
    output: object({
      status: str,
      totalScenarios: { type: 'integer' },
      completedScenarios: { type: 'integer' },
      currentScenario: { type: ['integer', 'null'] },
      hasPendingResponse: { type: 'boolean' },
    }),
  },
);
add(
  'post',
  '/assessment-sessions/{id}/resume',
  'Resume persisted LangGraph checkpoints after interruption',
  'Assessment sessions',
  { output: ref('AssessmentSession') },
);
add(
  'post',
  '/assessment-sessions/{id}/events',
  'Record a device or network interruption',
  'Assessment sessions',
  { input: 'SessionEventInput' },
);
add(
  'get',
  '/assessment-sessions/{id}/results',
  'Read provisional AI proposals or final reviewed competency results',
  'Assessment sessions',
  { output: ref('InteractionResults') },
);
add(
  'get',
  '/admin/scenarios',
  'List private scenario bank and evaluation criteria',
  'Administration',
  { output: array(ref('Scenario')), description: adminDescription },
);
add(
  'post',
  '/admin/scenarios',
  'Create a versioned scenario and record approval',
  'Administration',
  { input: 'ScenarioInput', output: ref('Scenario'), status: 201, description: adminDescription },
);
add(
  'put',
  '/admin/blueprints/{id}/scenarios',
  'Assign approved scenarios in presentation order',
  'Administration',
  { input: 'ScenarioAssignmentInput', description: adminDescription },
);
add(
  'put',
  '/admin/assessment-attempts/{id}/accommodation',
  'Approve an equipment or text accommodation before session start',
  'Administration',
  {
    input: 'AccommodationInput',
    output: object({
      id,
      attemptId: id,
      waiveCamera: { type: 'boolean' },
      waiveMicrophone: { type: 'boolean' },
      allowText: { type: 'boolean' },
      reason: str,
      approvedById: id,
      createdAt: date,
    }),
    description: adminDescription,
  },
);
add(
  'get',
  '/admin/assessment-sessions/{id}',
  'Review a conversation and proposed AI scores',
  'Administration',
  {
    output: {
      ...schemas.AssessmentSession,
      properties: {
        ...(schemas.AssessmentSession!.properties as object),
        evaluation: { type: ['array', 'null'], items: { type: 'object' } },
      },
    },
    description: adminDescription,
  },
);
add(
  'post',
  '/admin/assessment-sessions/{id}/approve-results',
  'Approve AI proposals and publish the existing skill-gap report',
  'Administration',
  {
    output: ref('AssessmentAttempt'),
    parameters: [idem],
    description:
      adminDescription +
      ' Review the conversation and evidence first. This uses existing immutable completion and deterministic learning-plan rules. Use the existing assessor completion endpoint to submit corrected scores instead.',
  },
);

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'VML NEXUS API',
    version: '0.1.0',
    description:
      'Applicant onboarding, private credential review, one-career assessment targets, scheduling, assessor-recorded competency results and upskilling plans. Assessment inputs and approved rubrics are frozen per attempt; completion unlocks another career target. A configurable AI interviewer supports approved scenarios, confirmed text/voice answers, persistent checkpoints and assessor-reviewed results. Course delivery is not connected. Fetch /auth/csrf first; send its token with every state-changing request. Swagger UI fetches it automatically for Try it out. Cookies are managed by the browser. See docs/authentication.md for the admin MFA flow.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    'Authentication',
    'Applicants',
    'Documents',
    'Career catalogue',
    'Assessments',
    'Assessment sessions',
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
