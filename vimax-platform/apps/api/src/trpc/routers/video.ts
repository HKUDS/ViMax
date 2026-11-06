import { TRPCError } from "@trpc/server";
import { VideoGenerateInputSchema } from "@vimax/contracts";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { z } from "zod";
import { getVideoJob, generateVideo } from "../../domain/video/generate.service.js";
import { getJobWithOutputUrl } from "../../domain/job/job-event.service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { jobs } from "../../infrastructure/db/schema.js";
import { protectedProcedure, router } from "../trpc.js";

function mapError(err: unknown): never {
  const message = err instanceof Error ? err.message : "internal";
  const codeMap: Record<string, TRPCError["code"]> = {
    "input.asset_not_found": "NOT_FOUND",
    "input.unsupported_model": "BAD_REQUEST",
    "provider.invalid_key": "PRECONDITION_FAILED",
  };
  throw new TRPCError({
    code: codeMap[message] ?? "INTERNAL_SERVER_ERROR",
    message,
  });
}

export const videoRouter = router({
  generate: protectedProcedure.input(VideoGenerateInputSchema).mutation(async ({ input }) => {
    try {
      return await generateVideo(input);
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
        duration_sec?: number;
        aspect_ratio?: string;
        fps?: number;
        resolution?: string;
      };

      return {
        job_id: result.job.id,
        status: result.job.status,
        progress: result.job.progress,
        job_type: result.job.jobType,
        prompt: snapshot.prompt,
        mode: snapshot.mode,
        model_id: snapshot.model_id,
        duration_sec: snapshot.duration_sec,
        aspect_ratio: snapshot.aspect_ratio,
        fps: snapshot.fps,
        resolution: snapshot.resolution,
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
        const cursorJob = await getVideoJob(input.cursor);
        cursorQueuedAt = cursorJob?.queuedAt;
      }

      const rows = await db
        .select()
        .from(jobs)
        .where(
          and(
            like(jobs.jobType, "video.%"),
            cursorQueuedAt ? lt(jobs.queuedAt, cursorQueuedAt) : undefined,
          ),
        )
        .orderBy(desc(jobs.queuedAt))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const items = page.map((job) => {
        const snapshot = job.inputSnapshot as {
          prompt?: string;
          mode?: string;
          model_id?: string;
          duration_sec?: number;
          aspect_ratio?: string;
        };
        return {
          job_id: job.id,
          status: job.status,
          prompt: snapshot.prompt ?? "",
          mode: snapshot.mode,
          model_id: snapshot.model_id,
          duration_sec: snapshot.duration_sec,
          aspect_ratio: snapshot.aspect_ratio,
          created_at: job.queuedAt.toISOString(),
        };
      });

      return {
        items,
        nextCursor: rows.length > limit ? rows[limit]?.id : undefined,
      };
    }),
});
