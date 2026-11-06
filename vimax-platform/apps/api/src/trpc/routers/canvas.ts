import { TRPCError } from "@trpc/server";
import {
  CanvasCreateInputSchema,
  CanvasListInputSchema,
  CanvasSaveInputSchema,
  CanvasSnapshotInputSchema,
  CharacterViewRunInputSchema,
  MultiCameraGridInputSchema,
  MotionPredictionInputSchema,
  GridSplitInputSchema,
  StoryPushInputSchema,
  NodeRunBatchInputSchema,
  NodeRunInputSchema,
  NodeStatusInputSchema,
  ExportUrlInputSchema,
  Script2StoryboardInputSchema,
  AutoPipelineInputSchema,
  ScriptAgentActionInputSchema,
  Novel2ScenesInputSchema,
  NodeAgentActionInputSchema,
  CharacterPortraitsInputSchema,
  AdVariantsInputSchema,
  ProductUrlInputSchema,
} from "@vimax/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createCanvas,
  deleteCanvas,
  getCanvasNode,
  getCanvasSnapshot,
  listCanvases,
  saveCanvas,
} from "../../domain/canvas/canvas.service.js";
import {
  runNode,
  runNodeBatch,
  runCharacterView,
  runScript2Storyboard,
  runStoryboard2Shot,
  runMultiCameraGrid,
  runMotionPrediction,
  runGridSplit,
  runStoryPush,
  runAudioGeneration,
  runAllDirty,
  runAllFailed,
  runVariants,
  pickVariant,
  runIdea2Script,
  runPlanScript,
  runEnhanceScript,
  runScript2Characters,
  runNovel2Scenes,
  runSelectReference,
  runSelectBestImage,
  runCameraTree,
  runCharacterPortraits,
  runVoiceover,
} from "../../domain/canvas/node-executor.service.js";
import { runAdVariants } from "../../domain/canvas/ad-variants.js";
import { extractProductFromUrl } from "../../domain/ad/product-url.js";
import {
  WORKFLOW_TEMPLATES,
  getTemplateById,
  instantiateTemplate,
  summarizeTemplate,
} from "../../domain/canvas/workflow-templates.js";
import { inferAutoEdges, subtractEdges } from "../../domain/canvas/canvas-graph.js";
import { startAutoPipeline } from "../../domain/canvas/pipeline-orchestrator.js";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasEdges, canvasNodes, jobs } from "../../infrastructure/db/schema.js";
import { createPresignedDownloadUrl } from "../../infrastructure/storage/s3.js";
import { protectedProcedure, router } from "../trpc.js";

function mapError(err: unknown): never {
  const message = err instanceof Error ? err.message : "internal";
  const codeMap: Record<string, TRPCError["code"]> = {
    "canvas.not_found": "NOT_FOUND",
    "canvas.node_not_found": "NOT_FOUND",
    "canvas.node_type_not_runnable": "BAD_REQUEST",
    "canvas.video_needs_upstream_frames": "BAD_REQUEST",
    "canvas.concat_needs_upstream_videos": "BAD_REQUEST",
    "canvas.character_needs_front_view": "BAD_REQUEST",
    "canvas.script_empty": "BAD_REQUEST",
    "canvas.storyboard_cell_empty": "BAD_REQUEST",
    "canvas.node_needs_output": "BAD_REQUEST",
    "canvas.audio_desc_empty": "BAD_REQUEST",
    "input.unsupported_model": "BAD_REQUEST",
    // prefix match for "canvas.job_in_flight:<job_type>"
    "canvas.job_in_flight": "BAD_REQUEST",
    // prefix match for "pipeline.already_running:<run_id>"
    "pipeline.already_running": "CONFLICT",
    // prefix match for "asset.input_offloaded:<asset_id,...>"
    "asset.input_offloaded": "PRECONDITION_FAILED",
    "provider.invalid_key": "PRECONDITION_FAILED",
  };
  const PREFIXED_KEYS = ["canvas.job_in_flight", "pipeline.already_running", "asset.input_offloaded"];
  const guarded = Object.keys(codeMap).find(
    (key) => message.startsWith(key) && PREFIXED_KEYS.includes(key),
  );
  throw new TRPCError({
    code: (guarded && codeMap[guarded]) || codeMap[message] || "INTERNAL_SERVER_ERROR",
    message,
  });
}

export const canvasRouter = router({
  // ── Canvas CRUD ───────────────────────────────────────────────

  create: protectedProcedure
    .input(CanvasCreateInputSchema)
    .mutation(async ({ input }) => {
      return createCanvas(input);
    }),

  list: protectedProcedure
    .input(CanvasListInputSchema.optional())
    .query(async ({ input }) => {
      return listCanvases(input ?? { limit: 20 });
    }),

  snapshot: protectedProcedure
    .input(CanvasSnapshotInputSchema)
    .query(async ({ input }) => {
      const snapshot = await getCanvasSnapshot(input.canvas_id);
      if (!snapshot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "canvas.not_found" });
      }
      return snapshot;
    }),

  save: protectedProcedure
    .input(CanvasSaveInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await saveCanvas(input);
      } catch (err) {
        mapError(err);
      }
    }),

  delete: protectedProcedure
    .input(CanvasSnapshotInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteCanvas(input.canvas_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Node operations ───────────────────────────────────────────

  runNode: protectedProcedure
    .input(NodeRunInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runNode(input);
      } catch (err) {
        mapError(err);
      }
    }),

  runNodeBatch: protectedProcedure
    .input(NodeRunBatchInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runNodeBatch(input);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Re-run all stale (dirty) nodes ─────────────────────────────

  runDirty: protectedProcedure
    .input(CanvasSnapshotInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runAllDirty(input.canvas_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Retry all failed nodes ─────────────────────────────────────

  retryFailed: protectedProcedure
    .input(CanvasSnapshotInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runAllFailed(input.canvas_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Image variants: generate N, then pick the best ──────────────

  runVariants: protectedProcedure
    .input(
      z.object({
        canvas_id: z.string().uuid(),
        node_id: z.string().uuid(),
        count: z.number().int().min(1).max(12).default(4),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await runVariants(input.canvas_id, input.node_id, input.count);
      } catch (err) {
        mapError(err);
      }
    }),

  pickVariant: protectedProcedure
    .input(
      z.object({
        canvas_id: z.string().uuid(),
        node_id: z.string().uuid(),
        asset_id: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        await pickVariant(input.canvas_id, input.node_id, input.asset_id);
        return { ok: true as const };
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Workflow templates ─────────────────────────────────────────

  listTemplates: protectedProcedure
    .input(z.void().optional())
    .query(() => WORKFLOW_TEMPLATES.map(summarizeTemplate)),

  instantiateTemplate: protectedProcedure
    .input(
      z.object({
        canvas_id: z.string().uuid(),
        template_id: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const template = getTemplateById(input.template_id);
      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "canvas.template_not_found",
        });
      }

      const { nodes, edges } = instantiateTemplate(template);
      const db = getDb();

      if (nodes.length > 0) {
        await db.insert(canvasNodes).values(
          nodes.map((n) => ({
            id: n.id,
            canvasId: input.canvas_id,
            type: n.type,
            position: n.position,
            data: n.data,
          })),
        );
      }
      if (edges.length > 0) {
        await db.insert(canvasEdges).values(
          edges.map((e) => ({
            id: e.id,
            canvasId: input.canvas_id,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null,
          })),
        );
      }

      return { nodes, edges };
    }),

  // ── Auto-wire selected nodes by type dependency ──────────────────

  autoWire: protectedProcedure
    .input(
      z.object({
        canvas_id: z.string().uuid(),
        node_ids: z.array(z.string().uuid()).min(2),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const selected = await db
        .select({ id: canvasNodes.id, type: canvasNodes.type })
        .from(canvasNodes)
        .where(
          and(
            eq(canvasNodes.canvasId, input.canvas_id),
            inArray(canvasNodes.id, input.node_ids),
          ),
        );

      if (selected.length < 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "canvas.autowire_needs_nodes",
        });
      }

      const existing = await db
        .select({
          sourceNodeId: canvasEdges.sourceNodeId,
          targetNodeId: canvasEdges.targetNodeId,
          sourceHandle: canvasEdges.sourceHandle,
          targetHandle: canvasEdges.targetHandle,
        })
        .from(canvasEdges)
        .where(eq(canvasEdges.canvasId, input.canvas_id));

      const inferred = inferAutoEdges(
        selected.map((n) => ({ id: n.id, type: n.type })),
        randomUUID,
        existing,
      );

      const fresh = subtractEdges(inferred, existing);
      if (fresh.length > 0) {
        await db.insert(canvasEdges).values(
          fresh.map((e) => ({
            id: e.id,
            canvasId: input.canvas_id,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
        );
      }

      return {
        created: fresh.map((e) => ({
          id: e.id,
          source: e.sourceNodeId,
          target: e.targetNodeId,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        })),
      };
    }),

  // ── Asset presigned URL (for variant gallery thumbnails) ─────────

  getAssetUrl: protectedProcedure
    .input(z.object({ asset_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [asset] = await db
        .select({
          storageKey: assets.storageKey,
          source: assets.source,
          offloadedAt: assets.offloadedAt,
        })
        .from(assets)
        .where(eq(assets.id, input.asset_id))
        .limit(1);
      if (!asset) return { url: null, source: null, offloaded: false };
      // 二进制已被客户端认领（本地化策略）——不再签发远端 URL
      if (asset.offloadedAt) return { url: null, source: asset.source, offloaded: true };
      const url = await createPresignedDownloadUrl(asset.storageKey);
      return { url, source: asset.source, offloaded: false };
    }),

  // ── Character three-view (三视图) ───────────────────────────────

  runCharacterView: protectedProcedure
    .input(CharacterViewRunInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runCharacterView(input.canvas_id, input.node_id, input.view);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Script-to-Storyboard (剧本转分镜) ───────────────────────────

  runScript2Storyboard: protectedProcedure
    .input(Script2StoryboardInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runScript2Storyboard(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runAutoPipeline: protectedProcedure
    .input(AutoPipelineInputSchema)
    .mutation(async ({ input }) => {
      try {
        const run_id = startAutoPipeline({
          canvas_id: input.canvas_id,
          script_node_id: input.script_node_id,
          concurrency: input.concurrency,
          regenerate: input.regenerate,
        });
        return { run_id };
      } catch (err) {
        mapError(err);
      }
    }),

  // ── ViMax agent bridges (全量 Agent 接入) ────────────────────────

  runIdea2Script: protectedProcedure
    .input(ScriptAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runIdea2Script(input.canvas_id, input.node_id, input.user_requirement);
      } catch (err) {
        mapError(err);
      }
    }),

  runPlanScript: protectedProcedure
    .input(ScriptAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runPlanScript(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runEnhanceScript: protectedProcedure
    .input(ScriptAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runEnhanceScript(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runScript2Characters: protectedProcedure
    .input(ScriptAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runScript2Characters(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runNovel2Scenes: protectedProcedure
    .input(Novel2ScenesInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runNovel2Scenes(
          input.canvas_id,
          input.node_id,
          input.max_events,
          input.max_scenes_per_event,
        );
      } catch (err) {
        mapError(err);
      }
    }),

  runSelectReference: protectedProcedure
    .input(NodeAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runSelectReference(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runSelectBestImage: protectedProcedure
    .input(NodeAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runSelectBestImage(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runCameraTree: protectedProcedure
    .input(ScriptAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runCameraTree(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  runCharacterPortraits: protectedProcedure
    .input(CharacterPortraitsInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runCharacterPortraits(input.canvas_id, input.node_id, input.style);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Voiceover TTS (口播配音) ──────────────────────────────────────

  runVoiceover: protectedProcedure
    .input(NodeAgentActionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runVoiceover(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Ad hook variants (钩子变体批量生成) ───────────────────────────

  runAdVariants: protectedProcedure
    .input(AdVariantsInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runAdVariants(input.canvas_id, input.node_id, {
          hookTypes: input.hook_types,
          count: input.count,
        });
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Product URL extraction (商品链接元数据) ────────────────────────

  extractProduct: protectedProcedure
    .input(ProductUrlInputSchema)
    .query(async ({ input }) => {
      try {
        return await extractProductFromUrl(input.url);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Storyboard cell → Shot (分镜格转镜头) ───────────────────────

  runStoryboard2Shot: protectedProcedure
    .input(NodeRunInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runStoryboard2Shot(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Multi-Camera Grid (多机位宫格) ──────────────────────────────

  runMultiCameraGrid: protectedProcedure
    .input(MultiCameraGridInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runMultiCameraGrid(input.canvas_id, input.node_id, input.grid_size);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Motion Prediction (画面推演) ────────────────────────────────

  runMotionPrediction: protectedProcedure
    .input(MotionPredictionInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runMotionPrediction(input.canvas_id, input.node_id, input.direction, input.seconds);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Grid Split (宫格切分) ───────────────────────────────────────

  runGridSplit: protectedProcedure
    .input(GridSplitInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runGridSplit(input.canvas_id, input.node_id, input.grid_size);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Story Push 4-Grid (剧情推演) ────────────────────────────────

  runStoryPush: protectedProcedure
    .input(StoryPushInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runStoryPush(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Audio Generation (音频生成) ─────────────────────────────────

  runAudioGeneration: protectedProcedure
    .input(NodeRunInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await runAudioGeneration(input.canvas_id, input.node_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Export URL (导出下载链接) ────────────────────────────────────

  getExportUrl: protectedProcedure
    .input(ExportUrlInputSchema)
    .query(async ({ input }) => {
      const node = await getCanvasNode(input.canvas_id, input.node_id);
      if (!node?.outputAssetId) {
        return { download_url: null, filename: null };
      }
      const db = getDb();
      const [asset] = await db
        .select({ storageKey: assets.storageKey, mimeType: assets.mimeType })
        .from(assets)
        .where(eq(assets.id, node.outputAssetId))
        .limit(1);
      if (!asset) return { download_url: null, filename: null };
      const url = await createPresignedDownloadUrl(asset.storageKey);
      const ext = asset.mimeType.split("/")[1] ?? "bin";
      return { download_url: url, filename: `${node.id.slice(0, 8)}.${ext}` };
    }),

  // ── Node status query ─────────────────────────────────────────

  getNodeStatus: protectedProcedure
    .input(NodeStatusInputSchema)
    .query(async ({ input }) => {
      const node = await getCanvasNode(input.canvas_id, input.node_id);
      if (!node) {
        throw new TRPCError({ code: "NOT_FOUND", message: "canvas.node_not_found" });
      }

      const db = getDb();
      const nodeJobs = await db
        .select({
          id: jobs.id,
          status: jobs.status,
          progress: jobs.progress,
          jobType: jobs.jobType,
        })
        .from(jobs)
        .where(
          sql`${jobs.inputSnapshot} -> '_canvas' ->> 'node_id' = ${input.node_id}`,
        )
        .orderBy(desc(jobs.queuedAt))
        .limit(1);

      const latestJob = nodeJobs[0];

      return {
        node_id: node.id,
        status: node.status,
        output_asset_id: node.outputAssetId,
        job_id: latestJob?.id ?? null,
        job_status: latestJob?.status ?? null,
        job_progress: latestJob?.progress ?? null,
      };
    }),
});
