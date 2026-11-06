import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AssetConfirmUpload, AssetUploadRequest } from "@vimax/contracts";
import { getDb } from "../../infrastructure/db/client.js";
import { assets } from "../../infrastructure/db/schema.js";
import { inferAssetKind } from "./asset-utils.js";
import {
  buildStorageKey,
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  getBucket,
  headObject,
} from "../../infrastructure/storage/s3.js";

export async function requestAssetUpload(input: AssetUploadRequest) {
  const assetId = randomUUID();
  const ext = input.mime_type.split("/")[1] ?? "png";
  const storageKey = buildStorageKey("uploads", `${assetId}.${ext}`);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  const db = getDb();
  await db.insert(assets).values({
    id: assetId,
    kind: inferAssetKind(input.mime_type),
    mimeType: input.mime_type,
    storageKey,
    sizeBytes: input.size_bytes,
    sha256: `pending-${assetId}`,
    source: "upload",
  });

  const uploadUrl = await createPresignedUploadUrl(storageKey, input.mime_type);

  return {
    asset_id: assetId,
    upload_url: uploadUrl,
    storage_key: storageKey,
    expires_at: expiresAt.toISOString(),
  };
}

export async function confirmAssetUpload(input: AssetConfirmUpload) {
  const db = getDb();
  const [asset] = await db.select().from(assets).where(eq(assets.id, input.asset_id)).limit(1);
  if (!asset) {
    throw new Error("input.asset_not_found");
  }

  await headObject(asset.storageKey);

  const [updated] = await db
    .update(assets)
    .set({
      sha256: input.sha256,
      width: input.width,
      height: input.height,
    })
    .where(eq(assets.id, input.asset_id))
    .returning();

  const previewUrl = await createPresignedDownloadUrl(updated.storageKey);
  return { asset_id: updated.id, preview_url: previewUrl };
}

export async function getAssetDownloadUrl(assetId: string) {
  const db = getDb();
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) {
    throw new Error("input.asset_not_found");
  }
  if (asset.offloadedAt) {
    throw new Error("input.asset_offloaded_local");
  }

  const url = await createPresignedDownloadUrl(asset.storageKey);
  return {
    asset_id: asset.id,
    url,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

export async function getAssetById(assetId: string) {
  const db = getDb();
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  return asset ?? null;
}

export { getBucket };
