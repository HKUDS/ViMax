export interface CanvasNavigateParams {
  textModelId?: string;
  imageModelId?: string;
  videoModelId?: string;
  prompt?: string;
  mode?: string;
  /** Uploaded product image asset — becomes an i2i reference node on the canvas. */
  productAssetId?: string;
}

export function buildCanvasUrl(
  canvasId: string,
  params?: CanvasNavigateParams,
): string {
  const search = new URLSearchParams();

  if (params?.textModelId) search.set("textModelId", params.textModelId);
  if (params?.imageModelId) search.set("imageModelId", params.imageModelId);
  if (params?.videoModelId) search.set("videoModelId", params.videoModelId);
  if (params?.prompt) search.set("prompt", params.prompt);
  if (params?.mode) search.set("mode", params.mode);
  if (params?.productAssetId) search.set("productAssetId", params.productAssetId);

  const qs = search.toString();
  return qs ? `/canvas/${canvasId}?${qs}` : `/canvas/${canvasId}`;
}

export function shouldSkipAppShell(pathname: string): boolean {
  return pathname.startsWith("/canvas/");
}
