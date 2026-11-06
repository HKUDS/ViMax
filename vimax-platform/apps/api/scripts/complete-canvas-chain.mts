// ── 画布补链：storyboard_cell → shot → image → video → concat ────────
// 用法: pnpm --filter @vimax/api exec tsx scripts/complete-canvas-chain.mts [canvas_id]
// 复用画布上已有的 storyboard_cell，走 runStoryboard2Shot（LLM 分解出 shot），
// 再按 pipeline-orchestrator ensureProductionChain 的 legacy 分支补
// image/video/concat 节点与连线，最后逐个 runNode 生成首帧图并等待完成。
// video 只建不跑；可重复执行（已有连线的节点自动跳过）。

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DEFAULT_NEGATIVE_PROMPT } from "@vimax/contracts";
import { getDb } from "../src/infrastructure/db/client.js";
import { canvasEdges, canvasNodes, jobs } from "../src/infrastructure/db/schema.js";
import { runNode, runStoryboard2Shot } from "../src/domain/canvas/node-executor.service.js";
import { config } from "../src/config/env.js";

const CANVAS_ID = process.argv[2];
if (!CANVAS_ID) {
  console.error("用法: pnpm --filter @vimax/api exec tsx scripts/complete-canvas-chain.mts <canvas_id>");
  process.exit(1);
}
const IMAGE_JOB_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 3_000;

type NodeRow = typeof canvasNodes.$inferSelect;

async function outgoingTargets(db: ReturnType<typeof getDb>, nodeId: string, targetType: string) {
  const rows = await db
    .select({ id: canvasNodes.id, type: canvasNodes.type })
    .from(canvasEdges)
    .innerJoin(canvasNodes, eq(canvasNodes.id, canvasEdges.targetNodeId))
    .where(eq(canvasEdges.sourceNodeId, nodeId));
  return rows.filter((r) => r.type === targetType);
}

async function waitForJob(db: ReturnType<typeof getDb>, jobId: string): Promise<string> {
  const deadline = Date.now() + IMAGE_JOB_TIMEOUT_MS;
  for (;;) {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job?.status === "succeeded") return "succeeded";
    if (job?.status === "failed") throw new Error(job.error_message ?? "job failed");
    if (Date.now() > deadline) throw new Error(`job ${jobId} timeout`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function main() {
  const db = getDb();

  // 1) storyboard_cell → shot（跳过已展开的 cell）
  const cells = await db
    .select({ id: canvasNodes.id })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, CANVAS_ID), eq(canvasNodes.type, "storyboard_cell")));
  console.log(`[1] storyboard cells: ${cells.length}`);

  const shots: NodeRow[] = [];
  for (const cell of cells) {
    const existing = await outgoingTargets(db, cell.id, "shot");
    if (existing.length > 0) {
      const [shot] = await db
        .select()
        .from(canvasNodes)
        .where(eq(canvasNodes.id, existing[0]!.id))
        .limit(1);
      shots.push(shot);
      console.log(`    cell ${cell.id} 已有 shot ${shot.id}，跳过`);
      continue;
    }
    const res = await runStoryboard2Shot(CANVAS_ID, cell.id);
    const [shot] = await db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.id, res.shot_node_id))
      .limit(1);
    shots.push(shot);
    console.log(`    shot ${shot.id} ← cell ${cell.id}`);
  }

  // 2) shot → image（首帧图节点，数据结构与 ensureProductionChain 一致）
  const images: NodeRow[] = [];
  for (const shot of shots) {
    const existing = await outgoingTargets(db, shot.id, "image");
    if (existing.length > 0) {
      const [image] = await db
        .select()
        .from(canvasNodes)
        .where(eq(canvasNodes.id, existing[0]!.id))
        .limit(1);
      images.push(image);
      console.log(`[2] shot ${shot.id} 已有 image ${image.id}，跳过`);
      continue;
    }
    const imageId = randomUUID();
    const pos = shot.position as { x: number; y: number };
    const shotData = shot.data as Record<string, unknown>;
    await db.insert(canvasNodes).values({
      id: imageId,
      canvasId: CANVAS_ID,
      type: "image",
      position: { x: pos.x + 300, y: pos.y },
      data: {
        prompt: (shotData.ffDesc as string) || "cinematic frame",
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        modelId: config.defaultImageModelId() || "doubao-seedream-4-0",
        size: "1024x1024",
        status: "idle",
      },
      status: "idle",
    });
    await db.insert(canvasEdges).values({
      id: randomUUID(),
      canvasId: CANVAS_ID,
      sourceNodeId: shot.id,
      targetNodeId: imageId,
      sourceHandle: "first_frame",
      targetHandle: "reference",
    });
    const [image] = await db.select().from(canvasNodes).where(eq(canvasNodes.id, imageId)).limit(1);
    images.push(image);
    console.log(`[2] image ${imageId} ← shot ${shot.id}`);
  }

  // 3) image → video → concat（video 只建不跑）
  const videos: NodeRow[] = [];
  for (const image of images) {
    const existing = await outgoingTargets(db, image.id, "video");
    if (existing.length > 0) {
      const [video] = await db
        .select()
        .from(canvasNodes)
        .where(eq(canvasNodes.id, existing[0]!.id))
        .limit(1);
      videos.push(video);
      continue;
    }
    const videoId = randomUUID();
    const pos = image.position as { x: number; y: number };
    await db.insert(canvasNodes).values({
      id: videoId,
      canvasId: CANVAS_ID,
      type: "video",
      position: { x: pos.x + 300, y: pos.y },
      data: {
        motionPreset: "zoom_in",
        durationSec: 4,
        modelId: config.defaultVideoModelId() || "doubao-seedance-1-0-lite",
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        status: "idle",
      },
      status: "idle",
    });
    await db.insert(canvasEdges).values({
      id: randomUUID(),
      canvasId: CANVAS_ID,
      sourceNodeId: image.id,
      targetNodeId: videoId,
      sourceHandle: "output",
      targetHandle: "first_frame",
    });
    const [video] = await db.select().from(canvasNodes).where(eq(canvasNodes.id, videoId)).limit(1);
    videos.push(video);
    console.log(`[3] video ${videoId} ← image ${image.id}`);
  }

  const [existingConcat] = await db
    .select({ id: canvasNodes.id })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, CANVAS_ID), eq(canvasNodes.type, "concat")))
    .limit(1);
  if (videos.length > 1 && !existingConcat) {
    const concatId = randomUUID();
    const last = videos[videos.length - 1]!;
    const pos = last.position as { x: number; y: number };
    await db.insert(canvasNodes).values({
      id: concatId,
      canvasId: CANVAS_ID,
      type: "concat",
      position: { x: pos.x + 300, y: pos.y },
      data: { transition: "dissolve", status: "idle" },
      status: "idle",
    });
    for (const video of videos) {
      await db.insert(canvasEdges).values({
        id: randomUUID(),
        canvasId: CANVAS_ID,
        sourceNodeId: video.id,
        targetNodeId: concatId,
        sourceHandle: "output",
        targetHandle: "input",
      });
    }
    console.log(`[3] concat ${concatId} ← ${videos.length} videos`);
  }

  // 4) 逐个生成首帧图
  for (const image of images) {
    if (image.outputAssetId) {
      console.log(`[4] image ${image.id} 已有产物，跳过`);
      continue;
    }
    console.log(`[4] run image ${image.id} …`);
    const result = await runNode({ canvas_id: CANVAS_ID, node_id: image.id });
    const status = await waitForJob(db, result.job_id);
    console.log(`    job ${result.job_id} → ${status}`);
  }

  const all = await db
    .select({ type: canvasNodes.type, status: canvasNodes.status, outputAssetId: canvasNodes.outputAssetId })
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, CANVAS_ID));
  const summary = all.reduce<Record<string, number>>((acc, n) => {
    const key = `${n.type}:${n.status}${n.outputAssetId ? "+out" : ""}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log("画布节点汇总:", JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
