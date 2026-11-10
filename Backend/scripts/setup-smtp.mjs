import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';

// Credentials arrive on stdin, never in command-line arguments or logs.
let raw = '';
for await (const chunk of process.stdin) {
  raw += chunk;
  if (raw.length > 16384) throw new Error('SMTP configuration input is too large');
}
let transport;
try {
  const input = JSON.parse(raw.replace(/^\uFEFF/, ''));
  raw = '';
  if (!input.host || /[\s/@]/.test(input.host) || ![465, 587].includes(input.port) ||
      typeof input.secure !== 'boolean' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.from) ||
      !input.user || !input.password ||
      [input.host, input.from, input.user, input.password].some(value => typeof value !== 'string' || /[\r\n\0]/.test(value))) {
    throw new Error('INVALID_INPUT');
  }
  transport = nodemailer.createTransport({
    host: input.host, port: input.port, secure: input.secure,
    requireTLS: !input.secure,
    auth: { user: input.user, pass: input.password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  });
  await transport.verify();
  const path = new URL('../.env', import.meta.url);
  let envText = await readFile(path, 'utf8');
  // Dotenv single quotes preserve dollar signs, hashes and double quotes literally.
  // Prefer backticks if the credential contains single quotes; reject unsupported mixtures.
  const quote = value => {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('`')) return '`' + value + '`';
    if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;
    throw new Error('UNSUPPORTED_QUOTING');
  };
  const entries = {
    SMTP_HOST: quote(input.host), SMTP_PORT: String(input.port), SMTP_SECURE: String(input.secure),
    SMTP_USER: quote(input.user), SMTP_PASSWORD: quote(input.password), EMAIL_FROM: quote(input.from),
  };
  for (const [key, value] of Object.entries(entries)) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}=.*$`, 'gm');
    envText = envText.replace(pattern, '');
    envText = envText.trimEnd() + `\n${key}=${value}\n`;
  }
  await writeFile(path, envText, { mode: 0o600 });
  input.password = '';
  console.log('SMTP authentication verified and Backend/.env updated. No test email was sent.');
  console.log('Restart the API and worker, then request a fresh verification code.');
  console.log('Connection verification does not confirm sender authorization or inbox delivery; check your provider’s sender settings.');
} catch (error) {
  const code = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(error.code) ? error.code :
    ['INVALID_INPUT', 'UNSUPPORTED_QUOTING'].includes(error.message) ? error.message : 'SETUP_FAILED';
  console.error(`SMTP setup failed (${code}). Credentials are not displayed. Existing configuration was not intentionally changed.`);
  process.exitCode = 1;
} finally { transport?.close(); }
