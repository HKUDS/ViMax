import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config/env.js";

let client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: config.s3.endpoint(),
      region: config.s3.region(),
      credentials: {
        accessKeyId: config.s3.accessKey(),
        secretAccessKey: config.s3.secretKey(),
      },
      forcePathStyle: config.s3.forcePathStyle(),
    });
  }
  return client;
}

export function getBucket(): string {
  return config.s3.bucket();
}

export async function createPresignedUploadUrl(
  storageKey: string,
  mimeType: string,
  expiresInSec = 900,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
    ContentType: mimeType,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSec });
}

export async function createPresignedDownloadUrl(
  storageKey: string,
  expiresInSec = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
  });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSec });
}

export async function headObject(storageKey: string) {
  return getS3Client().send(
    new HeadObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
    }),
  );
}

/** Read an object's full bytes (asset analysis needs the payload in-process). */
export async function getObjectBuffer(storageKey: string): Promise<Buffer> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
    }),
  );
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${storageKey}`);
  return Buffer.from(bytes);
}

/** Remove an object from the bucket. Missing objects are treated as deleted. */
export async function deleteObject(storageKey: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
    }),
  );
}

export function buildStorageKey(prefix: string, filename: string): string {
  return `${prefix.replace(/\/$/, "")}/${filename}`;
}
