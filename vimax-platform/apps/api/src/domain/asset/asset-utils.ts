export type AssetKind = "image" | "video" | "audio";

export function inferAssetKind(mimeType: string): AssetKind {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

export function shouldCreateAsset(output: { storage_key?: string; cells?: unknown }): boolean {
  if (Array.isArray(output.cells) && output.cells.length > 0) return false;
  return Boolean(output.storage_key?.trim());
}
