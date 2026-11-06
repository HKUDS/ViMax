// ── SKU Service (seed-locked e-commerce product) ─────────────────────

import { randomUUID } from "node:crypto";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { canvasNodes, skuImages, skus } from "../../infrastructure/db/schema.js";
import { getAspectRatioPreset } from "@vimax/contracts";
import { getDefaultModel } from "../model/model.service.js";
import { autoWireCanvas } from "../canvas/canvas.service.js";
import { runNode } from "../canvas/node-executor.service.js";

// ── Node data (pure) ─────────────────────────────────────────────────

export function buildSkuSceneNodeData(input: {
  scene: string;
  aspectRatio?: string;
  referenceAssetIds: string[];
  seed: number;
  modelId: string;
}): Record<string, unknown> {
  const aspect = getAspectRatioPreset(input.aspectRatio) ?? getAspectRatioPreset("sq-1-1")!;
  return {
    prompt: `${input.scene}, professional e-commerce product photography, consistent product identity across shots`,
    kind: "product",
    modelId: input.modelId,
    size: aspect.size,
    aspectRatio: aspect.id,
    referenceAssetIds: input.referenceAssetIds.slice(0, 4),
    seed: input.seed,
    status: "idle",
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

function deriveSeed(): number {
  const hex = randomUUID().replace(/-/g, "").slice(0, 8);
  // int4 上限 2^31-1，掩掉符号位
  return parseInt(hex, 16) & 0x7fffffff;
}

const SKU_ANGLES = ["front", "side", "back", "detail"] as const;

export async function createSku(input: {
  name: string;
  category?: string;
  attributes?: Record<string, unknown>;
  assetIds: string[];
  seed?: number;
}): Promise<{ skuId: string }> {
  const db = getDb();
  const seed = input.seed ?? deriveSeed();
  const [sku] = await db
    .insert(skus)
    .values({
      name: input.name,
      category: input.category ?? null,
      attributes: input.attributes ?? {},
      seed,
    })
    .returning({ id: skus.id });

  if (input.assetIds.length > 0) {
    await db.insert(skuImages).values(
      input.assetIds.map((assetId, i) => ({
        skuId: sku!.id,
        assetId,
        angle: SKU_ANGLES[Math.min(i, SKU_ANGLES.length - 1)],
      })),
    );
  }
  return { skuId: sku!.id };
}

export async function getSku(skuId: string) {
  const db = getDb();
  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return null;
  const images = await db
    .select()
    .from(skuImages)
    .where(eq(skuImages.skuId, skuId))
    .orderBy(skuImages.createdAt);
  return { ...sku, images };
}

export async function listSkus(limit = 50) {
  const db = getDb();
  return db.select().from(skus).orderBy(desc(skus.createdAt)).limit(limit);
}

// ── Scene batch: one image node per scene, seed-locked ───────────────
// Local layout constants mirroring decision-layer's ZONE_LAYOUT image column.

const IMAGE_ZONE_X = 1400;
const IMAGE_ZONE_Y = 60;
const NODE_TITLE_HEIGHT = 36;
const NODE_ROW_HEIGHT = 240;

export async function createSkuSceneBatch(
  canvasId: string,
  skuId: string,
  scenes: string[],
  opts?: { aspectRatio?: string; modelId?: string },
): Promise<{ nodeIds: string[]; seed: number }> {
  const db = getDb();
  const sku = await getSku(skuId);
  if (!sku) throw new Error("ecom.sku_not_found");
  const seed = sku.seed ?? deriveSeed();

  const [existing] = await db
    .select({ cnt: count() })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "image")));

  const modelId = opts?.modelId ?? (await getDefaultModel("default", "image")).id;
  const referenceAssetIds = sku.images
    .map((img) => img.assetId)
    .filter((id): id is string => id !== null);

  const nodeIds: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    const id = randomUUID();
    nodeIds.push(id);
    await db.insert(canvasNodes).values({
      id,
      canvasId,
      type: "image",
      position: {
        x: IMAGE_ZONE_X + 16,
        y: IMAGE_ZONE_Y + NODE_TITLE_HEIGHT + (Number(existing?.cnt ?? 0) + i) * NODE_ROW_HEIGHT,
      },
      data: buildSkuSceneNodeData({
        scene,
        aspectRatio: opts?.aspectRatio,
        referenceAssetIds,
        seed,
        modelId,
      }),
    });
  }

  await autoWireCanvas(canvasId);
  for (const nodeId of nodeIds) {
    await runNode({ canvas_id: canvasId, node_id: nodeId });
  }
  return { nodeIds, seed };
}
