import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasEdges, canvasNodes } from "../../infrastructure/db/schema.js";
import {
  createPresignedUploadUrl,
  deleteObject,
  headObject,
} from "../../infrastructure/storage/s3.js";

// ── 本地化存储策略 ────────────────────────────────────────────────
// 云端对象存储只做瞬时中转：worker 产物先上传（传输通道），客户端把
// 二进制确认写入本地 IndexedDB 后调用 offloadAsset 删除远端对象；
// sweepGeneratedAssets 是兜底——超过 TTL 仍未被认领的生成资产同样
// 清除二进制。元数据行始终保留（节点引用不断链）。用户手动上云
// （source=upload）的资产永不自动清除。

export type OffloadDecision =
  | { action: "offload" }
  | { action: "skip"; reason: "already_offloaded" | "upload_protected" | "downstream_pending" };

export function resolveOffloadPolicy(
  asset: {
    source: string;
    offloadedAt: Date | null;
  },
  downstreamPending = false,
): OffloadDecision {
  if (asset.offloadedAt !== null) return { action: "skip", reason: "already_offloaded" };
  if (asset.source === "upload") return { action: "skip", reason: "upload_protected" };
  if (downstreamPending) return { action: "skip", reason: "downstream_pending" };
  return { action: "offload" };
}

/**
 * 资产生产节点的直接下游消费节点状态（image→video→concat 各一跳）。
 * 管线尚未跑到的下游是 idle，正在跑是 running——这些节点的 job 随时
 * 要从对象存储读这个二进制，删了就是 404。
 */
async function downstreamStatuses(assetId: string): Promise<string[]> {
  const db = getDb();
  const producers = await db
    .select({ id: canvasNodes.id })
    .from(canvasNodes)
    .where(eq(canvasNodes.outputAssetId, assetId));
  if (producers.length === 0) return [];
  const consumers = await db
    .select({ status: canvasNodes.status })
    .from(canvasEdges)
    .innerJoin(canvasNodes, eq(canvasNodes.id, canvasEdges.targetNodeId))
    .where(inArray(canvasEdges.sourceNodeId, producers.map((p) => p.id)));
  return consumers.map((c) => c.status);
}

/** 客户端确认本地落库后，删除远端二进制并记录时间。幂等。 */
export async function offloadAsset(assetId: string) {
  const db = getDb();
  const [asset] = await db
    .select({ source: assets.source, offloadedAt: assets.offloadedAt, storageKey: assets.storageKey })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) {
    throw new Error("input.asset_not_found");
  }

  // 强防护：任何非 done 的下游（含 idle/running/failed/dirty）都保留
  // 二进制——failed 也要保，手动重跑是常态；遗弃链由 TTL 清扫兜底。
  const statuses = await downstreamStatuses(assetId);
  const decision = resolveOffloadPolicy(asset, statuses.some((s) => s !== "done"));
  if (decision.action === "skip") {
    return { asset_id: assetId, offloaded: false, reason: decision.reason };
  }

  await deleteObject(asset.storageKey);
  await db.update(assets).set({ offloadedAt: new Date() }).where(eq(assets.id, assetId));
  return { asset_id: assetId, offloaded: true };
}

/** 找出已本地化（二进制不在云端）的资产 id。 */
export async function findOffloadedAssetIds(assetIds: string[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({ id: assets.id, offloadedAt: assets.offloadedAt })
    .from(assets)
    .where(inArray(assets.id, assetIds));
  return rows.filter((r) => r.offloadedAt !== null).map((r) => r.id);
}

/**
 * 入队前防线：worker 从对象存储读输入二进制，已本地化的资产必须先由
 * 客户端恢复，否则必然 404。抛出 `asset.input_offloaded:<id,...>`，
 * 客户端据此从本地金库回传后重试。
 */
export async function assertAssetsNotOffloaded(assetIds: string[]): Promise<void> {
  const offloaded = await findOffloadedAssetIds(assetIds);
  if (offloaded.length > 0) {
    throw new Error(`asset.input_offloaded:${offloaded.join(",")}`);
  }
}

/**
 * 恢复通行证：签发指向原 storage_key 的直传地址，客户端把本地金库里
 * 的二进制写回原位。返回 upload_url 为 null 表示二进制仍在云端，无需恢复。
 */
export async function requestAssetRestore(assetId: string) {
  const db = getDb();
  const [asset] = await db
    .select({ storageKey: assets.storageKey, mimeType: assets.mimeType, offloadedAt: assets.offloadedAt })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("input.asset_not_found");
  if (asset.offloadedAt === null) {
    return { asset_id: assetId, upload_url: null, mime_type: asset.mimeType };
  }
  const uploadUrl = await createPresignedUploadUrl(asset.storageKey, asset.mimeType);
  return { asset_id: assetId, upload_url: uploadUrl, mime_type: asset.mimeType };
}

/** 回传完成：确认对象已就位并清除 offloaded 标记。幂等。 */
export async function confirmAssetRestore(assetId: string) {
  const db = getDb();
  const [asset] = await db
    .select({ storageKey: assets.storageKey, offloadedAt: assets.offloadedAt })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("input.asset_not_found");
  await headObject(asset.storageKey);
  if (asset.offloadedAt !== null) {
    await db.update(assets).set({ offloadedAt: null }).where(eq(assets.id, assetId));
  }
  return { asset_id: assetId, restored: true };
}

/** TTL 兜底清扫：删除超时未认领的 generated 二进制。返回清除数量。 */
export async function sweepGeneratedAssets(ttlHours: number, batchSize = 500) {
  const db = getDb();
  const cutoff = new Date(Date.now() - ttlHours * 3600 * 1000);
  const stale = await db
    .select({ id: assets.id, storageKey: assets.storageKey })
    .from(assets)
    .where(
      and(
        eq(assets.source, "generated"),
        isNull(assets.offloadedAt),
        lt(assets.createdAt, cutoff),
      ),
    )
    .limit(batchSize);

  let swept = 0;
  for (const asset of stale) {
    // 弱防护：清扫只避让正在执行的下游（超长管线中途不能断粮）；
    // idle/failed 的遗弃链到点即清，不无限占用云端。
    if ((await downstreamStatuses(asset.id)).includes("running")) continue;
    await deleteObject(asset.storageKey);
    const updated = await db
      .update(assets)
      .set({ offloadedAt: sql`now()` })
      .where(and(eq(assets.id, asset.id), isNull(assets.offloadedAt)))
      .returning({ id: assets.id });
    swept += updated.length;
  }
  return { swept, cutoff: cutoff.toISOString() };
}
