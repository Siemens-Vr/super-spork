import { describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() }));
vi.mock('../../src/config/prisma.js', () => ({ prisma: { documentVerification: db } }));
import {
  reviewNotifications,
  readReviewNotifications,
} from '../../src/services/document-notifications.service.js';
describe('document review notifications', () => {
  it('restricts reads to the owner and excludes private reviewer fields', async () => {
    db.findMany.mockResolvedValue([]);
    db.count.mockResolvedValue(1);
    expect(await reviewNotifications('owner')).toEqual({ items: [], unreadCount: 1 });
    const query = db.findMany.mock.calls[0]![0];
    expect(query.where).toEqual({ document: { applicantId: 'owner' } });
    expect(query.take).toBe(50);
    expect(query.select).not.toHaveProperty('internalNotes');
    expect(query.select).not.toHaveProperty('evidenceReference');
    expect(db.count).toHaveBeenCalledWith({
      where: { document: { applicantId: 'owner' }, applicantReadAt: null },
    });
  });
  it('marks only requested unread reviews belonging to this applicant', async () => {
    await readReviewNotifications('owner', ['review']);
    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['review'] }, document: { applicantId: 'owner' }, applicantReadAt: null },
      data: { applicantReadAt: expect.any(Date) },
    });
  });
});
