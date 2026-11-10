import multer from 'multer';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform, pipeline } from 'node:stream';
import type { Request, RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

const contexts = new WeakMap<Request, { directory: string; bytes: number }>();
let active = 0;
const accounts = new Map<string, number>();
const storage: multer.StorageEngine = {
  _handleFile(req, file, callback) {
    const context = contexts.get(req)!;
    const filename = randomUUID(),
      path = join(context.directory, filename);
    let size = 0;
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        context.bytes += chunk.length;
        if (context.bytes > env.MAX_UPLOAD_TOTAL_MB * 1024 * 1024)
          return done(
            new AppError(413, 'UPLOAD_TOO_LARGE', 'Combined upload exceeds the request limit'),
          );
        done(null, chunk);
      },
    });
    pipeline(file.stream, bound, createWriteStream(path, { flags: 'wx', mode: 0o600 }), (error) => {
      if (error) {
        void unlink(path).catch(() => {});
        callback(error);
      } else callback(null, { destination: context.directory, filename, path, size });
    });
  },
  _removeFile(_req, file, callback) {
    unlink(file.path)
      .then(() => callback(null))
      .catch((error) => callback(error.code === 'ENOENT' ? null : error));
  },
};
export function boundedMultipart(fields: multer.Field[], audio = false): RequestHandler {
  const parse = multer({
    storage,
    limits: {
      fileSize: (audio ? env.MAX_AUDIO_MB : env.MAX_UPLOAD_MB) * 1024 * 1024,
      files: audio ? 1 : 6,
      fields: audio ? 0 : 12,
      fieldSize: 4096,
      parts: audio ? 1 : 18,
    },
  }).fields(fields);
  return async (req, res, next) => {
    const account = req.principal!.id;
    if (active >= env.MAX_CONCURRENT_UPLOADS || (accounts.get(account) ?? 0) >= 2)
      return next(new AppError(429, 'UPLOAD_BUSY', 'Too many simultaneous uploads; retry shortly'));
    const length = Number(req.get('content-length') ?? 0);
    if (length > env.MAX_UPLOAD_TOTAL_MB * 1024 * 1024 + 65536)
      return next(
        new AppError(413, 'UPLOAD_TOO_LARGE', 'Combined upload exceeds the request limit'),
      );
    active++;
    accounts.set(account, (accounts.get(account) ?? 0) + 1);
    let released = false,
      directory: string | undefined;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      const count = (accounts.get(account) ?? 1) - 1;
      if (count) accounts.set(account, count);
      else accounts.delete(account);
      contexts.delete(req);
      if (directory) void rm(directory, { recursive: true, force: true }).catch(() => {});
    };
    try {
      directory = await mkdtemp(join(tmpdir(), 'nexus-upload-'));
      contexts.set(req, { directory, bytes: 0 });
      res.once('finish', release);
      res.once('close', release);
      req.once('aborted', release);
      if (req.aborted || res.destroyed) {
        release();
        return;
      }
      parse(req, res, (error) => {
        if (error) release();
        next(error);
      });
    } catch (error) {
      release();
      next(error);
    }
  };
}
export const upload = boundedMultipart([
  { name: 'file', maxCount: 1 },
  { name: 'transcripts', maxCount: 5 },
]);
export const audioUpload = boundedMultipart([{ name: 'audio', maxCount: 1 }], true);
