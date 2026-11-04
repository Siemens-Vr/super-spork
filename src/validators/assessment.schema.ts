import { z } from 'zod';
export const bookingSchema = z.object({ slotId: z.uuid() }).strict();
export const reasonSchema = z.object({ reason: z.string().trim().min(5).max(1000) }).strict();
export const rescheduleSchema = z
  .object({ slotId: z.uuid(), reason: z.string().trim().min(5).max(1000) })
  .strict();
export const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const slotQuery = z.object({
  blueprintId: z.uuid(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export const availabilitySchema = z
  .object({
    blueprintId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(1).max(100),
    minNoticeMinutes: z.number().int().min(0).max(10080).default(60),
    maxHorizonDays: z.number().int().min(1).max(365).default(90),
    cancellationNoticeMinutes: z.number().int().min(0).max(10080).default(60),
    rescheduleLimit: z.number().int().min(0).max(10).default(2),
    timezone: z
      .string()
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone')
      .default('Africa/Nairobi'),
  })
  .strict()
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    path: ['endsAt'],
    message: 'End must follow start',
  });
