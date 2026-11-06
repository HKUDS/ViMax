import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { PipelineStage } from "@vimax/contracts";
import { DEFAULT_NEGATIVE_PROMPT } from "@vimax/contracts";
import { getDb } from "../../infrastructure/db/client.js";
import { config } from "../../config/env.js";
import { canvasEdges, canvasNodes, canvases, jobs } from "../../infrastructure/db/schema.js";
import { broadcastToRoom } from "../../realtime/connection-manager.js";
import { broadcastNodeStatus } from "./node-status.js";
import { setNodeStatus } from "./canvas.service.js";
import { collectDownstreamNodeIds, collectScriptChainNodeIds, inferAutoEdges, subtractEdges } from "./canvas-graph.js";
import {
  runNode,
  runScript2Storyboard,
  runStoryboard2Shot,
  runScript2Characters,
  runCharacterPortraits,
} from "./node-executor.service.js";
import { getDefaultModel } from "../model/model.service.js";

export interface AutoPipelineInput {
  canvas_id: string;
  script_node_id?: string;
  concurrency?: number;
  /** Rebuild from scratch: delete every non-script node before running. */
  regenerate?: boolean;
}

function requestedDurationSec(scriptData: Record<string, unknown>): number | undefined {
  const adBrief = scriptData.adBrief as { durationSec?: unknown } | undefined;
  if (typeof adBrief?.durationSec === "number" && adBrief.durationSec > 0) {
    return Math.round(adBrief.durationSec);
  }
  if (typeof scriptData.durationSec === "number" && scriptData.durationSec > 0) {
    return Math.round(scriptData.durationSec);
  }
  const prompt = typeof scriptData.prompt === "string" ? scriptData.prompt : "";
  const explicit = prompt.match(/(?:时长|duration)[^\d]{0,12}(\d{1,3})\s*(?:秒|s\b|seconds?\b)/i);
  const requested = prompt.match(/(\d{1,3})\s*(?:秒|s\b|seconds?\b)/i);
  const scriptDuration = typeof scriptData.content === "string"
    ? scriptData.content.match(/(?:时长|duration)[^\d]{0,12}(\d{1,3})\s*(?:秒|s\b|seconds?\b)/i)
    : null;
  const match = explicit ?? requested ?? scriptDuration;
  return match ? Number(match[1]) : undefined;
}

function allocateClipDurations(totalSec: number, count: number): number[] {
  if (count === 0 || count * 10 < totalSec) {
    throw new Error(`pipeline.duration_exceeds_clip_capacity:${totalSec}:${count}`);
  }
  const durations = Array.from({ length: count }, () => Math.floor(totalSec / count));
  for (let i = 0; i < totalSec % count; i++) durations[i]!++;
  if (durations.some((duration) => duration < 1 || duration > 10)) {
    throw new Error(`pipeline.invalid_clip_duration:${totalSec}:${count}`);
  }
  return durations;
}

export interface AutoPipelineResult {
  run_id: string;
  succeeded: number;
  failed: number;
  /** 上游未就绪而被跳过的节点（如首帧图失败后的 video）——不是失败。 */
  skipped: number;
  errors: Array<{ stage: PipelineStage; nodeId?: string; error: string }>;
}

const activeRuns = new Map<string, AbortController>();
// 画布级运行锁：同一画布同时只允许一条出片管线，并发点击/重试会因
// 节点在途任务互相碰撞（job_in_flight）而全部失败。
const activeCanvasRuns = new Map<string, string>();

/** 该画布是否已有管线在跑，返回在跑的 runId。 */
export function activePipelineRun(canvasId: string): string | null {
  return activeCanvasRuns.get(canvasId) ?? null;
}

export function cancelAutoPipeline(runId: string): void {
  activeRuns.get(runId)?.abort();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("pipeline.cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("pipeline.cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function failTimedOutJob(jobId: string): Promise<"succeeded" | "failed" | undefined> {
  const db = getDb();
  const [job] = await db.select({ snapshot: jobs.inputSnapshot })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return undefined;
  const [updated] = await db.update(jobs)
    .set({ status: "failed", errorCode: "job.timeout", errorMessage: "任务等待超时，请重试", finishedAt: new Date() })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "running"])))
    .returning({ id: jobs.id });
  if (!updated) {
    const [latest] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return latest?.status === "succeeded" ? "succeeded" : latest?.status === "failed" ? "failed" : undefined;
  }
  const meta = (job.snapshot as { _canvas?: { canvas_id?: string; node_id?: string } } | null)?._canvas;
  if (meta?.canvas_id && meta.node_id) {
    await setNodeStatus(meta.canvas_id, meta.node_id, "failed");
    broadcastNodeStatus(meta.canvas_id, meta.node_id, "failed", null, jobId);
  }
  return "failed";
}

async function waitForJob(
  jobId: string,
  signal?: AbortSignal,
  timeoutMs = 600_000,
): Promise<"succeeded" | "failed"> {
  const db = getDb();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error("pipeline.cancelled");
    const [job] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!job) throw new Error(`pipeline.job_not_found:${jobId}`);
    if (job?.status === "succeeded") return "succeeded";
    if (job?.status === "failed") return "failed";
    await sleep(2000, signal);
  }
  if (await failTimedOutJob(jobId) === "succeeded") return "succeeded";
  throw new Error("pipeline.timeout");
}

function emit(
  canvasId: string,
  runId: string,
  msg: Record<string, unknown>,
): void {
  broadcastToRoom(canvasId, msg as never);
}

async function loadNodes(canvasId: string) {
  const db = getDb();
  return db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, canvasId));
}

async function loadEdges(canvasId: string) {
  const db = getDb();
  return db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));
}

async function ensureProductionChain(canvasId: string, scriptNodeId: string, targetDurationSec?: number): Promise<void> {
  const db = getDb();
  const nodeRows = await loadNodes(canvasId);
  const productionEdgeRows = await loadEdges(canvasId);
  const chainIds = collectScriptChainNodeIds(nodeRows, productionEdgeRows, scriptNodeId);
  const nodes = nodeRows.filter((node) => chainIds.has(node.id));
  const edges = productionEdgeRows.filter((edge) => chainIds.has(edge.sourceNodeId) && chainIds.has(edge.targetNodeId));
  const edgeTargets = new Set(edges.map((e) => e.targetNodeId));

  let imageModelId: string | undefined;
  let videoModelId: string | undefined;
  // DEFAULT_IMAGE_MODEL / DEFAULT_VIDEO_MODEL 优先于 DB 默认（本地免费链路常用）。
  try {
    imageModelId = config.defaultImageModelId() || (await getDefaultModel("default", "image")).id;
  } catch {
    /* optional */
  }
  try {
    videoModelId = config.defaultVideoModelId() || (await getDefaultModel("default", "video")).id;
  } catch {
    /* optional */
  }

  const shots = nodes.filter((n) => n.type === "shot");

  // Copy-driven mode (default for 广告/短剧): no per-shot image generation.
  // Every shot gets a video node fed by (a) the shot copy and (b) the
  // uploaded reference image (an image node carrying referenceAssetIds,
  // whose output IS the uploaded asset). Without a reference image the
  // legacy per-shot image chain is kept as fallback.
  const referenceImage = nodes.find(
    (n) =>
      n.type === "image" &&
      Array.isArray((n.data as Record<string, unknown>).referenceAssetIds) &&
      ((n.data as Record<string, unknown>).referenceAssetIds as unknown[]).length > 0,
  );
  const copyDriven = !!referenceImage;
  const newNodes: typeof nodes = [...nodes];

  if (!copyDriven) {
    for (const shot of shots) {
      const hasImage = edges.some(
        (e) => e.sourceNodeId === shot.id && newNodes.find((n) => n.id === e.targetNodeId)?.type === "image",
      );
      if (!hasImage) {
        const data = shot.data as { ffDesc?: string };
        const imageId = randomUUID();
        const pos = shot.position as { x: number; y: number };
        await db.insert(canvasNodes).values({
          id: imageId,
          canvasId,
          type: "image",
          position: { x: pos.x + 300, y: pos.y },
          data: {
            prompt: data.ffDesc ?? "cinematic frame",
            negativePrompt: DEFAULT_NEGATIVE_PROMPT,
            modelId: imageModelId ?? (config.defaultImageModelId() || "doubao-seedream-4-0"),
            size: "1024x1024",
            status: "idle",
          },
          status: "idle",
        });
        await db.insert(canvasEdges).values({
          id: randomUUID(),
          canvasId,
          sourceNodeId: shot.id,
          targetNodeId: imageId,
          sourceHandle: "first_frame",
          targetHandle: "reference",
        });
        newNodes.push({ id: imageId, type: "image" } as never);
      }
    }
  }

  const refreshedEdges = await loadEdges(canvasId);
  const refreshedNodes = await loadNodes(canvasId);

  if (copyDriven && referenceImage) {
    // video per shot: shot supplies the copy, the reference image supplies
    // the first frame. One reference→video edge, shared by all shots.
    for (const shot of shots) {
      const hasVideo = refreshedEdges.some(
        (e) => e.sourceNodeId === shot.id && refreshedNodes.find((n) => n.id === e.targetNodeId)?.type === "video",
      );
      if (!hasVideo) {
        const videoId = randomUUID();
        const pos = shot.position as { x: number; y: number };
        await db.insert(canvasNodes).values({
          id: videoId,
          canvasId,
          type: "video",
          position: { x: (pos.x as number) + 300, y: pos.y },
          data: {
            motionPreset: "zoom_in",
            durationSec: 4,
            modelId: videoModelId ?? (config.defaultVideoModelId() || "doubao-seedance-1-0-lite"),
            negativePrompt: DEFAULT_NEGATIVE_PROMPT,
            status: "idle",
          },
          status: "idle",
        });
        await db.insert(canvasEdges).values([
          {
            id: randomUUID(),
            canvasId,
            sourceNodeId: shot.id,
            targetNodeId: videoId,
            sourceHandle: null,
            targetHandle: null,
          },
          {
            id: randomUUID(),
            canvasId,
            sourceNodeId: referenceImage.id,
            targetNodeId: videoId,
            sourceHandle: "output",
            targetHandle: "first_frame",
          },
        ]);
        newNodes.push({ id: videoId, type: "video" } as never);
      }
    }
  } else {
    for (const image of refreshedNodes.filter((n) => n.type === "image")) {
      const hasVideo = refreshedEdges.some(
        (e) =>
          e.sourceNodeId === image.id &&
          refreshedNodes.find((n) => n.id === e.targetNodeId)?.type === "video",
      );
      if (!hasVideo) {
        const videoId = randomUUID();
        const pos = image.position as { x: number; y: number };
        await db.insert(canvasNodes).values({
          id: videoId,
          canvasId,
          type: "video",
          position: { x: pos.x + 300, y: pos.y },
          data: {
            motionPreset: "zoom_in",
            durationSec: 4,
            modelId: videoModelId ?? (config.defaultVideoModelId() || "doubao-seedance-1-0-lite"),
            negativePrompt: DEFAULT_NEGATIVE_PROMPT,
            status: "idle",
          },
          status: "idle",
        });
        await db.insert(canvasEdges).values({
          id: randomUUID(),
          canvasId,
          sourceNodeId: image.id,
          targetNodeId: videoId,
          sourceHandle: "output",
          targetHandle: "first_frame",
        });
      }
    }
  }

  const allNodes = await loadNodes(canvasId);
  const edgeRows = await loadEdges(canvasId);
  const scopedIds = collectScriptChainNodeIds(allNodes, edgeRows, scriptNodeId);
  const scopedNodes = allNodes.filter((node) => scopedIds.has(node.id));
  const allEdges = edgeRows.filter((edge) => scopedIds.has(edge.sourceNodeId) && scopedIds.has(edge.targetNodeId));
  const existingEdgeKeys = allEdges.map((e) => ({
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));
  const inferred = inferAutoEdges(
    scopedNodes.map((n) => ({ id: n.id, type: n.type as never })),
    randomUUID,
    existingEdgeKeys,
  );
  const toAdd = subtractEdges(inferred, existingEdgeKeys);
  for (const e of toAdd) {
    await db.insert(canvasEdges).values({
      id: e.id,
      canvasId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    });
  }

  const videos = scopedNodes.filter((n) => n.type === "video");
  if (targetDurationSec !== undefined) {
    const durations = allocateClipDurations(targetDurationSec, videos.length);
    for (const [index, video] of videos.entries()) {
      const data = video.data as Record<string, unknown>;
      await db.update(canvasNodes)
        .set({ data: { ...data, durationSec: durations[index] } })
        .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, video.id)));
    }
  }
  const hasConcat = scopedNodes.some((n) => n.type === "concat");
  if (videos.length > 1 && !hasConcat) {
    const concatId = randomUUID();
    const lastVideo = videos[videos.length - 1]!;
    const pos = lastVideo.position as { x: number; y: number };
    await db.insert(canvasNodes).values({
      id: concatId,
      canvasId,
      type: "concat",
      position: { x: pos.x + 300, y: pos.y },
      data: { transition: "dissolve", status: "idle" },
      status: "idle",
    });
    for (const v of videos) {
      await db.insert(canvasEdges).values({
        id: randomUUID(),
        canvasId,
        sourceNodeId: v.id,
        targetNodeId: concatId,
        sourceHandle: "output",
        targetHandle: "input",
      });
    }
  }

  void edgeTargets;
}

/**
 * Characters stage (best effort): extract the cast from the script via
 * CharacterExtractor, generate each character's three-view portraits via
 * CharacterPortraitsGenerator, then wire every shot's visibleCharIds so
 * first-frame generation feeds the portraits as references (cross-shot
 * character consistency, mirrors idea2video).
 */
async function ensureCharacters(
  canvasId: string,
  scriptNodeId: string,
  runId: string,
  signal: AbortSignal,
  errors: AutoPipelineResult["errors"],
): Promise<void> {
  const db = getDb();
  emit(canvasId, runId, {
    type: "pipeline.stage_start",
    runId,
    canvasId,
    stage: "characters",
    nodeIds: [scriptNodeId],
  });

  try {
    const chainNodes = await loadNodes(canvasId);
    const chainEdges = await loadEdges(canvasId);
    const chainIds = collectScriptChainNodeIds(chainNodes, chainEdges, scriptNodeId);
    let characters = chainNodes.filter((node) => node.type === "character" && chainIds.has(node.id));

    if (characters.length === 0) {
      const job = await runScript2Characters(canvasId, scriptNodeId);
      const status = await waitForJob(job.job_id, signal, 300_000);
      if (status === "failed") throw new Error("script2characters failed");
      const updatedNodes = await loadNodes(canvasId);
      const updatedEdges = await loadEdges(canvasId);
      for (const id of collectScriptChainNodeIds(updatedNodes, updatedEdges, scriptNodeId)) chainIds.add(id);
      characters = updatedNodes.filter((node) => node.type === "character" && chainIds.has(node.id));
    }

    for (const character of characters) {
      const data = character.data as { frontAssetId?: string };
      if (data.frontAssetId) continue;
      const job = await runCharacterPortraits(canvasId, character.id);
      const status = await waitForJob(job.job_id, signal, 300_000);
      if (status === "failed") {
        errors.push({ stage: "characters", nodeId: character.id, error: "portraits failed" });
      }
    }

    const characterIds = (await loadNodes(canvasId))
      .filter((node) => node.type === "character" && chainIds.has(node.id))
      .map((n) => n.id);
    for (const shot of (await loadNodes(canvasId)).filter((node) => node.type === "shot" && chainIds.has(node.id))) {
      const data = shot.data as { visibleCharIds?: string[] };
      if (data.visibleCharIds?.length) continue;
      await db
        .update(canvasNodes)
        .set({ data: { ...data, visibleCharIds: characterIds } })
        .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, shot.id)));
    }
  } catch (err) {
    if (err instanceof Error && err.message === "pipeline.cancelled") throw err;
    errors.push({
      stage: "characters",
      nodeId: scriptNodeId,
      error: err instanceof Error ? err.message : "unknown",
    });
    emit(canvasId, runId, {
      type: "pipeline.node_failed",
      runId,
      canvasId,
      stage: "characters",
      nodeId: scriptNodeId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  emit(canvasId, runId, {
    type: "pipeline.stage_done",
    runId,
    canvasId,
    stage: "characters",
  });
}

async function runNodesInOrder(
  canvasId: string,
  nodeIds: string[],
  concurrency: number,
  runId: string,
  stage: PipelineStage,
  signal?: AbortSignal,
  jobTimeoutMs = 600_000,
): Promise<{ succeeded: number; failed: number; skipped: number; errors: AutoPipelineResult["errors"] }> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const errors: AutoPipelineResult["errors"] = [];
  const queue = [...nodeIds];

  async function runOne(nodeId: string): Promise<void> {
    try {
      const result = await runNode({ canvas_id: canvasId, node_id: nodeId });
      const status = await waitForJob(result.job_id, signal, jobTimeoutMs);
      if (status === "succeeded") succeeded++;
      else {
        failed++;
        errors.push({ stage, nodeId, error: "job failed" });
      }
    } catch (err) {
      // 上游无产物（首帧图失败后的 video、片段缺失后的 concat）在入队前
      // 就同步抛 needs_upstream —— 归类为跳过，不当失败噪音。
      const msg = err instanceof Error ? err.message : "unknown";
      if (msg === "pipeline.cancelled" || signal?.aborted) throw new Error("pipeline.cancelled");
      if (msg.includes("needs_upstream")) {
        skipped++;
        emit(canvasId, runId, {
          type: "pipeline.node_skipped",
          runId,
          canvasId,
          stage,
          nodeId,
          reason: msg,
        });
        return;
      }
      failed++;
      errors.push({ stage, nodeId, error: msg });
    }
  }

  emit(canvasId, runId, {
    type: "pipeline.stage_start",
    runId,
    canvasId,
    stage,
    nodeIds,
  });

  let done = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const nodeId = queue.shift();
      if (!nodeId) break;
      await runOne(nodeId);
      done++;
      emit(canvasId, runId, {
        type: "pipeline.stage_progress",
        runId,
        canvasId,
        stage,
        done,
        total: nodeIds.length,
      });
    }
  });
  await Promise.all(workers);

  emit(canvasId, runId, {
    type: "pipeline.stage_done",
    runId,
    canvasId,
    stage,
  });

  return { succeeded, failed, skipped, errors };
}

/**
 * Regeneration starts from a clean slate: script2storyboard always INSERTS
 * new storyboard cells (persistStoryboardSpawn), so re-running without
 * deleting the old chain would duplicate every node.
 */
async function clearGeneratedNodes(canvasId: string, scriptNodeId: string): Promise<void> {
  const db = getDb();
  const nodes = await loadNodes(canvasId);
  const edges = await loadEdges(canvasId);
  const descendants = new Set(collectDownstreamNodeIds(edges, scriptNodeId));
  const removedIds = nodes
    .filter((node) => {
      if (!descendants.has(node.id)) return false;
      const data = node.data as Record<string, unknown>;
      return !(node.type === "image" && Array.isArray(data.referenceAssetIds) && data.referenceAssetIds.length > 0);
    })
    .map((n) => n.id);
  if (removedIds.length === 0) return;
  // canvas_edges rows cascade-delete with their endpoints.
  await db.delete(canvasNodes).where(inArray(canvasNodes.id, removedIds));
  await db.update(canvases).set({ updatedAt: new Date() }).where(eq(canvases.id, canvasId));
  broadcastToRoom(canvasId, {
    type: "canvas.nodes_removed",
    canvasId,
    nodeIds: removedIds,
  });
}

export async function runAutoPipelineAsync(
  runId: string,
  input: AutoPipelineInput,
): Promise<AutoPipelineResult> {
  const ac = new AbortController();
  activeRuns.set(runId, ac);
  activeCanvasRuns.set(input.canvas_id, runId);
  const signal = ac.signal;
  const concurrency = input.concurrency ?? 2;
  const errors: AutoPipelineResult["errors"] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const db = getDb();
    const { canvas_id: canvasId } = input;

    let scriptNodeId = input.script_node_id;
    if (!scriptNodeId) {
      const scripts = await db
        .select({ id: canvasNodes.id })
        .from(canvasNodes)
        .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "script")))
        .limit(1);
      scriptNodeId = scripts[0]?.id;
    }
    if (!scriptNodeId) throw new Error("canvas.script_not_found");
    const script = (await loadNodes(canvasId)).find((node) => node.id === scriptNodeId && node.type === "script");
    if (!script) throw new Error("canvas.script_not_found");
    if (input.regenerate) await clearGeneratedNodes(canvasId, scriptNodeId);

    emit(canvasId, runId, {
      type: "pipeline.stage_start",
      runId,
      canvasId,
      stage: "storyboard",
      nodeIds: [scriptNodeId],
    });

    const targetDurationSec = requestedDurationSec(script.data as Record<string, unknown>);
    const scriptData = script.data as Record<string, unknown>;
    const adBrief = scriptData.adBrief as Record<string, unknown> | undefined;
    const userRequirement = [
      typeof scriptData.prompt === "string" ? scriptData.prompt : "",
      typeof adBrief?.audience === "string" ? `Target audience: ${adBrief.audience}` : "",
      typeof adBrief?.style === "string" ? `Visual style: ${adBrief.style}` : "",
    ].filter(Boolean).join("\n");
    const s2s = await runScript2Storyboard(canvasId, scriptNodeId, targetDurationSec, userRequirement);
    const s2sStatus = await waitForJob(s2s.job_id, signal);
    if (s2sStatus === "failed") {
      failed++;
      errors.push({ stage: "storyboard", nodeId: scriptNodeId, error: "script2storyboard failed" });
      throw new Error("storyboard stage failed");
    }
    succeeded++;
    emit(canvasId, runId, {
      type: "pipeline.stage_done",
      runId,
      canvasId,
      stage: "storyboard",
    });

    await ensureCharacters(canvasId, scriptNodeId, runId, signal, errors);

    const storyboardNodes = await loadNodes(canvasId);
    const storyboardEdges = await loadEdges(canvasId);
    const scriptChainIds = new Set(collectDownstreamNodeIds(storyboardEdges, scriptNodeId));
    const cells = storyboardNodes.filter((node) => node.type === "storyboard_cell" && scriptChainIds.has(node.id));
    emit(canvasId, runId, {
      type: "pipeline.stage_start",
      runId,
      canvasId,
      stage: "shot",
      nodeIds: cells.map((c) => c.id),
    });

    let shotDone = 0;
    for (const cell of cells) {
      if (signal.aborted) throw new Error("pipeline.cancelled");
      try {
        await runStoryboard2Shot(canvasId, cell.id);
        succeeded++;
      } catch (err) {
        failed++;
        errors.push({
          stage: "shot",
          nodeId: cell.id,
          error: err instanceof Error ? err.message : "unknown",
        });
        emit(canvasId, runId, {
          type: "pipeline.node_failed",
          runId,
          canvasId,
          stage: "shot",
          nodeId: cell.id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
      shotDone++;
      emit(canvasId, runId, {
        type: "pipeline.stage_progress",
        runId,
        canvasId,
        stage: "shot",
        done: shotDone,
        total: cells.length,
      });
    }
    emit(canvasId, runId, { type: "pipeline.stage_done", runId, canvasId, stage: "shot" });

    await ensureProductionChain(canvasId, scriptNodeId, targetDurationSec);

    const productionNodes = await loadNodes(canvasId);
    const productionEdges = await loadEdges(canvasId);
    const productionIds = collectScriptChainNodeIds(productionNodes, productionEdges, scriptNodeId);
    const allNodes = productionNodes.filter((node) => productionIds.has(node.id));
    // Copy-driven mode: shots carry only copy (no first-frame jobs) and
    // reference images are already-done asset containers — neither runs.
    const isReferenceImage = (n: (typeof allNodes)[number]) =>
      n.type === "image" &&
      Array.isArray((n.data as Record<string, unknown>).referenceAssetIds) &&
      ((n.data as Record<string, unknown>).referenceAssetIds as unknown[]).length > 0;
    const images = allNodes
      .filter((n) => n.type === "image" && !isReferenceImage(n))
      .map((n) => n.id);
    const videos = allNodes.filter((n) => n.type === "video").map((n) => n.id);
    const concats = allNodes.filter((n) => n.type === "concat").map((n) => n.id);

    // 免费视频档偶发排队/重提，单个视频 job 的等待上限远大于图片。
    const VIDEO_JOB_TIMEOUT_MS = 1_800_000;
    const stages: Array<[PipelineStage, string[], number]> = [
      ["image", images, 600_000],
      ["video", videos, VIDEO_JOB_TIMEOUT_MS],
    ];
    if (concats.length > 0 && videos.length > 1) {
      stages.push(["concat", concats, 600_000]);
    }

    let videoFailures = false;
    for (const [stage, ids, jobTimeoutMs] of stages) {
      if (stage === "concat" && videoFailures) {
        skipped += ids.length;
        for (const nodeId of ids) {
          emit(canvasId, runId, {
            type: "pipeline.node_skipped",
            runId,
            canvasId,
            stage,
            nodeId,
            reason: "video_stage_incomplete",
          });
        }
        continue;
      }
      if (ids.length === 0) continue;
      const result = await runNodesInOrder(
        canvasId,
        ids,
        concurrency,
        runId,
        stage,
        signal,
        jobTimeoutMs,
      );
      succeeded += result.succeeded;
      failed += result.failed;
      skipped += result.skipped;
      errors.push(...result.errors);
      if (stage === "video" && (result.failed > 0 || result.skipped > 0)) videoFailures = true;
    }

    const summary = {
      succeeded,
      failed,
      skipped,
      message: buildPipelineSummaryMessage({ succeeded, failed, skipped }),
    };
    emit(canvasId, runId, {
      type: "pipeline.finished",
      runId,
      canvasId,
      summary,
    });
    return { run_id: runId, succeeded, failed, skipped, errors };
  } catch (err) {
    // 无论取消还是中途崩溃，都必须给客户端发结束事件——否则前端管线
    // 状态永远停在"running"，按钮转圈到天荒地老。
    const cancelled = err instanceof Error && err.message === "pipeline.cancelled";
    const message = cancelled
      ? buildPipelineSummaryMessage({ succeeded, failed, skipped, cancelled: true })
      : `出片中断：${err instanceof Error ? err.message : "未知错误"}`;
    emit(input.canvas_id, runId, {
      type: "pipeline.finished",
      runId,
      canvasId: input.canvas_id,
      summary: {
        succeeded,
        failed,
        skipped,
        cancelled,
        message,
      },
    });
    throw err;
  } finally {
    activeRuns.delete(runId);
    if (activeCanvasRuns.get(input.canvas_id) === runId) {
      activeCanvasRuns.delete(input.canvas_id);
    }
  }
}

/** 管线结束的用户可读摘要：成功 congratulation / 失败给行动指引。 */
function buildPipelineSummaryMessage(s: {
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled?: boolean;
}): string {
  if (s.cancelled) return `已停止：完成 ${s.succeeded} 项，失败 ${s.failed} 项。`;
  if (s.failed === 0 && s.skipped === 0) {
    return `全部 ${s.succeeded} 项生成完成 🎉`;
  }
  const parts = [`完成 ${s.succeeded} 项`];
  if (s.failed > 0) parts.push(`失败 ${s.failed} 项`);
  if (s.skipped > 0) parts.push(`跳过 ${s.skipped} 项（上游未就绪）`);
  return (
    `${parts.join("，")}。失败/跳过的节点已保留在画布上，可点「重试失败项」重跑；` +
    `若为免费视频模型容量不足（1305），建议在「设置 → 模型配置」添加备用视频模型，` +
    `之后系统会在容量失败时自动切换。`
  );
}

export function startAutoPipeline(input: AutoPipelineInput): string {
  const existing = activePipelineRun(input.canvas_id);
  if (existing) {
    throw new Error(`pipeline.already_running:${existing}`);
  }
  const runId = randomUUID();
  void runAutoPipelineAsync(runId, input).catch((err) => {
    console.error("[pipeline] run failed:", err);
  });
  return runId;
}
