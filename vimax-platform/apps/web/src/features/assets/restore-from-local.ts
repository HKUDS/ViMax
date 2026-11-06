"use client";

// ── 本地恢复通路（offload 的逆操作）─────────────────────────────
// 节点重跑需要上游二进制而云端已本地化清除时，从 IndexedDB 金库读出
// blob，经 restoreRequest → PUT → restoreConfirm 写回原 storage_key
// 并清除 offloaded 标记，然后重试入队。

import type { trpc } from "@/lib/trpc/client";
import { getLocalAssetBlob } from "@/lib/local-assets";

type VanillaClient = ReturnType<(typeof trpc)["useUtils"]>["client"];

/** 识别服务端入队预检抛出的 `asset.input_offloaded:<id,...>`，返回资产 id 列表。 */
export function parseOffloadedInputError(message: string): string[] | null {
  const m = /^asset\.input_offloaded:(.+)$/.exec(message);
  if (!m) return null;
  const ids = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/** 逐个把本地副本回传云端。本地也没有副本时抛出用户可读的错误。 */
export async function restoreAssetsFromLocal(
  assetIds: string[],
  client: VanillaClient,
): Promise<void> {
  for (const assetId of assetIds) {
    const blob = await getLocalAssetBlob(assetId);
    if (!blob) {
      throw new Error("参考图已从云端清理，且本地图库中没有副本，请重新生成上游图片节点");
    }
    const req = await client.asset.restoreRequest.mutate({ asset_id: assetId });
    if (req.upload_url) {
      const res = await fetch(req.upload_url, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": req.mime_type },
      });
      if (!res.ok) throw new Error(`恢复资产上传失败（HTTP ${res.status}）`);
      await client.asset.restoreConfirm.mutate({ asset_id: assetId });
    }
  }
}

type NodeRunInput = { canvas_id: string; node_id: string };

/**
 * runNode 的统一入口：命中入队预检 `asset.input_offloaded` 时先从本地
 * 金库恢复再重试一次。所有触发节点重跑的 UI（画布 / 项目页）都应经由
 * 此包装，否则已本地化的输入会导致重跑必然失败。
 */
export async function runNodeWithLocalRestore<T>(
  client: VanillaClient,
  input: NodeRunInput,
  run: (input: NodeRunInput) => Promise<T>,
): Promise<T> {
  try {
    return await run(input);
  } catch (err) {
    const ids = parseOffloadedInputError(err instanceof Error ? err.message : "");
    if (!ids) throw err;
    await restoreAssetsFromLocal(ids, client);
    return await run(input);
  }
}
