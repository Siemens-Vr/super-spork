import multer from 'multer';
import { env } from '../config/env.js';
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: 6,
    fields: 12,
    fieldSize: 4096,
    parts: 18,
  },
}).fields([
  { name: 'file', maxCount: 1 },
  { name: 'transcripts', maxCount: 5 },
]);
