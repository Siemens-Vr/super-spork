import { z } from 'zod';
export const interactionPolicySchema = z
  .object({
    cameraRequired: z.boolean().default(false),
    microphoneRequired: z.boolean().default(false),
    allowText: z.boolean().default(true),
    language: z.string().trim().min(2).max(20).default('en'),
    cameraPurpose: z.string().trim().min(10).max(1000).optional(),
    accommodationInstructions: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .default(
        'Contact an administrator to request a camera or microphone exception or a text-based assessment before starting.',
      ),
  })
  .strict()
  .refine((v) => !v.cameraRequired || !!v.cameraPurpose, 'Explain why the camera is required');
const device = z.enum(['READY', 'DENIED', 'UNAVAILABLE', 'NOT_REQUESTED']);
export const sessionStartSchema = z
  .object({
    confirmed: z.literal(true),
    mode: z.enum(['TEXT', 'VOICE']),
    devices: z
      .object({ camera: device, microphone: device, speakerConfirmed: z.boolean() })
      .strict(),
    privacyAcknowledged: z.literal(true),
    audioProcessingConsent: z.boolean().default(false),
  })
  .strict();
export const confirmedResponseSchema = z
  .object({
    promptId: z.uuid(),
    origin: z.enum(['TEXT', 'VOICE']),
    confirmed: z.literal(true),
    text: z.string().trim().min(1).max(12000),
    transcriptionId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.origin !== 'VOICE' || !!v.transcriptionId,
    'Voice responses require a final transcription',
  )
  .refine(
    (v) => v.origin !== 'TEXT' || !v.transcriptionId,
    'Text responses cannot reference a transcription',
  );
export const browserTranscriptSchema = z
  .object({
    text: z.string().trim().min(1).max(12000),
    isFinal: z.literal(true),
    language: z.string().min(2).max(20).default('en'),
  })
  .strict();
export const speechRequestSchema = z.object({ messageId: z.uuid() }).strict();
export const sessionEventSchema = z
  .object({
    kind: z.enum(['DISCONNECTED', 'DEVICE_DISCONNECTED', 'PLAYBACK_FAILED', 'MICROPHONE_MUTED']),
    device: z.enum(['camera', 'microphone', 'speaker', 'network']).optional(),
  })
  .strict();
export const accommodationSchema = z
  .object({
    waiveCamera: z.boolean().default(false),
    waiveMicrophone: z.boolean().default(false),
    allowText: z.boolean().default(false),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export const scenarioSchema = z
  .object({
    code: z
      .string()
      .regex(/^[A-Z0-9_-]+$/)
      .max(60),
    version: z.number().int().min(1),
    title: z.string().min(3).max(200),
    prompt: z.string().min(20).max(6000),
    evaluationCriteria: z.string().min(20).max(6000),
    competencyIds: z
      .array(z.uuid())
      .min(1)
      .max(30)
      .refine((v) => new Set(v).size === v.length, 'Duplicate competencies'),
    maxFollowups: z.number().int().min(0).max(3).default(2),
    approved: z.boolean().default(false),
  })
  .strict();
export const scenarioAssignmentSchema = z
  .object({
    scenarioIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((v) => new Set(v).size === v.length, 'Duplicate scenarios'),
  })
  .strict();
export const frozenScenarioSchema = scenarioSchema.extend({ id: z.uuid() }).strip();
export type FrozenScenario = z.infer<typeof frozenScenarioSchema>;
