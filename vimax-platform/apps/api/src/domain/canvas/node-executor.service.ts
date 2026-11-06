import { randomUUID } from "node:crypto";
import type {
  ImageJobPayload,
  ImageNodeData,
  ImageSize,
  NodeRunBatchInput,
  NodeRunBatchOutput,
  NodeRunInput,
  NodeRunOutput,
  PipelineJobPayloadValidated,
  PipelineJobType,
  VideoJobPayload,
  CharacterNodeData,
  ShotNodeData,
  StoryboardCellNodeData,
} from "@vimax/contracts";
import { composeImagePrompt, getImageModel, getMotionPreset, getVideoModel, getVideoAspectRatio, getVideoStylePreset, DEFAULT_TTS_MODEL } from "@vimax/contracts";
import { KEY_LIGHT_POSITIONS, RIM_LIGHT_PRESETS, AMBIENT_LIGHT_OPTIONS } from "@vimax/contracts";
import { getDefaultModel, getModelById, getModels } from "../model/model.service.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { config } from "../../config/env.js";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasEdges, canvasNodes, canvases, jobEvents, jobs } from "../../infrastructure/db/schema.js";
import { getRedisQueue, jobEventChannel } from "../../infrastructure/redis/client.js";
import {
  enqueueAudioJob,
  enqueueConcatJob,
  enqueueImageJob,
  enqueuePipelineJob,
  enqueueVideoJob,
} from "../../infrastructure/queue/producer.js";
import { buildStorageKey, getBucket } from "../../infrastructure/storage/s3.js";
import { assertAssetsNotOffloaded } from "../asset/asset-offload.js";
import { currentTrace, currentTraceparent } from "../../infrastructure/observability/trace.js";
import {
  buildImageCacheKey,
  collectReferenceSha256s,
  findCachedJob,
} from "../image/cache.service.js";
import { setNodeStatus, updateNodeDataField, markDownstreamDirty } from "./canvas.service.js";
import {
  normalizeCharacterAssets,
  pickByHandle,
  readyDirtyChildrenOf,
  readyDirtyNodes,
  resolveShotMode,
  resolveUpstreamInputs,
  type EdgeLike,
  type NodeRuntimeLike,
  type UpstreamInput,
} from "./canvas-graph.js";
import { generateText } from "../agent/ai-service.js";
import {
  STORYBOARD_DECOMPOSE_SYSTEM_PROMPT,
  buildDecomposeUserPrompt,
  buildShotNodeData,
  parseDecomposition,
} from "./shot-decompose.js";
import { buildConcatCacheKey, buildVideoCacheKey } from "./cache-keys.js";
import { broadcastNodeStatus } from "./node-status.js";
import { recordFeedback } from "../feedback/feedback.service.js";
import { MAX_VARIANTS } from "./variations.js";
import {
  buildStoryboardUserRequirement,
  mapCanvasCharactersToPayload,
} from "./storyboard-input.js";

// ── Cache-hit fast path ────────────────────────────────────────────
//
// A cached re-run never enqueues a job, so the job-event stream that
// normally drives a node's running → done transition stays silent. Mark
// the node done in the DB and broadcast the transition ourselves, otherwise
// clients stay stuck on "running" relying on a stale SSE replay of the
// original job.
// ── In-flight dedup guard ───────────────────────────────────────────
// One node runs at most one job at a time. A second enqueue for the same
// node while a job is queued/running would double-bill the vendor: both
// jobs generate for real, and neither can hit the content cache because
// the cache record is only written on success. Variant galleries are
// exempt — they intentionally enqueue several jobs for one node.
async function assertNoInFlightNodeJob(
  canvasId: string,
  nodeId: string,
): Promise<void> {
  const [inFlight] = await findInFlightNodeJobs(canvasId, nodeId);
  if (inFlight) {
    throw new Error(`canvas.job_in_flight:${inFlight.jobType}`);
  }
}

/**
 * 节点当前排队/运行中的任务（不含变体任务）。无时间上限——排队数小时
 * 仍是"待执行"，重试应当挂载到它而不是再插一份（否则旧任务稍后执行，
 * 同节点双跑双计费）。worker 崩溃遗留的僵尸行由超时清扫统一收敛。
 */
async function findInFlightNodeJobs(canvasId: string, nodeId: string) {
  const db = getDb();
  return db
    .select({ id: jobs.id, jobType: jobs.jobType, queueName: jobs.queueName })
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, ["queued", "running"]),
        sql`input_snapshot->'_variant' IS NULL`,
        sql`input_snapshot->'_canvas'->>'canvas_id' = ${canvasId}`,
        sql`input_snapshot->'_canvas'->>'node_id' = ${nodeId}`,
      ),
    )
    .orderBy(sql`queued_at desc`)
    .limit(1);
}

async function applyCacheHit(
  node: { canvasId: string; id: string },
  cached: NonNullable<Awaited<ReturnType<typeof findCachedJob>>>,
): Promise<NodeRunOutput> {
  await setNodeStatus(node.canvasId, node.id, "done", cached.outputAssetId);
  broadcastNodeStatus(node.canvasId, node.id, "done", cached.outputAssetId);
  return {
    job_id: cached.id,
    node_id: node.id,
    job_type: cached.jobType,
    queue_name: cached.queueName,
  };
}

// ── Main entry: run a single node ──────────────────────────────────

export async function runNode(input: NodeRunInput): Promise<NodeRunOutput> {
  const db = getDb();

  // 1. Look up the node
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.canvasId, input.canvas_id),
        eq(canvasNodes.id, input.node_id),
      ),
    )
    .limit(1);

  if (!node) throw new Error("canvas.node_not_found");

  // 1.5 已有排队/运行中的任务：重试直接挂载到它（前端订阅既有进度），
  // 不报 job_in_flight、不再插一份重复任务。
  const [inFlight] = await findInFlightNodeJobs(input.canvas_id, input.node_id);
  if (inFlight) {
    await setNodeStatus(input.canvas_id, input.node_id, "running");
    broadcastNodeStatus(input.canvas_id, input.node_id, "running");
    return {
      job_id: inFlight.id,
      node_id: input.node_id,
      job_type: inFlight.jobType,
      queue_name: inFlight.queueName,
    };
  }

  // 2. Collect upstream references from incoming edges (handle-aware).
  const upstream = await collectUpstreamAssets(input.canvas_id, input.node_id);
  const upstreamAssetIds = upstream.map((input2) => input2.assetId);

  // 3. Mark node as running
  await setNodeStatus(input.canvas_id, input.node_id, "running");
  broadcastNodeStatus(input.canvas_id, input.node_id, "running");

  // 4. Dispatch based on node type
  try {
    switch (node.type) {
      case "image":
        return await runImageNode(node, upstreamAssetIds);
      case "character":
        return await runCharacterNode(node, upstreamAssetIds);
      case "shot":
        return await runShotNode(node, upstreamAssetIds);
      case "audio":
        return runAudioNode(node, upstreamAssetIds);
      case "video":
        return await runVideoNode(node, upstream);
      case "concat":
        return await runConcatNode(node, upstreamAssetIds);
      default:
        throw new Error("canvas.node_type_not_runnable");
    }
  } catch (err) {
    // Revert status on failure
    await setNodeStatus(input.canvas_id, input.node_id, "failed");
    broadcastNodeStatus(input.canvas_id, input.node_id, "failed");
    throw err;
  }
}

// ── Batch run ──────────────────────────────────────────────────────

export async function runNodeBatch(
  input: NodeRunBatchInput,
): Promise<NodeRunBatchOutput> {
  const results: Array<{ node_id: string; job_id: string; job_type: string }> =
    [];

  for (const nodeId of input.node_ids) {
    try {
      const result = await runNode({
        canvas_id: input.canvas_id,
        node_id: nodeId,
      });
      results.push({
        node_id: result.node_id,
        job_id: result.job_id,
        job_type: result.job_type,
      });
    } catch {
      // Skip failed nodes in batch — individual errors don't block others
      results.push({
        node_id: nodeId,
        job_id: "",
        job_type: "error",
      });
    }
  }

  return { jobs: results };
}

// ── Subgraph re-run ────────────────────────────────────────────────

/** Load a canvas's node runtime state + edges for readiness checks. */
async function loadCanvasRuntime(canvasId: string): Promise<{
  nodes: Map<string, NodeRuntimeLike>;
  edges: EdgeLike[];
}> {
  const db = getDb();
  const nodeRows = await db
    .select({
      id: canvasNodes.id,
      status: canvasNodes.status,
      type: canvasNodes.type,
    })
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, canvasId));
  const edgeRows = await db
    .select({
      sourceNodeId: canvasEdges.sourceNodeId,
      targetNodeId: canvasEdges.targetNodeId,
      sourceHandle: canvasEdges.sourceHandle,
      targetHandle: canvasEdges.targetHandle,
    })
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));

  const nodes = new Map(
    nodeRows.map((n) => [n.id, { id: n.id, status: n.status, type: n.type }]),
  );
  const edges: EdgeLike[] = edgeRows.map((e) => ({
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));
  return { nodes, edges };
}

/**
 * Reactive cascade: after `completedNodeId` finishes, enqueue every dirty
 * direct child that is now ready (all its runnable upstreams done). The
 * children's own completions re-trigger this, so a single re-run walks the
 * whole affected subgraph without an explicit orchestrator.
 *
 * Returns the ids that were actually enqueued. Failures are logged and do
 * not abort the rest of the cascade.
 */
export async function runReadyDirtyChildren(
  canvasId: string,
  completedNodeId: string,
): Promise<string[]> {
  const { nodes, edges } = await loadCanvasRuntime(canvasId);
  const ready = readyDirtyChildrenOf(edges, nodes, completedNodeId);

  const enqueued: string[] = [];
  for (const nodeId of ready) {
    try {
      await runNode({ canvas_id: canvasId, node_id: nodeId });
      enqueued.push(nodeId);
    } catch (err) {
      console.error(
        `[cascade] failed to run node ${nodeId}:`,
        (err as Error).message,
      );
    }
  }
  return enqueued;
}

/**
 * Manual "re-run all dirty nodes": enqueue every dirty node that is
 * currently ready. Nodes still waiting on an unfinished upstream are
 * reported as `skipped` — they will become eligible as their upstreams
 * complete (and the cascade picks them up).
 */
export async function runAllDirty(
  canvasId: string,
): Promise<{ enqueued: string[]; skipped: string[] }> {
  const { nodes, edges } = await loadCanvasRuntime(canvasId);

  const dirtyIds = [...nodes.values()]
    .filter((n) => n.status === "dirty")
    .map((n) => n.id);
  const ready = readyDirtyNodes(edges, nodes);
  const readySet = new Set(ready);
  const skipped = dirtyIds.filter((id) => !readySet.has(id));

  const enqueued: string[] = [];
  for (const nodeId of ready) {
    try {
      await runNode({ canvas_id: canvasId, node_id: nodeId });
      enqueued.push(nodeId);
    } catch (err) {
      console.error(
        `[runAllDirty] failed to run node ${nodeId}:`,
        (err as Error).message,
      );
    }
  }
  return { enqueued, skipped };
}

/** 一键重跑画布上所有 failed 节点（僵尸 job 由 45 分钟时效防护放行）。 */
export async function runAllFailed(
  canvasId: string,
): Promise<{ enqueued: string[]; skipped: string[] }> {
  const { nodes } = await loadCanvasRuntime(canvasId);
  const failedIds = [...nodes.values()]
    .filter((n) => n.status === "failed")
    .map((n) => n.id);

  const enqueued: string[] = [];
  const skipped: string[] = [];
  for (const nodeId of failedIds) {
    try {
      await runNode({ canvas_id: canvasId, node_id: nodeId });
      enqueued.push(nodeId);
    } catch (err) {
      // 常见拒因：job_in_flight（刚失败还占着窗口）、上游未就绪
      skipped.push(nodeId);
      console.error(
        `[runAllFailed] failed to run node ${nodeId}:`,
        (err as Error).message,
      );
    }
  }
  return { enqueued, skipped };
}

// ── Variants: N independent generations of an image node ───────────

/**
 * Enqueue `count` image jobs for the same node params. Each gets a
 * distinct cache key (so dedup never collapses them) and a `_variant`
 * marker the completion hook reads to gather results into a gallery.
 * Diversity relies on the model's non-determinism across calls.
 */
export async function runVariants(
  canvasId: string,
  nodeId: string,
  count: number,
): Promise<{ jobIds: string[] }> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "image") {
    throw new Error("canvas.variants_need_image_node");
  }

  const data = node.data as ImageNodeData;

  const effectivePrompt = composeImagePrompt(data.prompt, data.scene, data.kind, data.negativePrompt);

  const upstreamAssetIds = await collectUpstreamAssetIds(canvasId, nodeId);
  const refAssetIds = [...upstreamAssetIds, ...(data.referenceAssetIds ?? [])];
  const mode = refAssetIds.length > 0 ? "i2i" : "t2i";
  const model = await resolveImageModelForMode(data.modelId, mode);
  if (mode === "i2i" && !model.supports_reference) {
    throw new Error("input.unsupported_model");
  }
  const modelId = model.id;

  const { sha256s } = await collectReferenceSha256s(refAssetIds);
  const baseCacheKey = buildImageCacheKey({
    mode,
    prompt: effectivePrompt,
    model_id: modelId,
    size: data.size as ImageSize,
    reference_sha256s: sha256s,
  });

  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  await setNodeStatus(canvasId, nodeId, "running");
  broadcastNodeStatus(canvasId, nodeId, "running");

  const n = Math.max(1, Math.min(count, MAX_VARIANTS));
  const jobIds: string[] = [];
  const parentTrace = currentTraceparent();
  const variantsSpan = currentTrace()?.recorder.startSpan("image.enqueue_variants", {
    node_id: nodeId,
    count: n,
  });
  for (let i = 0; i < n; i++) {
    const jobId = randomUUID();
    // Distinct cache key per variant so the dedup layer keeps them apart.
    const cacheKey = `${baseCacheKey}:v${i}:${jobId.slice(0, 8)}`;
    const jobType = mode === "t2i" ? "image.t2i" : "image.i2i";
    const inputSnapshot = {
      mode,
      prompt: effectivePrompt,
      model_id: modelId,
      size: data.size,
      reference_asset_ids: refAssetIds,
      _canvas: { canvas_id: canvasId, node_id: nodeId },
      _variant: { index: i },
    };

    await db.insert(jobs).values({
      id: jobId,
      jobType,
      queueName: "q.image.std",
      bullmqJobId: jobId,
      inputSnapshot,
      cacheKey,
      status: "queued",
    });
    await db.insert(jobEvents).values({
      jobId,
      eventType: "queued",
      payload: { message: `Variant ${i + 1}/${n} queued`, node_id: nodeId },
    });

    await enqueueImageJob({
      job_id: jobId,
      job_type: jobType,
      model_id: modelId,
      credential: {
        class_path: model.class_path,
        api_key: apiKey,
        base_url: model.base_url,
        model: model.model,
      },
      input: {
        prompt: effectivePrompt,
        size: data.size as ImageJobPayload["input"]["size"],
        reference_storage_keys: [],
      },
      callback: {
        event_channel: jobEventChannel(jobId),
        upload_bucket: getBucket(),
        upload_prefix: buildStorageKey("variant", jobId),
      },
      cache_key: cacheKey,
      timeout_ms: 120_000,
      ...(parentTrace ? { traceparent: parentTrace } : {}),
    });
    jobIds.push(jobId);
  }
  variantsSpan?.end();

  return { jobIds };
}

/**
 * Promote one gallery variant to be the node's output, then re-run any
 * stale downstream nodes (same lifecycle as a normal completion).
 */
export async function pickVariant(
  canvasId: string,
  nodeId: string,
  assetId: string,
): Promise<void> {
  await setNodeStatus(canvasId, nodeId, "done", assetId);
  broadcastNodeStatus(canvasId, nodeId, "done", assetId);
  // Implicit positive feedback — the user chose this variant over the rest.
  void recordFeedback({ canvasId, nodeId, assetId, signal: "pick" }).catch(() => {});
  await markDownstreamDirty(canvasId, nodeId);
  await runReadyDirtyChildren(canvasId, nodeId);
}

// ── Upstream asset collection ──────────────────────────────────────
//
// Returns handle-aware inputs so node executors can bind the right asset
// to the right slot (e.g. `first_frame` vs `last_frame`). The flat-id
// helper below is a convenience for nodes that only consume references.

async function collectUpstreamAssets(
  canvasId: string,
  nodeId: string,
): Promise<UpstreamInput[]> {
  const db = getDb();

  const incoming = await db
    .select({
      sourceNodeId: canvasEdges.sourceNodeId,
      sourceHandle: canvasEdges.sourceHandle,
      targetHandle: canvasEdges.targetHandle,
    })
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.canvasId, canvasId),
        eq(canvasEdges.targetNodeId, nodeId),
      ),
    );

  if (incoming.length === 0) return [];

  const sourceIds = incoming.map((e) => e.sourceNodeId);
  const sourceNodes = await db
    .select({
      id: canvasNodes.id,
      type: canvasNodes.type,
      outputAssetId: canvasNodes.outputAssetId,
    })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        inArray(canvasNodes.id, sourceIds),
      ),
    );

  const nodeMap = new Map(
    sourceNodes.map((n) => [n.id, {
      id: n.id,
      type: n.type,
      outputAssetId: n.outputAssetId,
    }]),
  );

  return resolveUpstreamInputs(
    incoming.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: nodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
    nodeMap,
    nodeId,
  );
}

/** Flat list of upstream output asset ids, in edge order. */
async function collectUpstreamAssetIds(
  canvasId: string,
  nodeId: string,
): Promise<string[]> {
  const inputs = await collectUpstreamAssets(canvasId, nodeId);
  return inputs.map((input) => input.assetId);
}

// ── Model resolution helpers ─────────────────────────────────────────
// Try DB-backed model first, fall back to hardcoded contract models.

async function getTenantIdForCanvas(canvasId: string): Promise<string> {
  const db = getDb();
  const [canvas] = await db
    .select({ tenantId: canvases.tenantId })
    .from(canvases)
    .where(eq(canvases.id, canvasId))
    .limit(1);
  return canvas?.tenantId ?? "default";
}

export interface ResolvedImageModel {
  id: string; class_path: string; base_url?: string; model?: string; provider?: string;
  sizes?: string[]; supports_reference?: boolean; api_key?: string;
}

export async function resolveImageModel(modelId?: string): Promise<ResolvedImageModel> {
  let resolved: {
    id: string; class_path?: string; base_url?: string; model?: string; provider?: string;
    sizes?: string[]; supports_reference?: boolean; api_key?: string;
  } | undefined;

  // DEFAULT_IMAGE_MODEL 覆盖“未指定模型”时的默认档（本地免费链路常用）。
  if (!modelId) modelId = config.defaultImageModelId() || undefined;

  // DB lookup first
  if (modelId) {
    const dbModel = await getModelById(modelId);
    if (dbModel) {
      const cfg = dbModel.config as Record<string, unknown>;
      resolved = {
        id: dbModel.id,
        class_path: (dbModel.classPath ?? cfg.class_path ?? (cfg.init_args as Record<string,string>)?.class_path) as string | undefined,
        base_url: (dbModel.baseUrl ?? cfg.base_url ?? (cfg.init_args as Record<string,string>)?.base_url) as string | undefined,
        model: (dbModel.vendorModelId ?? (cfg.init_args as Record<string,string>)?.model) as string | undefined,
        provider: dbModel.provider,
        sizes: cfg.sizes as string[] | undefined,
        supports_reference: cfg.supports_reference as boolean | undefined,
        api_key: dbModel.apiKey ?? undefined,
      };
    } else {
      const hc = getImageModel(modelId);
      if (hc) {
        resolved = {
          id: hc.id, class_path: hc.class_path,
          base_url: hc.init_args?.base_url, model: hc.init_args?.model,
          provider: hc.provider,
          sizes: hc.sizes, supports_reference: hc.supports_reference,
        };
      }
    }
  }

  // Tenant default
  if (!resolved) {
    const def = await getDefaultModel("default", "image");
    const cfg = def.config as Record<string, unknown>;
    resolved = {
      id: def.id,
      class_path: (def.classPath ?? cfg.class_path ?? (cfg.init_args as Record<string,string>)?.class_path) as string | undefined,
      base_url: (def.baseUrl ?? cfg.base_url ?? (cfg.init_args as Record<string,string>)?.base_url) as string | undefined,
      model: (def.vendorModelId ?? (cfg.init_args as Record<string,string>)?.model) as string | undefined,
      provider: def.provider,
      sizes: cfg.sizes as string[] | undefined, supports_reference: cfg.supports_reference as boolean | undefined,
      api_key: def.apiKey ?? undefined,
    };
  }

  // The Python bridge can only route jobs via class_path — fail before enqueue.
  const { class_path, ...rest } = resolved;
  if (!class_path) {
    throw new Error("provider.model_not_configured");
  }
  return { ...rest, class_path };
}

/**
 * Mode-aware image model resolution: an i2i job (references/edit ops) needs a
 * reference-capable model. When the selected/default model lacks the
 * capability, fall back to DEFAULT_I2I_IMAGE_MODEL (free pipeline:
 * cogview-3-flash → modelscope-qwen-image-edit). Returns the original model
 * unchanged when no capable fallback is configured — callers keep their
 * supports_reference guard for the error case.
 */
export async function resolveImageModelForMode(
  modelId: string | undefined,
  mode: "t2i" | "i2i",
  resolve: (id?: string) => Promise<ResolvedImageModel> = resolveImageModel,
): Promise<ResolvedImageModel> {
  const model = await resolve(modelId);
  if (mode !== "i2i" || model.supports_reference) return model;

  const fallbackId = config.defaultI2IImageModelId();
  if (fallbackId && fallbackId !== model.id) {
    const fallback = await resolve(fallbackId);
    if (fallback.supports_reference) {
      return fallback;
    }
  }
  return model;
}

export async function resolveVideoModel(modelId?: string): Promise<{
  id: string; class_path?: string; base_url?: string; model?: string; provider?: string;
  maxDuration?: number; resolutions?: string[]; api_key?: string;
}> {
  // DEFAULT_VIDEO_MODEL 覆盖“未指定模型”时的默认档（本地免费链路常用）。
  if (!modelId) modelId = config.defaultVideoModelId() || undefined;

  if (modelId) {
    const dbModel = await getModelById(modelId);
    if (dbModel) {
      const cfg = dbModel.config as Record<string, unknown>;
      return {
        id: dbModel.id,
        class_path: (dbModel.classPath ?? cfg.class_path ?? (cfg.init_args as Record<string,string>)?.class_path) as string | undefined,
        base_url: (dbModel.baseUrl ?? cfg.base_url ?? (cfg.init_args as Record<string,string>)?.base_url) as string | undefined,
        model: (dbModel.vendorModelId ?? (cfg.init_args as Record<string,string>)?.model) as string | undefined,
        provider: dbModel.provider,
        api_key: dbModel.apiKey ?? undefined,
      };
    }
  }
  if (modelId) {
    const hc = getVideoModel(modelId);
    if (hc) return {
      id: hc.id, class_path: hc.class_path,
      base_url: hc.init_args?.base_url, model: hc.init_args?.model,
      provider: hc.provider,
    };
  }
  const def = await getDefaultModel("default", "video");
  const cfg = def.config as Record<string, unknown>;
  return {
    id: def.id, class_path: (def.classPath ?? cfg.class_path ?? (cfg.init_args as Record<string,string>)?.class_path) as string | undefined,
    base_url: (def.baseUrl ?? cfg.base_url ?? (cfg.init_args as Record<string,string>)?.base_url) as string | undefined,
    model: (def.vendorModelId ?? (cfg.init_args as Record<string,string>)?.model) as string | undefined,
    provider: def.provider,
    api_key: def.apiKey ?? undefined,
  };
}

/**
 * 备用视频模型链：主模型容量类失败（免费档拥堵/限流）时依次降级。
 * 取启用且 key 可解析（DB 内联或 provider env 回退）的其他 video 模型，
 * priority 高的优先，最多 2 个。
 */
export async function resolveVideoFallbackModels(
  primaryId?: string,
  limit = 2,
): Promise<NonNullable<VideoJobPayload["fallback_credentials"]>> {
  try {
    const all = await getModels("default", "video");
    return all
      .filter((m) => m.id !== primaryId)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((m) => {
        const initArgs = ((m.config as Record<string, unknown>).init_args as Record<string, string> | undefined) ?? {};
        return {
          class_path: m.classPath,
          base_url: m.baseUrl ?? initArgs.base_url,
          model: m.vendorModelId ?? initArgs.model,
          api_key: (m.apiKey ?? config.apiKeyFor(m.provider)).trim(),
          label: m.name,
        };
      })
      .filter((c) => c.class_path && c.api_key)
      .slice(0, limit)
      .map((c) => ({
        class_path: c.class_path!,
        api_key: c.api_key,
        base_url: c.base_url,
        model: c.model,
        label: c.label,
      }));
  } catch {
    return [];
  }
}

/**
 * 备用图像模型链：与 resolveVideoFallbackModels 同构。needReference 时
 * 只保留支持参考图的档位（i2i 任务的能力约束）。
 */
export async function resolveImageFallbackModels(
  primaryId?: string,
  needReference = false,
  limit = 2,
): Promise<NonNullable<ImageJobPayload["fallback_credentials"]>> {
  try {
    const all = await getModels("default", "image");
    return all
      .filter((m) => m.id !== primaryId)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((m) => {
        const cfg = m.config as Record<string, unknown>;
        const initArgs = (cfg.init_args as Record<string, string> | undefined) ?? {};
        return {
          class_path: m.classPath,
          base_url: m.baseUrl ?? initArgs.base_url,
          model: m.vendorModelId ?? initArgs.model,
          api_key: (m.apiKey ?? config.apiKeyFor(m.provider)).trim(),
          label: m.name,
          supports_reference: cfg.supports_reference === true,
        };
      })
      .filter((c) => c.class_path && c.api_key && (!needReference || c.supports_reference))
      .slice(0, limit)
      .map((c) => ({
        class_path: c.class_path!,
        api_key: c.api_key,
        base_url: c.base_url,
        model: c.model,
        label: c.label,
      }));
  } catch {
    return [];
  }
}

/** Resolve one asset's storage key (edit/text/compliance operate on it). */
async function getAssetStorageKey(assetId: string): Promise<string> {
  const db = getDb();
  const [asset] = await db
    .select({ storageKey: assets.storageKey, width: assets.width, height: assets.height })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error("input.asset_not_found");
  return asset.storageKey;
}

export async function getAssetSize(assetId: string): Promise<string> {
  const db = getDb();
  const [asset] = await db
    .select({ width: assets.width, height: assets.height })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (asset?.width && asset?.height) return `${asset.width}x${asset.height}`;
  return "1024x1024";
}

/** Shared tail of every image-pipeline job: dedup guard, job row, queue. */
async function dispatchImageJob(
  node: typeof canvasNodes.$inferSelect,
  args: {
    jobType: ImageJobPayload["job_type"];
    payload: Omit<ImageJobPayload, "callback" | "traceparent">;
    inputSnapshot: Record<string, unknown>;
    cacheKey: string;
  },
): Promise<NodeRunOutput> {
  const jobId = args.payload.job_id;
  const queueName = "q.image.std";
  const parentTrace = currentTraceparent();

  // image.text / image.compliance 不调用生成模型，无需备用链；带参考图或
  // 编辑操作的任务降级时也必须落在支持参考图的档位上。
  const needsFallback =
    args.jobType !== "image.text" && args.jobType !== "image.compliance";
  const needReference = Boolean(
    args.payload.input.reference_storage_keys?.length || args.payload.input.source_storage_key,
  );

  const payload: ImageJobPayload = {
    ...args.payload,
    ...(needsFallback
      ? { fallback_credentials: await resolveImageFallbackModels(args.payload.model_id, needReference) }
      : {}),
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    ...(parentTrace ? { traceparent: parentTrace } : {}),
  };

  const db = getDb();
  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId,
    jobType: args.jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot: args.inputSnapshot,
    cacheKey: args.cacheKey,
    status: "queued",
    progress: 0,
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Job queued via canvas node", node_id: node.id },
  });

  const enqueueSpan = currentTrace()?.recorder.startSpan("image.enqueue", {
    job_id: jobId,
    job_type: args.jobType,
    size: args.payload.input.size,
  });
  await enqueueImageJob(payload);
  enqueueSpan?.end();

  return {
    job_id: jobId,
    node_id: node.id,
    job_type: args.jobType,
    queue_name: queueName,
  };
}

async function runImageNode(
  node: typeof canvasNodes.$inferSelect,
  upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  const data = node.data as ImageNodeData;

  // ── Post-processing / analysis jobs operate on an existing image ──
  if (data.compliancePlatforms?.length) return runImageComplianceJob(node, data);
  if (data.textLayers?.length) return runImageTextJob(node, data);
  if (data.editOp) return runImageEditJob(node, data, upstreamAssetIds);

  // E-commerce/creative kind preset augments the prompt (and the cache key).
  const effectivePrompt = composeImagePrompt(data.prompt, data.scene, data.kind, data.negativePrompt);

  // Merge upstream assets with any direct reference assets
  const refAssetIds = [
    ...upstreamAssetIds,
    ...(data.referenceAssetIds ?? []),
  ];

  // Check if i2i mode is needed (implied by having references)
  const mode = refAssetIds.length > 0 ? "i2i" : "t2i";
  const model = await resolveImageModelForMode(data.modelId, mode);
  const modelId = model.id;

  if (mode === "i2i" && !model.supports_reference) {
    throw new Error("input.unsupported_model");
  }

  const { sha256s } = await collectReferenceSha256s(refAssetIds);

  const cacheKey = buildImageCacheKey({
    mode,
    prompt: effectivePrompt,
    model_id: modelId,
    size: data.size,
    reference_sha256s: sha256s,
    ...(data.seed !== undefined ? { seed: data.seed } : {}),
  });

  // Cache hit check
  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  // 真正派发才需要输入二进制（缓存命中不用），已本地化的先让客户端恢复
  await assertAssetsNotOffloaded(refAssetIds);

  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  // Store canvas context in input_snapshot so the completion handler
  // can update the node status and propagate dirty flags. E-commerce
  // kinds opt into the evaluate flywheel (score + at most one refine).
  const inputSnapshot = {
    mode,
    prompt: effectivePrompt,
    model_id: modelId,
    size: data.size,
    reference_asset_ids: refAssetIds,
    ...(["product", "model", "ad"].includes(data.kind ?? "") ? { _evaluate: true } : {}),
    // Canvas context — read by job-event.service on completion
    _canvas: {
      canvas_id: node.canvasId,
      node_id: node.id,
    },
  };

  return dispatchImageJob(node, {
    jobType: mode === "t2i" ? "image.t2i" : "image.i2i",
    cacheKey,
    inputSnapshot,
    payload: {
      job_id: randomUUID(),
      job_type: mode === "t2i" ? "image.t2i" : "image.i2i",
      model_id: modelId,
      credential: {
        class_path: model.class_path,
        api_key: apiKey,
        base_url: model.base_url,
        model: model.model,
      },
      input: {
        prompt: effectivePrompt,
        size: data.size,
        reference_storage_keys: [], // resolved by cache service
        ...(data.seed !== undefined ? { seed: data.seed } : {}),
      },
      cache_key: cacheKey,
      timeout_ms: 120_000,
    },
  });
}

// ── image.edit / image.text / image.compliance（P1 电商后处理） ──────

/** Resolve the operation source: explicit sourceAssetId, else the first
 * upstream/reference asset. Edit-style ops need something to act on. */
async function resolveSourceAssetId(
  data: ImageNodeData,
  upstreamAssetIds: string[],
): Promise<string> {
  const source = data.sourceAssetId
    ?? upstreamAssetIds[0]
    ?? data.referenceAssetIds?.[0];
  if (!source) throw new Error("input.source_asset_required");
  return source;
}

async function runImageEditJob(
  node: typeof canvasNodes.$inferSelect,
  data: ImageNodeData,
  upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  const model = await resolveImageModelForMode(data.modelId, "i2i");
  const modelId = model.id;
  if (!model.supports_reference) throw new Error("input.unsupported_model");

  const sourceId = await resolveSourceAssetId(data, upstreamAssetIds);
  const sourceKey = await getAssetStorageKey(sourceId);
  const maskKey = data.maskAssetId ? await getAssetStorageKey(data.maskAssetId) : undefined;

  const [{ sha256s }, sourceSha] = await Promise.all([
    collectReferenceSha256s(data.referenceAssetIds ?? []),
    collectReferenceSha256s([sourceId]),
  ]);
  const maskSha = data.maskAssetId
    ? (await collectReferenceSha256s([data.maskAssetId])).sha256s[0]
    : undefined;

  const effectivePrompt = composeImagePrompt(data.prompt, data.scene, data.kind, data.negativePrompt);
  const cacheKey = buildImageCacheKey({
    mode: "i2i",
    prompt: effectivePrompt,
    model_id: modelId,
    size: data.size,
    reference_sha256s: sha256s,
    edit_op: data.editOp,
    source_sha256: sourceSha.sha256s[0],
    ...(maskSha ? { mask_sha256: maskSha } : {}),
    ...(data.seed !== undefined ? { seed: data.seed } : {}),
  });

  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  await assertAssetsNotOffloaded([
    sourceId,
    ...(data.maskAssetId ? [data.maskAssetId] : []),
    ...(data.referenceAssetIds ?? []),
  ]);

  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  const inputSnapshot = {
    mode: "i2i",
    edit_op: data.editOp,
    prompt: effectivePrompt,
    model_id: modelId,
    size: data.size,
    source_asset_id: sourceId,
    reference_asset_ids: data.referenceAssetIds ?? [],
    _canvas: { canvas_id: node.canvasId, node_id: node.id },
  };

  return dispatchImageJob(node, {
    jobType: "image.edit",
    cacheKey,
    inputSnapshot,
    payload: {
      job_id: randomUUID(),
      job_type: "image.edit",
      model_id: modelId,
      credential: {
        class_path: model.class_path,
        api_key: apiKey,
        base_url: model.base_url,
        model: model.model,
      },
      input: {
        prompt: effectivePrompt,
        size: data.size,
        reference_storage_keys: [],
        source_storage_key: sourceKey,
        edit_op: data.editOp,
        ...(maskKey ? { mask_storage_key: maskKey } : {}),
        ...(data.seed !== undefined ? { seed: data.seed } : {}),
      },
      cache_key: cacheKey,
      timeout_ms: 120_000,
    },
  });
}

async function runImageTextJob(
  node: typeof canvasNodes.$inferSelect,
  data: ImageNodeData,
): Promise<NodeRunOutput> {
  const sourceId = await resolveSourceAssetId(data, []);
  const sourceKey = await getAssetStorageKey(sourceId);
  const sourceSha = (await collectReferenceSha256s([sourceId])).sha256s[0];
  const size = await getAssetSize(sourceId);

  const cacheKey = buildImageCacheKey({
    mode: "post",
    prompt: "",
    model_id: "pil",
    size,
    reference_sha256s: [],
    source_sha256: sourceSha,
    text_layers: data.textLayers,
  });

  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  await assertAssetsNotOffloaded([sourceId]);

  const inputSnapshot = {
    mode: "post.text",
    size,
    source_asset_id: sourceId,
    _canvas: { canvas_id: node.canvasId, node_id: node.id },
  };

  return dispatchImageJob(node, {
    jobType: "image.text",
    cacheKey,
    inputSnapshot,
    payload: {
      job_id: randomUUID(),
      job_type: "image.text",
      model_id: "pil",
      credential: { class_path: "", api_key: "" },
      input: {
        prompt: "",
        size,
        source_storage_key: sourceKey,
        text_layers: data.textLayers,
      },
      cache_key: cacheKey,
      timeout_ms: 60_000,
    },
  });
}

async function runImageComplianceJob(
  node: typeof canvasNodes.$inferSelect,
  data: ImageNodeData,
): Promise<NodeRunOutput> {
  const sourceId = await resolveSourceAssetId(data, []);
  const sourceKey = await getAssetStorageKey(sourceId);
  const sourceSha = (await collectReferenceSha256s([sourceId])).sha256s[0];
  const size = await getAssetSize(sourceId);

  const cacheKey = buildImageCacheKey({
    mode: "post",
    prompt: "",
    model_id: "compliance",
    size,
    reference_sha256s: [],
    source_sha256: sourceSha,
    compliance_platforms: data.compliancePlatforms,
  });

  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  await assertAssetsNotOffloaded([sourceId]);

  const inputSnapshot = {
    mode: "post.compliance",
    size,
    source_asset_id: sourceId,
    _canvas: { canvas_id: node.canvasId, node_id: node.id },
  };

  return dispatchImageJob(node, {
    jobType: "image.compliance",
    cacheKey,
    inputSnapshot,
    payload: {
      job_id: randomUUID(),
      job_type: "image.compliance",
      model_id: "compliance",
      credential: { class_path: "", api_key: "" },
      input: {
        prompt: "",
        size,
        source_storage_key: sourceKey,
        compliance_platforms: data.compliancePlatforms,
      },
      cache_key: cacheKey,
      timeout_ms: 60_000,
    },
  });
}

// ── Character node executor (MVP: generates front/side/back portraits) ──

async function runCharacterNode(
  node: typeof canvasNodes.$inferSelect,
  _upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  // For MVP, character node generates a portrait using the character
  // description as the prompt. This reuses the image generation pipeline.
  const data = node.data as {
    name?: string;
    description?: string;
    frontAssetId?: string;
  };

  const name = data.name ?? "character";
  const desc = data.description ?? "";
  const prompt = [
    "Character design sheet, full body front view, clean reference",
    name ? `Name: ${name}.` : "",
    desc ? desc : "",
    "white background, professional character reference, high quality, sharp focus",
  ]
    .filter(Boolean)
    .join(", ");

  const tenantId = await getTenantIdForCanvas(node.canvasId);
  const model = await resolveImageModel(undefined); // default image model
  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  // Content-based cache: same character brief → reuse the prior portrait.
  const cacheKey = buildImageCacheKey({
    mode: "t2i",
    prompt,
    model_id: model.id,
    size: "1024x1024",
    reference_sha256s: [],
  });
  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  const jobId = randomUUID();
  const jobType = "character.portrait.front" as const;
  const queueName = "q.image.std";

  const inputSnapshot = {
    mode: "t2i",
    prompt,
    model_id: model.id,
    size: "1024x1024",
    character_name: name,
    _canvas: {
      canvas_id: node.canvasId,
      node_id: node.id,
    },
  };

  const payload: ImageJobPayload = {
    job_id: jobId,
    job_type: jobType,
    model_id: model.id,
    credential: {
      class_path: model.class_path,
      api_key: apiKey,
      base_url: model.base_url,
      model: model.model,
    },
    input: {
      prompt,
      size: "1024x1024",
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: cacheKey,
    timeout_ms: 120_000,
  };

  const db = getDb();
  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey: payload.cache_key,
    status: "queued",
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Character portrait queued", node_id: node.id },
  });

  await enqueueImageJob(payload);

  return {
    job_id: jobId,
    node_id: node.id,
    job_type: jobType,
    queue_name: queueName,
  };
}

// ── Shot node executor (MVP: generates first frame) ────────────────

/** Fetch the portrait asset ids of the characters declared as visible in a
 * shot (visibleCharIds), preferring each character's three-view front
 * portrait. Fed into the first-frame references for cross-shot consistency. */
async function collectVisibleCharAssets(
  canvasId: string,
  visibleCharIds: string[] | undefined,
): Promise<string[]> {
  if (!visibleCharIds?.length) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: canvasNodes.id,
      outputAssetId: canvasNodes.outputAssetId,
      data: canvasNodes.data,
    })
    .from(canvasNodes)
    .where(
      and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, visibleCharIds)),
    );
  return normalizeCharacterAssets(rows);
}

async function runShotNode(
  node: typeof canvasNodes.$inferSelect,
  upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  const data = node.data as ShotNodeData;

  const motion = data.motionDesc ?? "";
  const ffDesc = data.ffDesc ?? "cinematic shot";

  // Visible characters' portraits join the reference set so the first frame
  // keeps the same faces across shots (mirrors idea2video's ff_vis_char_idxs).
  const visibleCharRefs = await collectVisibleCharAssets(node.canvasId, data.visibleCharIds);
  const hasReference = upstreamAssetIds.length > 0 || visibleCharRefs.length > 0;

  // variation_type drives the generation mode (mirrors idea2video): a `large`
  // variation is a bold composition change, so references are discarded and
  // the frame is generated fresh (t2i); `small`/`medium` keep continuity with
  // the upstream reference (i2i) when one is available.
  const { mode, promptSuffix } = resolveShotMode(data.variationType, hasReference);

  // Build lighting prompt part
  const lightingParts: string[] = [];
  if (data.keyLightPosition) {
    const kl = KEY_LIGHT_POSITIONS.find((p) => p.id === data.keyLightPosition);
    if (kl) lightingParts.push(`Key light: ${kl.label} (${kl.id})`);
  }
  if (data.keyLightIntensity != null) lightingParts.push(`intensity ${data.keyLightIntensity}%`);
  if (data.rimLight && data.rimLight !== "none") {
    const rl = RIM_LIGHT_PRESETS.find((p) => p.id === data.rimLight);
    if (rl) lightingParts.push(`Rim light: ${rl.label}`);
  }
  if (data.ambientLight) {
    const al = AMBIENT_LIGHT_OPTIONS.find((o) => o.id === data.ambientLight);
    if (al) lightingParts.push(`Ambient: ${al.label}`);
  }
  const lightingStr = lightingParts.length > 0 ? `. Lighting: ${lightingParts.join(", ")}` : "";

  // Build focus/DOF prompt part
  const focusParts: string[] = [];
  if (data.focusPoint) focusParts.push(`Focus point at (${data.focusPoint.x.toFixed(2)}, ${data.focusPoint.y.toFixed(2)})`);
  if (data.bokehStrength && data.bokehStrength > 0) focusParts.push(`bokeh strength ${data.bokehStrength}, shallow depth of field`);
  const focusStr = focusParts.length > 0 ? `. ${focusParts.join(", ")}` : "";

  const prompt = [
    "Cinematic frame, widescreen 16:9, high production value",
    `Shot description: ${ffDesc}.`,
    motion ? `Camera movement: ${motion}.` : "",
    lightingStr,
    focusStr,
    promptSuffix,
    "professional cinematography, film grade, 4K, sharp focus",
    data.negativePrompt?.trim() ? `Avoid: ${data.negativePrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const model = await resolveImageModelForMode(undefined, mode); // default image model (i2i-capable for reference shots)
  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  // Content-based cache: same shot brief + lighting + references → reuse.
  // Large variations run as t2i, so references no longer feed the model or
  // the cache key.
  const refAssetIds = mode === "i2i" ? [...upstreamAssetIds, ...visibleCharRefs] : [];
  const { sha256s } = await collectReferenceSha256s(refAssetIds);
  const cacheKey = buildImageCacheKey({
    mode,
    prompt,
    model_id: model.id,
    size: "1600x900",
    reference_sha256s: sha256s,
  });
  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  const jobId = randomUUID();
  const jobType = "shot.first_frame" as const;
  const queueName = "q.image.refine";

  const inputSnapshot = {
    mode,
    prompt,
    model_id: model.id,
    size: "1600x900",
    reference_asset_ids: refAssetIds,
    ff_desc: data.ffDesc,
    lf_desc: data.lfDesc,
    motion_desc: data.motionDesc,
    variation_type: data.variationType,
    _canvas: {
      canvas_id: node.canvasId,
      node_id: node.id,
    },
  };

  const payload: ImageJobPayload = {
    job_id: jobId,
    job_type: jobType as ImageJobPayload["job_type"],
    model_id: model.id,
    credential: {
      class_path: model.class_path,
      api_key: apiKey,
      base_url: model.base_url,
      model: model.model,
    },
    input: {
      prompt,
      size: "1600x900",
      reference_storage_keys: [],
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: cacheKey,
    timeout_ms: 120_000,
  };

  const db = getDb();
  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey: payload.cache_key,
    status: "queued",
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Shot frame queued", node_id: node.id },
  });

  await enqueueImageJob(payload);

  return {
    job_id: jobId,
    node_id: node.id,
    job_type: jobType,
    queue_name: queueName,
  };
}

// ── Video node executor ────────────────────────────────────────────
//
// Binds the first/last frame from upstream by target handle
// ("first_frame" / "last_frame"), falling back to an unlabelled "input"
// slot and finally to positional order — so older graphs without handle
// labels keep working.

async function runVideoNode(
  node: typeof canvasNodes.$inferSelect,
  upstream: UpstreamInput[],
): Promise<NodeRunOutput> {
  const firstFrameId =
    pickByHandle(upstream, "first_frame") ??
    upstream.find((i) => i.targetHandle === null || i.targetHandle === "input")?.assetId ??
    upstream[0]?.assetId ??
    null;

  const data = node.data as {
    motionPreset?: string;
    durationSec?: number;
    modelId?: string;
    aspectRatio?: string;
    fps?: number;
    negativePrompt?: string;
    stylePresetId?: string;
  };

  // Copy-driven mode (LibTV parity): the video is driven by the shot's
  // script copy plus the nearest uploaded reference image — no per-shot
  // first-frame generation. Walk one hop up from the direct upstreams to
  // read the shot copy and to find a reference asset when the direct
  // upstream carries no output (a shot in this mode never does).
  const db = getDb();
  let shotDesc = "";
  let referenceAssetId: string | null = null;
  if (firstFrameId == null || upstream.every((i) => !i.assetId)) {
    const sourceRows = await db
      .select({
        id: canvasNodes.id,
        type: canvasNodes.type,
        data: canvasNodes.data,
        outputAssetId: canvasNodes.outputAssetId,
      })
      .from(canvasEdges)
      .innerJoin(canvasNodes, eq(canvasNodes.id, canvasEdges.sourceNodeId))
      .where(eq(canvasEdges.targetNodeId, node.id));

    for (const src of sourceRows) {
      if (src.type === "shot" && !shotDesc) {
        shotDesc = ((src.data as Record<string, unknown>).ffDesc as string) ?? "";
      }
      if (src.type === "image" && src.outputAssetId && !referenceAssetId) {
        referenceAssetId = src.outputAssetId;
      }
    }
    if (!referenceAssetId) {
      const shotIds = sourceRows.filter((s) => s.type === "shot").map((s) => s.id);
      if (shotIds.length > 0) {
        const grandRows = await db
          .select({
            type: canvasNodes.type,
            outputAssetId: canvasNodes.outputAssetId,
          })
          .from(canvasEdges)
          .innerJoin(canvasNodes, eq(canvasNodes.id, canvasEdges.sourceNodeId))
          .where(inArray(canvasEdges.targetNodeId, shotIds));
        referenceAssetId =
          grandRows.find((g) => g.type === "image" && g.outputAssetId)?.outputAssetId ?? null;
      }
    }
  }

  const effectiveFirstFrameId = firstFrameId ?? referenceAssetId;
  if (!effectiveFirstFrameId) {
    throw new Error("canvas.video_needs_upstream_frames");
  }

  const lastFrameId =
    pickByHandle(upstream, "last_frame") ??
    upstream[1]?.assetId ??
    effectiveFirstFrameId;

  // Resolve both frames' storage keys + sha256 in a single query.
  const frameIds = [...new Set([effectiveFirstFrameId, lastFrameId])];
  const frameRows = await db
    .select({ id: assets.id, storageKey: assets.storageKey, sha256: assets.sha256 })
    .from(assets)
    .where(inArray(assets.id, frameIds));
  const storageByKey = new Map(frameRows.map((r) => [r.id, r.storageKey]));
  const shaByKey = new Map(frameRows.map((r) => [r.id, r.sha256]));
  const firstFrameKey = storageByKey.get(effectiveFirstFrameId);
  const lastFrameKey = storageByKey.get(lastFrameId) ?? firstFrameKey;

  // Resolve motion preset label
  const preset = getMotionPreset(data.motionPreset ?? "zoom_in");
  const motionDesc = preset ? `${preset.label}: ${preset.description}` : (data.motionPreset ?? "zoom in");
  // Copy-driven prompt: the shot script copy is the picture description;
  // the reference image keeps the product/character appearance consistent.
  const prompt = [
    "Cinematic video",
    shotDesc ? `Scene: ${shotDesc}` : "",
    `Camera movement: ${motionDesc}`,
    getVideoStylePreset(data.stylePresetId)?.prompt,
    "Keep the subject appearance consistent with the reference image",
    "smooth motion, high quality",
    data.negativePrompt?.trim() ? `Avoid: ${data.negativePrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join(". ");

  // Resolve video model
  const videoModel = await resolveVideoModel(data.modelId);
  const apiKey = videoModel?.api_key ?? config.apiKeyFor(videoModel?.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  // Content-based cache: an identical re-run (same model, prompt, frames,
  // duration, resolution) reuses the prior result instead of re-billing.
  const effectiveModelId = data.modelId ?? "doubao-seedance-1-0-lite";
  const effectiveDurationSec = data.durationSec ?? 5;
  const effectiveAspectRatio = getVideoAspectRatio(data.aspectRatio)?.ratio ?? "16:9";
  const effectiveFps = data.fps ?? 16;
  const cacheKey = buildVideoCacheKey({
    model_id: effectiveModelId,
    prompt,
    first_frame_sha256: shaByKey.get(effectiveFirstFrameId) ?? null,
    last_frame_sha256: shaByKey.get(lastFrameId) ?? null,
    duration_sec: effectiveDurationSec,
    resolution: "720p",
    aspect_ratio: effectiveAspectRatio,
    fps: effectiveFps,
  });

  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  // 真正派发才需要首帧/尾帧二进制（缓存命中不用），已本地化的先让客户端恢复
  await assertAssetsNotOffloaded(frameIds);

  const jobId = randomUUID();
  const jobType = "shot.video" as const;
  const queueName = "q.video.std";

  const inputSnapshot = {
    first_frame_asset_id: firstFrameId,
    last_frame_asset_id: lastFrameId,
    motion_preset: data.motionPreset ?? "zoom_in",
    duration_sec: effectiveDurationSec,
    model_id: effectiveModelId,
    aspect_ratio: effectiveAspectRatio,
    fps: effectiveFps,
    _canvas: {
      canvas_id: node.canvasId,
      node_id: node.id,
    },
  };

  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey,
    status: "queued",
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Video generation queued", node_id: node.id },
  });

  // Enqueue via BullMQ video queue
  const videoPayload: VideoJobPayload = {
    job_id: jobId,
    job_type: jobType,
    model_id: effectiveModelId,
    credential: {
      class_path: videoModel?.class_path ?? "tools.VideoGeneratorDoubaoSeedanceYunwuAPI",
      api_key: apiKey,
      base_url: videoModel?.base_url ?? "https://yunwu.ai/volc/v1",
      model: videoModel?.model ?? "doubao-seedance-1-0-lite-t2v-250428",
    },
    fallback_credentials: await resolveVideoFallbackModels(videoModel?.id),
    input: {
      prompt,
      first_frame_storage_key: firstFrameKey,
      last_frame_storage_key: lastFrameKey,
      duration_sec: effectiveDurationSec,
      resolution: "720p",
      aspect_ratio: effectiveAspectRatio,
      fps: effectiveFps,
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: cacheKey,
    timeout_ms: 300_000,
  };

  await enqueueVideoJob(videoPayload);

  return {
    job_id: jobId,
    node_id: node.id,
    job_type: jobType,
    queue_name: queueName,
  };
}

// ── Concat node executor ───────────────────────────────────────────

/**
 * Per-clip voiceover subtitle text for a concat node, aligned with the
 * upstream asset order (voiceoverText preferred, audioDesc as fallback).
 * Returns undefined when no upstream shot carries any text — the worker
 * then skips the subtitle pass entirely.
 */
async function collectUpstreamSubtitles(
  canvasId: string,
  nodeId: string,
): Promise<Array<string | null> | undefined> {
  const upstream = await collectUpstreamAssets(canvasId, nodeId);
  const sourceIds = [...new Set(upstream.map((input) => input.sourceNodeId))];
  if (sourceIds.length === 0) return undefined;

  const db = getDb();
  const rows = await db
    .select({ id: canvasNodes.id, type: canvasNodes.type, data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, sourceIds)));

  const textByNode = new Map<string, string>();
  for (const row of rows) {
    if (row.type !== "shot") continue;
    const data = row.data as ShotNodeData;
    const text = (data.voiceoverText ?? data.audioDesc ?? "").trim();
    if (text) textByNode.set(row.id, text);
  }

  const subtitles = upstream.map((input) => textByNode.get(input.sourceNodeId) ?? null);
  return subtitles.some(Boolean) ? subtitles : undefined;
}

async function runConcatNode(
  node: typeof canvasNodes.$inferSelect,
  upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  if (upstreamAssetIds.length < 2) {
    throw new Error("canvas.concat_needs_upstream_videos");
  }

  const data = node.data as { transition?: string; burnSubtitles?: boolean };
  const transition = data.transition ?? "default";

  // 口播字幕：opt-in（node.data.burnSubtitles）时，从上游 shot 节点收集
  // 每个片段的口播文案（voiceoverText 优先，回退 audioDesc）。
  let subtitles: Array<string | null> | undefined;
  if (data.burnSubtitles) {
    subtitles = await collectUpstreamSubtitles(node.canvasId, node.id);
  }

  const db = getDb();
  // Resolve every clip's storage key + sha256 in a single query.
  const clipRows = await db
    .select({ id: assets.id, storageKey: assets.storageKey, sha256: assets.sha256 })
    .from(assets)
    .where(inArray(assets.id, upstreamAssetIds));
  const clipById = new Map(clipRows.map((r) => [r.id, r]));
  // Preserve upstream order so the concatenated sequence is deterministic.
  const storageKeys: string[] = [];
  const clipSha256s: string[] = [];
  for (const assetId of upstreamAssetIds) {
    const row = clipById.get(assetId);
    if (row) {
      storageKeys.push(row.storageKey);
      clipSha256s.push(row.sha256);
    }
  }

  if (storageKeys.length < 2) {
    throw new Error("canvas.concat_needs_upstream_videos");
  }

  // Content-based cache: same clips, same order, same transition, same
  // subtitles → reuse. A subtitled concat is a different output.
  const cacheKey = buildConcatCacheKey({ clip_sha256s: clipSha256s, transition, subtitles });
  const cached = await findCachedJob(cacheKey);
  if (cached?.outputAssetId) return applyCacheHit(node, cached);

  await assertAssetsNotOffloaded(upstreamAssetIds);

  const jobId = randomUUID();
  const jobType = "concat.videos";
  const queueName = "q.concat.std";

  const inputSnapshot = {
    upstream_asset_ids: upstreamAssetIds,
    storage_key_count: storageKeys.length,
    transition,
    _canvas: {
      canvas_id: node.canvasId,
      node_id: node.id,
    },
  };

  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey,
    status: "queued",
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Concat job queued", node_id: node.id, clip_count: storageKeys.length },
  });

  await enqueueConcatJob({
    job_id: jobId,
    job_type: "concat.videos",
    input: {
      storage_keys: storageKeys,
      ...(subtitles ? { subtitles } : {}),
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: cacheKey,
    timeout_ms: 120_000,
  });

  return {
    job_id: jobId,
    node_id: node.id,
    job_type: jobType,
    queue_name: queueName,
  };
}

// ── Character View executor (三视图) ───────────────────────────────

export async function runCharacterView(
  canvasId: string,
  nodeId: string,
  view: "front" | "side" | "back",
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new Error("canvas.node_not_found");

  const data = node.data as CharacterNodeData;
  const model = await resolveImageModel(undefined);
  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  const refAssetIds: string[] = [];
  let prompt: string;
  let jobType: string;

  if (view === "front") {
    prompt = [
      "Character design sheet, full body front view, clean reference",
      data.name ? `Name: ${data.name}.` : "",
      data.description ?? "",
      "white background, professional character reference, high quality, sharp focus",
    ].filter(Boolean).join(", ");
    jobType = "character.portrait.front";
  } else {
    if (!data.frontAssetId) throw new Error("canvas.character_needs_front_view");
    refAssetIds.push(data.frontAssetId);
    const viewLabel = view === "side" ? "side view" : "back view";
    prompt = [
      `Character design sheet, full body ${viewLabel}, clean reference`,
      data.name ? `Name: ${data.name}.` : "",
      data.description ?? "",
      `Based on the front-view reference image, ${viewLabel} perspective`,
      "white background, professional character reference, high quality, sharp focus",
    ].filter(Boolean).join(", ");
    jobType = view === "side" ? "character.portrait.side" : "character.portrait.back";
  }

  await collectReferenceSha256s(refAssetIds);
  const jobId = randomUUID();
  const queueName = "q.image.refine";

  const inputSnapshot = {
    mode: refAssetIds.length > 0 ? "i2i" : "t2i",
    prompt,
    model_id: model.id,
    size: "1024x1024",
    reference_asset_ids: refAssetIds,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
    _character_view: view,
  };

  const payload: ImageJobPayload = {
    job_id: jobId,
    job_type: jobType as ImageJobPayload["job_type"],
    model_id: model.id,
    credential: {
      class_path: model.class_path,
      api_key: apiKey,
      base_url: model.base_url,
      model: model.model,
    },
    input: { prompt, size: "1024x1024", reference_storage_keys: [] },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: `canvas:char-${view}:${jobId}`,
    timeout_ms: 120_000,
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: payload.cache_key, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: `Character ${view} view queued`, node_id: nodeId, view },
  });
  await enqueueImageJob(payload);
  await setNodeStatus(canvasId, nodeId, "running");

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Script-to-Storyboard executor (剧本转分镜) ─────────────────────

export async function runScript2Storyboard(
  canvasId: string,
  nodeId: string,
  targetDurationSec?: number,
  userRequirement?: string,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "script") throw new Error("canvas.node_not_found");

  const data = node.data as { content?: string };
  if (!data.content?.trim()) throw new Error("canvas.script_empty");

  const textModel = await getDefaultModel("default", "text");
  const apiKey = textModel.apiKey?.trim();
  if (!apiKey) throw new Error("provider.invalid_key");
  const characterRows = await db
    .select({ type: canvasNodes.type, data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "character")));
  const characters = mapCanvasCharactersToPayload(
    characterRows.map((row) => ({
      type: row.type,
      data: row.data as Record<string, unknown>,
    })),
  );

  const jobId = randomUUID();
  const jobType = "pipeline.script2storyboard";
  const queueName = "q.pipeline.full";

  const inputSnapshot = {
    content: data.content,
    characters,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:s2s:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Script-to-storyboard queued", node_id: nodeId },
  });

  await enqueuePipelineJob({
    job_id: jobId,
    job_type: jobType,
    credential: {
      class_path: "agents.StoryboardArtist",
      api_key: apiKey,
      base_url: textModel.baseUrl ?? undefined,
      model: textModel.vendorModelId ?? textModel.id,
      model_provider: textModel.provider,
    },
    input: {
      content: data.content,
      characters,
      user_requirement: [
        buildStoryboardUserRequirement("script"),
        userRequirement?.trim(),
        targetDurationSec
          ? `The finished video must be exactly ${targetDurationSec} seconds. Plan enough shots for the full duration; assign a sensible duration to each shot, with no individual generated clip longer than 10 seconds.`
          : "",
      ].filter(Boolean).join(" "),
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("pipeline", jobId),
    },
    cache_key: `canvas:s2s:${jobId}`,
    timeout_ms: 120_000,
  });

  await setNodeStatus(canvasId, nodeId, "running");

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Multi-Camera Grid executor (多机位宫格) ─────────────────────────

export async function runMultiCameraGrid(
  canvasId: string,
  nodeId: string,
  gridSize: "3x3" | "5x5",
): Promise<{ jobs: Array<{ node_id: string; job_id: string; job_type: string }> }> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "shot") throw new Error("canvas.node_not_found");

  const data = node.data as ShotNodeData;
  const count = gridSize === "3x3" ? 9 : 25;
  const cols = gridSize === "3x3" ? 3 : 5;
  const model = await resolveImageModel(undefined);
  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  const upstreamAssetIds = await collectUpstreamAssetIds(canvasId, nodeId);
  const results: Array<{ node_id: string; job_id: string; job_type: string }> = [];

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const angleLabel = `camera position row${row + 1} col${col + 1}`;

    const prompt = [
      "Cinematic frame, widescreen 16:9, high production value",
      `Shot description: ${data.ffDesc ?? "cinematic shot"}.`,
      `Multi-camera ${angleLabel}, ${gridSize} grid, variation ${data.variationType ?? "medium"}`,
      "professional cinematography, film grade, 4K",
    ].filter(Boolean).join(" ");

    const imageNodeId = randomUUID();
    await db.insert(canvasNodes).values({
      id: imageNodeId,
      canvasId,
      type: "image",
      position: { x: (node.position as { x: number; y: number }).x + 300 + col * 240, y: (node.position as { x: number; y: number }).y + row * 140 },
      data: { prompt, modelId: model.id, size: "1600x900", status: "idle", _parentShotNodeId: nodeId, _gridIndex: i },
      status: "idle",
    });
    await db.insert(canvasEdges).values({
      id: randomUUID(),
      canvasId,
      sourceNodeId: nodeId,
      targetNodeId: imageNodeId,
      sourceHandle: "multi_camera",
      targetHandle: "reference",
    });

    const jobId = randomUUID();
    const queueName = "q.image.refine";
    const inputSnapshot = {
      mode: upstreamAssetIds.length > 0 ? "i2i" : "t2i",
      prompt, model_id: model.id, size: "1600x900",
      reference_asset_ids: upstreamAssetIds,
      _canvas: { canvas_id: canvasId, node_id: imageNodeId },
    };

    const payload: ImageJobPayload = {
      job_id: jobId,
      job_type: "shot.first_frame" as ImageJobPayload["job_type"],
      model_id: model.id,
      credential: {
        class_path: model.class_path, api_key: apiKey,
        base_url: model.base_url, model: model.model,
      },
      input: { prompt, size: "1600x900", reference_storage_keys: [] },
      callback: {
        event_channel: jobEventChannel(jobId),
        upload_bucket: getBucket(),
        upload_prefix: buildStorageKey("generated", jobId),
      },
      cache_key: `canvas:grid:${jobId}`,
      timeout_ms: 120_000,
    };

    await db.insert(jobs).values({
      id: jobId, jobType: "shot.multi_camera_grid", queueName, bullmqJobId: jobId,
      inputSnapshot, cacheKey: payload.cache_key, status: "queued",
    });
    await db.insert(jobEvents).values({
      jobId, eventType: "queued",
      payload: { message: `Grid camera ${i + 1}/${count} queued`, node_id: imageNodeId },
    });
    await enqueueImageJob(payload);
    results.push({ node_id: imageNodeId, job_id: jobId, job_type: "shot.multi_camera_grid" });
  }

  return { jobs: results };
}

// ── Motion Prediction executor (画面推演) ───────────────────────────

export async function runMotionPrediction(
  canvasId: string,
  nodeId: string,
  direction: "forward" | "backward",
  seconds: number,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || !node.outputAssetId) throw new Error("canvas.node_needs_output");

  // Resolve video model first to get its api_key
  const videoModel = await resolveVideoModel(undefined);
  const apiKey = videoModel?.api_key ?? config.apiKeyFor(videoModel?.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  const videoNodeId = randomUUID();
  const dirLabel = direction === "forward" ? `${seconds}秒后` : `${seconds}秒前`;
  await db.insert(canvasNodes).values({
    id: videoNodeId, canvasId, type: "video",
    position: { x: (node.position as { x: number; y: number }).x + 300, y: (node.position as { x: number; y: number }).y },
    data: {
      motionPreset: "static", durationSec: seconds, modelId: "doubao-seedance-1-0-lite",
      status: "idle", _predictionSource: nodeId, _predictionDirection: direction,
    },
    status: "idle",
  });
  await db.insert(canvasEdges).values({
    id: randomUUID(), canvasId,
    sourceNodeId: nodeId, targetNodeId: videoNodeId,
    sourceHandle: "output", targetHandle: "input",
  });

  const [sourceAsset] = await db
    .select({ storageKey: assets.storageKey })
    .from(assets).where(eq(assets.id, node.outputAssetId)).limit(1);

  const prompt = `Predict what happens ${dirLabel} this scene, smooth temporal transition, cinematic quality`;
  const jobId = randomUUID();
  const jobType = "image.predict_motion";
  const queueName = "q.video.std";

  const inputSnapshot = {
    first_frame_asset_id: node.outputAssetId,
    motion_direction: direction, seconds,
    _canvas: { canvas_id: canvasId, node_id: videoNodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:predict:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: `Motion prediction (${dirLabel}) queued`, node_id: videoNodeId },
  });

  await enqueueVideoJob({
    job_id: jobId, job_type: "shot.video", model_id: "doubao-seedance-1-0-lite",
    credential: {
      class_path: videoModel?.class_path ?? "tools.VideoGeneratorDoubaoSeedanceYunwuAPI",
      api_key: apiKey, base_url: videoModel?.base_url,
    },
    input: { prompt, first_frame_storage_key: sourceAsset?.storageKey, duration_sec: seconds, resolution: "720p" },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(), upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: `canvas:predict:${jobId}`, timeout_ms: 300_000,
  });

  return { job_id: jobId, node_id: videoNodeId, job_type: jobType, queue_name: queueName };
}

// ── Grid Split executor (宫格切分) ─────────────────────────────────

export async function runGridSplit(
  canvasId: string,
  nodeId: string,
  gridSize: "3x3" | "5x5",
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || !node.outputAssetId) throw new Error("canvas.node_needs_output");

  const jobId = randomUUID();
  const jobType = "image.split_grid";
  const queueName = "q.image.std";

  const inputSnapshot = {
    source_asset_id: node.outputAssetId, grid_size: gridSize,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:split:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: `Grid split (${gridSize}) queued`, node_id: nodeId },
  });

  const [sourceAsset] = await db
    .select({ storageKey: assets.storageKey })
    .from(assets).where(eq(assets.id, node.outputAssetId)).limit(1);

  const redis = getRedisQueue();
  await redis.lpush("vimax:queue:q.image.std", JSON.stringify({
    job_id: jobId, job_type: jobType,
    input: { source_storage_key: sourceAsset?.storageKey, grid_size: gridSize, split: true },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(), upload_prefix: buildStorageKey("split", jobId),
    },
    cache_key: `canvas:split:${jobId}`, timeout_ms: 60_000,
  }));

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Story Push 4-Grid executor (剧情推演) ───────────────────────────

export async function runStoryPush(
  canvasId: string,
  nodeId: string,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "shot") throw new Error("canvas.node_not_found");

  const data = node.data as ShotNodeData;
  const textModel = await getDefaultModel("default", "text");
  const apiKey = textModel.apiKey?.trim();
  if (!apiKey) throw new Error("provider.invalid_key");
  const characters = await loadCanvasCharacterPayloads(canvasId);
  const jobId = randomUUID();
  const jobType = "pipeline.story_push";
  const queueName = "q.pipeline.full";

  const inputSnapshot = {
    ff_desc: data.ffDesc, lf_desc: data.lfDesc, motion_desc: data.motionDesc,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:push:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Story push 4-grid queued", node_id: nodeId },
  });

  await enqueuePipelineJob({
    job_id: jobId,
    job_type: jobType,
    credential: {
      class_path: "agents.Screenwriter",
      api_key: apiKey,
      base_url: textModel.baseUrl ?? undefined,
      model: textModel.vendorModelId ?? textModel.id,
      model_provider: textModel.provider,
    },
    input: {
      content: data.ffDesc ?? "",
      characters,
      ff_desc: data.ffDesc ?? "",
      lf_desc: data.lfDesc ?? "",
      motion_desc: data.motionDesc ?? "",
      user_requirement: "Push the story forward with exactly 4 following shots.",
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("pipeline", jobId),
    },
    cache_key: `canvas:push:${jobId}`,
    timeout_ms: 180_000,
  });

  await setNodeStatus(canvasId, nodeId, "running");

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── ViMax agent bridge executors (full agent surface) ───────────────
//
// Every remaining ViMax agent is reachable as one pipeline job. These
// executors share the enqueue boilerplate through `enqueueAgentJob`; the
// completion side (agent-result.ts) maps each JSON result onto canvas state.

type AgentJobInput = PipelineJobPayloadValidated["input"];

/** Primary agent class per bridge job — observability only; the Python
 * pipeline worker dispatches on job_type, not class_path. */
const AGENT_CLASS_PATHS: Record<PipelineJobType, string> = {
  "pipeline.script2storyboard": "agents.StoryboardArtist",
  "pipeline.story_push": "agents.ScriptPlanner",
  "pipeline.idea2script": "agents.Screenwriter",
  "pipeline.script2characters": "agents.CharacterExtractor",
  "pipeline.plan_script": "agents.ScriptPlanner",
  "pipeline.enhance_script": "agents.ScriptEnhancer",
  "pipeline.novel2scenes": "agents.NovelCompressor",
  "pipeline.select_reference": "agents.ReferenceImageSelector",
  "pipeline.select_best_image": "agents.BestImageSelector",
  "pipeline.camera_tree": "agents.CameraImageGenerator",
  "pipeline.character_portraits": "agents.CharacterPortraitsGenerator",
};

async function loadCanvasCharacterPayloads(canvasId: string) {
  const db = getDb();
  const rows = await db
    .select({ type: canvasNodes.type, data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "character")));
  return mapCanvasCharactersToPayload(
    rows.map((row) => ({ type: row.type, data: row.data as Record<string, unknown> })),
  );
}

async function enqueueAgentJob(params: {
  canvasId: string;
  nodeId: string;
  nodeType: string;
  jobType: PipelineJobType;
  input: AgentJobInput;
  cachePrefix: string;
  timeoutMs?: number;
}): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, params.canvasId), eq(canvasNodes.id, params.nodeId)))
    .limit(1);
  if (!node || node.type !== params.nodeType) throw new Error("canvas.node_not_found");

  const textModel = await getDefaultModel("default", "text");
  const apiKey = textModel.apiKey?.trim();
  if (!apiKey) throw new Error("provider.invalid_key");

  const jobId = randomUUID();
  const queueName = "q.pipeline.full";

  await assertNoInFlightNodeJob(params.canvasId, params.nodeId);
  await db.insert(jobs).values({
    id: jobId,
    jobType: params.jobType,
    queueName,
    bullmqJobId: jobId,
    inputSnapshot: { ...params.input, _canvas: { canvas_id: params.canvasId, node_id: params.nodeId } },
    cacheKey: `${params.cachePrefix}:${jobId}`,
    status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: `${params.jobType} queued`, node_id: params.nodeId },
  });

  await enqueuePipelineJob({
    job_id: jobId,
    job_type: params.jobType,
    credential: {
      class_path: AGENT_CLASS_PATHS[params.jobType],
      api_key: apiKey,
      base_url: textModel.baseUrl ?? undefined,
      model: textModel.vendorModelId ?? textModel.id,
      model_provider: textModel.provider,
    },
    input: params.input,
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("pipeline", jobId),
    },
    cache_key: `${params.cachePrefix}:${jobId}`,
    timeout_ms: params.timeoutMs ?? 180_000,
  });

  await setNodeStatus(params.canvasId, params.nodeId, "running");
  broadcastNodeStatus(params.canvasId, params.nodeId, "running");

  return { job_id: jobId, node_id: params.nodeId, job_type: params.jobType, queue_name: queueName };
}

async function loadScriptContent(canvasId: string, nodeId: string): Promise<string> {
  const db = getDb();
  const [node] = await db
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  const content = (node?.data as { content?: string } | undefined)?.content?.trim();
  if (!content) throw new Error("canvas.script_empty");
  return content;
}

/** 创意 → 故事 → 场景剧本（Screenwriter 两段式）。 */
export async function runIdea2Script(
  canvasId: string,
  nodeId: string,
  userRequirement?: string,
): Promise<NodeRunOutput> {
  const content = await loadScriptContent(canvasId, nodeId);
  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.idea2script",
    input: { content, idea: content, user_requirement: userRequirement },
    cachePrefix: "canvas:i2s",
    timeoutMs: 300_000,
  });
}

/** 剧本大纲规划（ScriptPlanner）。 */
export async function runPlanScript(canvasId: string, nodeId: string): Promise<NodeRunOutput> {
  const content = await loadScriptContent(canvasId, nodeId);
  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.plan_script",
    input: { content, idea: content },
    cachePrefix: "canvas:plan",
    timeoutMs: 300_000,
  });
}

/** 剧本连续性润色（ScriptEnhancer）。 */
export async function runEnhanceScript(canvasId: string, nodeId: string): Promise<NodeRunOutput> {
  const content = await loadScriptContent(canvasId, nodeId);
  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.enhance_script",
    input: { content },
    cachePrefix: "canvas:enhance",
    timeoutMs: 300_000,
  });
}

/** 剧本 → 角色清单（CharacterExtractor），完成后展开为角色节点。 */
export async function runScript2Characters(
  canvasId: string,
  nodeId: string,
): Promise<NodeRunOutput> {
  const content = await loadScriptContent(canvasId, nodeId);
  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.script2characters",
    input: { content },
    cachePrefix: "canvas:s2c",
  });
}

/** 小说改编全链（压缩 → 事件 → 场景 → 角色融合）。 */
export async function runNovel2Scenes(
  canvasId: string,
  nodeId: string,
  maxEvents = 3,
  maxScenesPerEvent = 2,
): Promise<NodeRunOutput> {
  const content = await loadScriptContent(canvasId, nodeId);
  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.novel2scenes",
    input: { content, novel_text: content, max_events: maxEvents, max_scenes_per_event: maxScenesPerEvent },
    cachePrefix: "canvas:n2s",
    timeoutMs: 600_000,
  });
}

/** ReferenceImageSelector：为镜头首帧选择角色参考图并构建生成提示词。 */
export async function runSelectReference(canvasId: string, nodeId: string): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select({ type: canvasNodes.type, data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "shot") throw new Error("canvas.node_not_found");

  const data = node.data as ShotNodeData;
  const visibleCharIds = data.visibleCharIds ?? [];
  if (visibleCharIds.length === 0) throw new Error("canvas.character_needs_front_view");

  const charRows = await db
    .select({ id: canvasNodes.id, data: canvasNodes.data, outputAssetId: canvasNodes.outputAssetId })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, visibleCharIds)));

  const refAssetIds = charRows
    .map((row) => {
      const charData = row.data as { frontAssetId?: string };
      return charData.frontAssetId ?? row.outputAssetId;
    })
    .filter((id): id is string => Boolean(id));
  if (refAssetIds.length === 0) throw new Error("canvas.character_needs_front_view");

  const assetRows = await db
    .select({ id: assets.id, storageKey: assets.storageKey })
    .from(assets)
    .where(inArray(assets.id, refAssetIds));
  const keyByAssetId = new Map(assetRows.map((row) => [row.id, row.storageKey]));

  const reference_pairs = charRows
    .map((row) => {
      const charData = row.data as { name?: string; frontAssetId?: string };
      const storageKey = keyByAssetId.get(charData.frontAssetId ?? row.outputAssetId ?? "");
      return storageKey ? { storage_key: storageKey, text: charData.name ?? "" } : null;
    })
    .filter((pair): pair is { storage_key: string; text: string } => pair !== null);

  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "shot",
    jobType: "pipeline.select_reference",
    input: {
      content: data.ffDesc ?? "",
      target_description: data.ffDesc ?? "",
      reference_pairs,
    },
    cachePrefix: "canvas:refsel",
  });
}

/** BestImageSelector：按一致性为多变体图像节点选优。 */
export async function runSelectBestImage(canvasId: string, nodeId: string): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select({ type: canvasNodes.type, data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "image") throw new Error("canvas.node_not_found");

  const data = node.data as { prompt?: string; variants?: Array<{ assetId: string; index: number }> };
  const variants = data.variants ?? [];
  if (variants.length < 2) throw new Error("canvas.variants_empty");

  const assetRows = await db
    .select({ id: assets.id, storageKey: assets.storageKey })
    .from(assets)
    .where(inArray(assets.id, variants.map((v) => v.assetId)));
  const keyByAssetId = new Map(assetRows.map((row) => [row.id, row.storageKey]));

  // Order candidates by variant index so best_index maps back to the gallery.
  const ordered = [...variants].sort((a, b) => a.index - b.index);
  const candidate_storage_keys = ordered
    .map((variant) => keyByAssetId.get(variant.assetId))
    .filter((key): key is string => Boolean(key));
  if (candidate_storage_keys.length < 2) throw new Error("canvas.variants_empty");

  const charRows = await db
    .select({ data: canvasNodes.data, outputAssetId: canvasNodes.outputAssetId })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "character")));
  const reference_pairs = charRows
    .map((row) => {
      const charData = row.data as { name?: string; frontAssetId?: string };
      const storageKey = keyByAssetId.get(charData.frontAssetId ?? row.outputAssetId ?? "");
      return storageKey ? { storage_key: storageKey, text: charData.name ?? "" } : null;
    })
    .filter((pair): pair is { storage_key: string; text: string } => pair !== null);

  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "image",
    jobType: "pipeline.select_best_image",
    input: {
      content: data.prompt ?? "",
      target_description: data.prompt ?? "",
      candidate_storage_keys,
      reference_pairs,
    },
    cachePrefix: "canvas:bestsel",
  });
}

/** CameraImageGenerator.construct_camera_tree：从分镜格构建机位层级。 */
export async function runCameraTree(canvasId: string, nodeId: string): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "script") throw new Error("canvas.node_not_found");

  const cells = await db
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .innerJoin(canvasEdges, eq(canvasEdges.targetNodeId, canvasNodes.id))
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "storyboard_cell"), eq(canvasEdges.sourceNodeId, nodeId)));

  const briefs = cells
    .map((row) => row.data as unknown as StoryboardCellNodeData)
    .filter((cell) => typeof cell.shotBrief === "string");
  if (briefs.length === 0) throw new Error("canvas.storyboard_empty");

  const shot_descs = briefs.map((cell, index) => ({
    idx: index,
    is_last: index === briefs.length - 1,
    cam_idx: cell.cameraIdx,
    visual_desc: cell.shotBrief,
  }));
  const cameraIdxs = [...new Set(briefs.map((cell) => cell.cameraIdx))];
  const cameras = cameraIdxs.map((idx) => ({
    idx,
    active_shot_idxs: briefs
      .map((cell, index) => (cell.cameraIdx === idx ? index : -1))
      .filter((index) => index >= 0),
  }));

  return enqueueAgentJob({
    canvasId,
    nodeId,
    nodeType: "script",
    jobType: "pipeline.camera_tree",
    input: { content: "camera tree", cameras, shot_descs },
    cachePrefix: "canvas:camtree",
  });
}

/** CharacterPortraitsGenerator：三视图一次生成（front → side/back 参考）。 */
export async function runCharacterPortraits(
  canvasId: string,
  nodeId: string,
  style?: string,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "character") throw new Error("canvas.node_not_found");

  const data = node.data as CharacterNodeData;
  if (!data.name?.trim()) throw new Error("canvas.character_empty");

  const imageModel = await resolveImageModel(undefined);
  const apiKey = imageModel.api_key ?? config.apiKeyFor(imageModel.provider);
  if (!apiKey) throw new Error("provider.invalid_key");

  const jobId = randomUUID();
  const jobType = "pipeline.character_portraits";
  const queueName = "q.pipeline.full";

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot: {
      character: { name: data.name, description: data.description ?? "" },
      _canvas: { canvas_id: canvasId, node_id: nodeId },
    },
    cacheKey: `canvas:portraits:${jobId}`,
    status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Character portraits queued", node_id: nodeId },
  });

  await enqueuePipelineJob({
    job_id: jobId,
    job_type: jobType,
    credential: {
      class_path: imageModel.class_path,
      api_key: apiKey,
      base_url: imageModel.base_url,
      model: imageModel.model,
    },
    input: {
      content: data.name,
      character: { name: data.name, description: data.description ?? "" },
      style: style ?? "",
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: `canvas:portraits:${jobId}`,
    timeout_ms: 300_000,
  });

  await setNodeStatus(canvasId, nodeId, "running");
  broadcastNodeStatus(canvasId, nodeId, "running");

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Standalone audio node executor (音效/配乐节点) ───────────────────

async function runAudioNode(
  node: typeof canvasNodes.$inferSelect,
  _upstreamAssetIds: string[],
): Promise<NodeRunOutput> {
  const data = node.data as { prompt?: string };
  if (!data.prompt?.trim()) throw new Error("canvas.audio_desc_empty");

  const db = getDb();
  void db;

  const jobId = randomUUID();
  const jobType = "audio.generate";
  const queueName = "q.audio.std";

  const inputSnapshot = {
    audio_desc: data.prompt,
    _canvas: { canvas_id: node.canvasId, node_id: node.id },
  };

  await assertNoInFlightNodeJob(node.canvasId, node.id);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:audio:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Audio node generation queued", node_id: node.id },
  });

  await enqueueAudioJob({
    job_id: jobId,
    job_type: jobType,
    input: { prompt: data.prompt },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("audio", jobId),
    },
    cache_key: `canvas:audio:${jobId}`,
    timeout_ms: 180_000,
  });

  return { job_id: jobId, node_id: node.id, job_type: jobType, queue_name: queueName };
}

// ── Audio Generation executor (音频生成 MVP) ────────────────────────

export async function runAudioGeneration(
  canvasId: string,
  nodeId: string,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "shot") throw new Error("canvas.node_not_found");

  const data = node.data as ShotNodeData;
  if (!data.audioDesc?.trim()) throw new Error("canvas.audio_desc_empty");

  const jobId = randomUUID();
  const jobType = "audio.generate";
  const queueName = "q.audio.std";

  const inputSnapshot = {
    audio_desc: data.audioDesc,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:audio:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Audio generation queued", node_id: nodeId },
  });

  await enqueueAudioJob({
    job_id: jobId,
    job_type: jobType,
    input: { prompt: data.audioDesc },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("audio", jobId),
    },
    cache_key: `canvas:audio:${jobId}`,
    timeout_ms: 60_000,
  });

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Voiceover TTS executor (口播配音) ────────────────────────────────
//
// Synthesizes the shot's voiceover line (voiceoverText, falling back to
// audioDesc) into an audio asset. Completion attaches it to the shot's
// data.voiceoverAssetId WITHOUT touching outputAssetId or cascading — the
// shot's visual output is unchanged.

export async function runVoiceover(
  canvasId: string,
  nodeId: string,
): Promise<NodeRunOutput> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "shot") throw new Error("canvas.node_not_found");

  const data = node.data as ShotNodeData;
  const text = (data.voiceoverText ?? data.audioDesc ?? "").trim();
  if (!text) throw new Error("canvas.audio_desc_empty");

  const ttsModel = await getDefaultModel("default", "tts");
  const apiKey = ttsModel.apiKey?.trim();
  if (!apiKey) throw new Error("provider.invalid_key");

  const jobId = randomUUID();
  const jobType = "audio.tts";
  const queueName = "q.audio.std";

  const inputSnapshot = {
    voiceover_text: text,
    _voiceover: true,
    _canvas: { canvas_id: canvasId, node_id: nodeId },
  };

  await assertNoInFlightNodeJob(canvasId, nodeId);
  await db.insert(jobs).values({
    id: jobId, jobType, queueName, bullmqJobId: jobId,
    inputSnapshot, cacheKey: `canvas:tts:${jobId}`, status: "queued",
  });
  await db.insert(jobEvents).values({
    jobId, eventType: "queued",
    payload: { message: "Voiceover TTS queued", node_id: nodeId },
  });

  await enqueueAudioJob({
    job_id: jobId,
    job_type: jobType,
    input: {
      prompt: text,
      text,
      voice: (ttsModel.config as Record<string, unknown> | undefined)?.voice as string | undefined,
    },
    credential: {
      class_path: ttsModel.classPath ?? DEFAULT_TTS_MODEL.classPath,
      api_key: apiKey,
      base_url: ttsModel.baseUrl ?? undefined,
      model: ttsModel.vendorModelId ?? undefined,
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("audio", jobId),
    },
    cache_key: `canvas:tts:${jobId}`,
    timeout_ms: 120_000,
  });

  await setNodeStatus(canvasId, nodeId, "running");
  broadcastNodeStatus(canvasId, nodeId, "running");

  return { job_id: jobId, node_id: nodeId, job_type: jobType, queue_name: queueName };
}

// ── Storyboard cell → Shot executor (分镜格转镜头) ──────────────────
//
// Synchronous counterpart to idea2video's decompose_visual_description:
// expand one storyboard cell into a fully-populated shot node. Runs inline
// (the product is a node, not an asset), so it bypasses the job queue and
// the asset-oriented completion hook in job-event.service.

export interface Storyboard2ShotResult {
  shot_node_id: string;
  source_node_id: string;
  edge_id: string;
  /** The freshly-created shot node, so the client can append it to the canvas
   * without a snapshot refetch. */
  shot_node: {
    id: string;
    type: "shot";
    position: { x: number; y: number };
    data: Record<string, unknown>;
  };
  /** The cell → shot edge, same purpose. */
  edge: {
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  };
}

export async function runStoryboard2Shot(
  canvasId: string,
  nodeId: string,
): Promise<Storyboard2ShotResult> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "storyboard_cell") throw new Error("canvas.node_not_found");

  const data = node.data as StoryboardCellNodeData;
  if (!data.shotBrief?.trim()) throw new Error("canvas.storyboard_cell_empty");

  const response = await generateText({
    system: STORYBOARD_DECOMPOSE_SYSTEM_PROMPT,
    prompt: buildDecomposeUserPrompt(data.shotBrief, data.audioDesc),
    temperature: 0.6,
    maxTokens: 2048,
  });

  const decomp = parseDecomposition(response.text);
  if (!decomp) throw new Error("canvas.storyboard_decompose_failed");
  const shotData = buildShotNodeData(decomp);

  const shotNodeId = randomUUID();
  const edgeId = randomUUID();
  const cellPosition = node.position as { x: number; y: number };

  await db.insert(canvasNodes).values({
    id: shotNodeId,
    canvasId,
    type: "shot",
    position: { x: cellPosition.x + 320, y: cellPosition.y },
    data: { ...shotData, status: "idle" },
    status: "idle",
  });
  await db.insert(canvasEdges).values({
    id: edgeId,
    canvasId,
    sourceNodeId: nodeId,
    targetNodeId: shotNodeId,
    sourceHandle: "output",
    targetHandle: "reference",
  });

  // Mark the cell done so the storyboard reads as expanded.
  await setNodeStatus(canvasId, nodeId, "done");
  broadcastNodeStatus(canvasId, nodeId, "done");

  return {
    shot_node_id: shotNodeId,
    source_node_id: nodeId,
    edge_id: edgeId,
    shot_node: {
      id: shotNodeId,
      type: "shot",
      position: { x: cellPosition.x + 320, y: cellPosition.y },
      data: { ...shotData, status: "idle" },
    },
    edge: {
      id: edgeId,
      source: nodeId,
      target: shotNodeId,
      sourceHandle: "output",
      targetHandle: "reference",
    },
  };
}
