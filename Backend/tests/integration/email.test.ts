import { describe, it, expect, vi, afterAll } from 'vitest';
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
import { prisma } from '../../src/config/prisma.js';
import { notify } from '../../src/services/email.service.js';
import { deliverEmail } from '../../src/jobs/email.worker.js';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('durable encrypted notification delivery', () => {
  afterAll(() => prisma.$disconnect());
  it('erases plaintext-equivalent payloads after successful delivery and ignores repeat work', async () => {
    if (!new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith('/nexus_test'))
      throw new Error('Test database required');
    const created = await prisma.$transaction(async (tx) => {
      await notify(tx, 'delivery@example.test', 'Delivery test', 'Non-sensitive test notification');
      return tx.notificationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    });
    expect(created.encryptedPayload).not.toContain('Non-sensitive');
    sendMail.mockResolvedValueOnce({ messageId: 'mock-delivery' });
    await deliverEmail(created.id);
    const result = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: created.id } });
    expect(result.status).toBe('SENT');
    expect(result.encryptedPayload).toBeNull();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: `<${created.id}@nexus.vml>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    const count = sendMail.mock.calls.length;
    await deliverEmail(created.id);
    expect(sendMail.mock.calls).toHaveLength(count);
  });
  it('preserves pending intent after SMTP failure for retry', async () => {
    const created = await prisma.$transaction(async (tx) => {
      await notify(tx, 'retry@example.test', 'Retry test', 'Pending test notification');
      return tx.notificationOutbox.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    });
    sendMail.mockRejectedValueOnce(new Error('Mock SMTP outage'));
    await expect(deliverEmail(created.id)).rejects.toThrow('Mock SMTP outage');
    const result = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: created.id } });
    expect(result.status).toBe('PENDING');
    expect(result.encryptedPayload).toBeTruthy();
  });
});
