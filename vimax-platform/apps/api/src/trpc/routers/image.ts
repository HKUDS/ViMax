import { TRPCError } from "@trpc/server";
import {
  AssetConfirmUploadSchema,
  AssetUploadRequestSchema,
  ImageEditInputSchema,
  ImageGenerateInputSchema,
} from "@vimax/contracts";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { z } from "zod";
import {
  confirmAssetUpload,
  getAssetDownloadUrl,
  requestAssetUpload,
} from "../../domain/asset/asset.service.js";
import { offloadAsset, requestAssetRestore, confirmAssetRestore } from "../../domain/asset/asset-offload.js";
import { generateImage, getImageJob } from "../../domain/image/generate.service.js";
import { editImage } from "../../domain/image/edit.service.js";
import { getJobWithOutputUrl } from "../../domain/job/job-event.service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, jobs } from "../../infrastructure/db/schema.js";
import { createPresignedDownloadUrl } from "../../infrastructure/storage/s3.js";
import { protectedProcedure, router } from "../trpc.js";

function mapError(err: unknown): never {
  const message = err instanceof Error ? err.message : "internal";
  const codeMap: Record<string, TRPCError["code"]> = {
    "input.asset_not_found": "NOT_FOUND",
    "input.asset_offloaded_local": "NOT_FOUND",
    "input.source_asset_required": "BAD_REQUEST",
    "input.unsupported_model": "BAD_REQUEST",
    "provider.invalid_key": "PRECONDITION_FAILED",
  };
  throw new TRPCError({
    code: codeMap[message] ?? "INTERNAL_SERVER_ERROR",
    message,
  });
}

export const imageRouter = router({
  generate: protectedProcedure.input(ImageGenerateInputSchema).mutation(async ({ input }) => {
    try {
      return await generateImage(input);
    } catch (err) {
      mapError(err);
    }
  }),

  // 电商后处理：对既有图片做 白底/换背景/扩图/局部调整（image.edit）
  edit: protectedProcedure.input(ImageEditInputSchema).mutation(async ({ input }) => {
    try {
      return await editImage(input);
    } catch (err) {
      mapError(err);
    }
  }),

  getJob: protectedProcedure
    .input(z.object({ job_id: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await getJobWithOutputUrl(input.job_id);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      const snapshot = result.job.inputSnapshot as {
        prompt?: string;
        mode?: string;
        model_id?: string;
        size?: string;
        edit_op?: string;
        source_asset_id?: string;
      };

      return {
        job_id: result.job.id,
        status: result.job.status,
        progress: result.job.progress,
        job_type: result.job.jobType,
        prompt: snapshot.prompt,
        mode: snapshot.mode,
        model_id: snapshot.model_id,
        size: snapshot.size,
        edit_op: snapshot.edit_op,
        source_asset_id: snapshot.source_asset_id,
        output_asset_id: result.job.outputAssetId,
        output_url: result.outputUrl,
        error_code: result.job.errorCode,
        error_message: result.job.errorMessage,
        queued_at: result.job.queuedAt?.toISOString(),
        finished_at: result.job.finishedAt?.toISOString(),
      };
    }),

  listHistory: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 20;
      const db = getDb();

      let cursorQueuedAt: Date | undefined;
      if (input?.cursor) {
        const cursorJob = await getImageJob(input.cursor);
        cursorQueuedAt = cursorJob?.queuedAt;
      }

      const rows = await db
        .select()
        .from(jobs)
        .where(
          and(
            like(jobs.jobType, "image.%"),
            cursorQueuedAt ? lt(jobs.queuedAt, cursorQueuedAt) : undefined,
          ),
        )
        .orderBy(desc(jobs.queuedAt))
        .limit(limit + 1);

      const page = rows.slice(0, limit);

      const items = await Promise.all(
        page.map(async (job) => {
          const snapshot = job.inputSnapshot as {
            prompt?: string;
            mode?: string;
            model_id?: string;
            edit_op?: string;
            source_asset_id?: string;
          };
          let thumbnailUrl: string | undefined;
          if (job.outputAssetId) {
            const [asset] = await db
              .select()
              .from(assets)
              .where(eq(assets.id, job.outputAssetId))
              .limit(1);
            if (asset) {
              thumbnailUrl = await createPresignedDownloadUrl(asset.storageKey, 600);
            }
          }
          return {
            job_id: job.id,
            status: job.status,
            job_type: job.jobType,
            prompt: snapshot.prompt ?? "",
            mode: snapshot.mode,
            model_id: snapshot.model_id,
            edit_op: snapshot.edit_op,
            source_asset_id: snapshot.source_asset_id,
            output_asset_id: job.outputAssetId,
            thumbnail_url: thumbnailUrl,
            created_at: job.queuedAt.toISOString(),
          };
        }),
      );

      return {
        items,
        nextCursor: rows.length > limit ? rows[limit]?.id : undefined,
      };
    }),
});

export const assetRouter = router({
  requestUpload: protectedProcedure.input(AssetUploadRequestSchema).mutation(async ({ input }) => {
    return requestAssetUpload(input);
  }),

  confirmUpload: protectedProcedure.input(AssetConfirmUploadSchema).mutation(async ({ input }) => {
    try {
      return await confirmAssetUpload(input);
    } catch (err) {
      mapError(err);
    }
  }),

  // ── 本地化存储：客户端确认已写入本地后清除远端二进制 ──────────
  offload: protectedProcedure
    .input(z.object({ asset_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        return await offloadAsset(input.asset_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── 本地化恢复：下游 job 需要二进制时，客户端从本地金库回传 ──
  restoreRequest: protectedProcedure
    .input(z.object({ asset_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        return await requestAssetRestore(input.asset_id);
      } catch (err) {
        mapError(err);
      }
    }),

  restoreConfirm: protectedProcedure
    .input(z.object({ asset_id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      try {
        return await confirmAssetRestore(input.asset_id);
      } catch (err) {
        mapError(err);
      }
    }),

  getDownloadUrl: protectedProcedure
    .input(z.object({ asset_id: z.string().uuid() }))
    .query(async ({ input }) => {
      try {
        return await getAssetDownloadUrl(input.asset_id);
      } catch (err) {
        mapError(err);
      }
    }),

  // ── Asset Library (资源库) ──────────────────────────────────────

  listAssets: protectedProcedure
    .input(
      z.object({
        kind: z.enum(["image", "video", "audio"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().uuid().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 50;
      const kind = input?.kind;
      const db = getDb();

      const conditions = [];
      if (kind) {
        conditions.push(eq(assets.kind, kind));
      }
      if (input?.cursor) {
        const [cursorAsset] = await db
          .select({ createdAt: assets.createdAt })
          .from(assets)
          .where(eq(assets.id, input.cursor))
          .limit(1);
        if (cursorAsset) {
          conditions.push(lt(assets.createdAt, cursorAsset.createdAt));
        }
      }

      const rows = await db
        .select()
        .from(assets)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(assets.createdAt))
        .limit(limit + 1);

      const page = rows.slice(0, limit);

      const items = await Promise.all(
        page.map(async (asset) => {
          // 已本地化的资产不再签发远端下载地址
          let downloadUrl: string | undefined;
          if (!asset.offloadedAt) {
            try {
              downloadUrl = await createPresignedDownloadUrl(asset.storageKey, 300);
            } catch {
              // Skip if presigned URL fails
            }
          }
          return {
            asset_id: asset.id,
            kind: asset.kind,
            mime_type: asset.mimeType,
            width: asset.width,
            height: asset.height,
            size_bytes: asset.sizeBytes,
            source: asset.source,
            offloaded_at: asset.offloadedAt ? asset.offloadedAt.toISOString() : null,
            download_url: downloadUrl,
            created_at: asset.createdAt.toISOString(),
          };
        }),
      );

      return {
        items,
        nextCursor: rows.length > limit ? rows[limit]?.id : undefined,
      };
    }),
});
