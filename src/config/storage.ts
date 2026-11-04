import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { env } from './env.js';
import { AppError } from '../errors/app-error.js';
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY
    ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } }
    : {}),
});
export interface PrivateStorage {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  health(): Promise<void>;
}
export const storage: PrivateStorage = {
  async put(key, body, mime) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: mime,
          ServerSideEncryption: env.NODE_ENV === 'production' ? 'AES256' : undefined,
        }),
      );
    } catch {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Private document storage is unavailable');
    }
  },
  async get(key) {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      if (!obj.Body) throw new Error('Empty object');
      return Buffer.from(await obj.Body.transformToByteArray());
    } catch {
      throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Private document storage is unavailable');
    }
  },
  async remove(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },
  async health() {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  },
};
