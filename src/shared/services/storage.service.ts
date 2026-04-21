import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';

const isR2Configured = env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY;
let s3Client: S3Client | null = null;

if (isR2Configured) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

export async function getPresignedUploadUrl(key: string, contentType: string): Promise<{ url: string }> {
  if (s3Client) {
    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    return { url };
  } else {
    // Local dev fallback
    return {
      url: `http://localhost:4000/api/v1/operative/upload-local?key=${encodeURIComponent(key)}`,
    };
  }
}

export async function uploadFile(key: string, data: Buffer): Promise<void> {
  if (s3Client) {
    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: data,
    });
    await s3Client.send(command);
  } else {
    const filePath = path.join(UPLOADS_DIR, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }
}

export async function getFile(key: string): Promise<Buffer> {
  if (s3Client) {
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
    });
    const response = await s3Client.send(command);
    const byteArray = await response.Body?.transformToByteArray();
    return Buffer.from(byteArray || []);
  } else {
    const filePath = path.join(UPLOADS_DIR, key);
    return fs.readFile(filePath);
  }
}

export async function deleteFile(key: string): Promise<void> {
  try {
    if (s3Client) {
      const command = new DeleteObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
      });
      await s3Client.send(command);
    } else {
      const filePath = path.join(UPLOADS_DIR, key);
      await fs.unlink(filePath);
    }
  } catch {
    // File may not exist, that's ok
  }
}

export async function deleteFiles(keys: string[]): Promise<void> {
  await Promise.all(keys.map(deleteFile));
}

export function getFileUrl(key: string): string {
  if (s3Client) {
    // Return Public URL if configured, or just the presigned GET / bucket endpoint logic
    // For now, depending on public bucket configuration:
    return `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/${key}`; // Replace with actual public URL domain if known
  }
  return `http://localhost:4000/uploads/${key}`;
}

