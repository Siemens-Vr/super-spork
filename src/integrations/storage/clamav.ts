import { createConnection } from 'node:net';
import { once } from 'node:events';
import { env } from '../../config/env.js';
export async function scanFile(buffer: Buffer): Promise<'CLEAN' | 'INFECTED'> {
  const socket = createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
  socket.setTimeout(30000, () => socket.destroy(new Error('Scanner timeout')));
  const response = new Promise<string>((resolve, reject) => {
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString();
      if (text.includes('\0')) resolve(text);
    });
    socket.on('error', reject);
    socket.on('end', () =>
      text ? resolve(text) : reject(new Error('Scanner closed without a result')),
    );
  });
  try {
    await once(socket, 'connect');
    socket.write('zINSTREAM\0');
    for (let offset = 0; offset < buffer.length; offset += 65536) {
      const chunk = buffer.subarray(offset, offset + 65536),
        size = Buffer.alloc(4);
      size.writeUInt32BE(chunk.length);
      socket.write(size);
      if (!socket.write(chunk)) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
    const result = await response;
    if (result.includes(' FOUND')) return 'INFECTED';
    if (result.includes(': OK')) return 'CLEAN';
    throw new Error('Scanner returned no verdict');
  } finally {
    socket.destroy();
    response.catch(() => {});
  }
}
