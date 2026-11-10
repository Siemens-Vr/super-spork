import 'dotenv/config';
import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url().default('redis://127.0.0.1:6379'),
    APP_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:4000'),
    FRONTEND_URL: z.url().default('http://localhost:3000'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    SESSION_SECRET: z.string().min(48),
    DATA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    OTP_PEPPER: z.string().min(48),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    ADMIN_MFA_MAX_AGE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_SECONDS: z.coerce.number().int().min(30).default(60),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.email().default('noreply@vml.example'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('nexus-private'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(true),
    CLAMAV_HOST: z.string().default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().default(3310),
    MAX_UPLOAD_TOTAL_MB: z.coerce.number().int().min(1).max(120).default(30),
    MAX_CONCURRENT_UPLOADS: z.coerce.number().int().min(1).max(16).default(4),
    MAX_ACCOUNT_UPLOAD_MB: z.coerce.number().int().min(1).max(10000).default(500),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(20).default(10),
    ENABLE_SWAGGER: bool.default(true),
    DOCUMENT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
    PRIVACY_NOTICE_VERSION: z.string().default('2026-11-01'),
    AI_PROVIDER: z.enum(['disabled', 'compatible']).default('disabled'),
    AI_BASE_URL: z.url().optional(),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(90000),
    AI_TLS_MAX_VERSION: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.3'),
    AI_REASONING_EFFORT: z.enum(['none', 'low', 'medium', 'high']).optional(),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(1024),
    AI_KEEP_ALIVE: z
      .string()
      .regex(/^\d{1,3}[smh]$/)
      .optional(),
    STT_PROVIDER: z.enum(['disabled', 'browser', 'compatible']).default('browser'),
    STT_BASE_URL: z.url().optional(),
    STT_API_KEY: z.string().optional(),
    STT_MODEL: z.string().optional(),
    STT_LANGUAGE: z.string().min(2).max(20).default('en'),
    TTS_PROVIDER: z.enum(['disabled', 'browser', 'compatible']).default('browser'),
    TTS_BASE_URL: z.url().optional(),
    TTS_API_KEY: z.string().optional(),
    TTS_MODEL: z.string().optional(),
    TTS_VOICE: z.string().default('alloy'),
    MAX_AUDIO_MB: z.coerce.number().int().min(1).max(10).default(8),
    MAX_AUDIO_SECONDS: z.coerce.number().int().min(10).max(300).default(180),
  })
  .superRefine((v, ctx) => {
    const frontend = new URL(v.FRONTEND_URL);
    if (
      !['http:', 'https:'].includes(frontend.protocol) ||
      frontend.username ||
      frontend.password ||
      frontend.search ||
      frontend.hash ||
      frontend.pathname !== '/'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'Use a trusted frontend origin without a path, credentials, query or fragment',
      });
    if (v.NODE_ENV === 'production' && frontend.protocol !== 'https:')
      ctx.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'Production frontend requires HTTPS',
      });
    if (v.NODE_ENV === 'production' && !v.APP_URL.startsWith('https://'))
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production requires HTTPS' });
  });
export type Env = z.infer<typeof schema>;
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return schema.parse(input);
}
export const env = loadEnv();
