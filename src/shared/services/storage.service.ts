import fs from 'fs/promises';
import path from 'path';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

/**
 * Storage service — stubbed to local filesystem for development.
 * Replace with Cloudflare R2 S3-compatible SDK when keys are available.
 */

export async function getPresignedUploadUrl(key: string, _contentType: string): Promise<{ url: string }> {
  // In production, this would return a presigned R2 PUT URL.
  // For local dev, we return a local upload endpoint URL.
  return {
    url: `http://localhost:4000/api/v1/operative/upload-local?key=${encodeURIComponent(key)}`,
  };
}

export async function uploadFile(key: string, data: Buffer): Promise<void> {
  const filePath = path.join(UPLOADS_DIR, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

export async function getFile(key: string): Promise<Buffer> {
  const filePath = path.join(UPLOADS_DIR, key);
  return fs.readFile(filePath);
}

export async function deleteFile(key: string): Promise<void> {
  try {
    const filePath = path.join(UPLOADS_DIR, key);
    await fs.unlink(filePath);
  } catch {
    // File may not exist, that's ok
  }
}

export async function deleteFiles(keys: string[]): Promise<void> {
  await Promise.all(keys.map(deleteFile));
}

export function getFileUrl(key: string): string {
  // In production: R2 public URL or presigned GET
  return `http://localhost:4000/uploads/${key}`;
}
