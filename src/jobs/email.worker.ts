import nodemailer from 'nodemailer';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { decrypt } from '../utils/crypto.js';
import type { EmailMessage } from '../services/email.service.js';
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
});
export async function deliverEmail(id: string) {
  if (!env.SMTP_HOST) throw new Error('SMTP is not configured');
  const outbox = await prisma.notificationOutbox.findUnique({ where: { id } });
  if (!outbox || outbox.status === 'SENT' || !outbox.encryptedPayload) return;
  const message = JSON.parse(decrypt(outbox.encryptedPayload)) as EmailMessage;
  await transport.sendMail({
    from: env.EMAIL_FROM,
    ...message,
    messageId: `<${id}@nexus.vml>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  await prisma.notificationOutbox.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date(), encryptedPayload: null },
  });
}
