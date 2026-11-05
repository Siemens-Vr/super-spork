import type { Tx } from '../config/prisma.js';
import { encrypt } from '../utils/crypto.js';
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export async function notify(tx: Tx, to: string, subject: string, text: string) {
  await tx.notificationOutbox.create({
    data: {
      encryptedPayload: encrypt(
        JSON.stringify({
          to,
          subject: `VML NEXUS — ${subject}`,
          text: `VML NEXUS\n\n${text}\n\nVirtual Mechatronics Labs\nIf you did not request this change, contact the institutional support team.`,
        } satisfies EmailMessage),
      ),
    },
  });
}
