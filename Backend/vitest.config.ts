import { defineConfig } from 'vitest/config';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl && new URL(testDatabaseUrl).pathname !== '/nexus_test') {
  throw new Error('TEST_DATABASE_URL must name the isolated nexus_test database');
}
export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://nexus@127.0.0.1:55441/nexus_test',
      SESSION_SECRET: 'isolated-test-session-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      OTP_PEPPER: 'isolated-test-otp-pepper-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      DATA_ENCRYPTION_KEY: '11'.repeat(32),
      APP_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000',
      ENABLE_SWAGGER: 'true',
      AI_PROVIDER: 'disabled',
      AI_BASE_URL: 'https://ai.example.test/v1',
      AI_API_KEY: 'test-only-key',
      AI_MODEL: 'test-only-model',
      STT_PROVIDER: 'browser',
      TTS_PROVIDER: 'browser',
    },
  },
});
