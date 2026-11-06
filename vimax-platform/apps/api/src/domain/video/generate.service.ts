import { randomUUID } from "node:crypto";
import type { VideoGenerateInput, VideoGenerateOutput, VideoJobPayload } from "@vimax/contracts";
import { composeVideoPrompt, getVideoModel } from "@vimax/contracts";
import { eq } from "drizzle-orm";
import { config } from "../../config/env.js";
import { buildVideoCacheKey } from "../canvas/cache-keys.js";
import { resolveVideoFallbackModels, resolveVideoModel } from "../canvas/node-executor.service.js";
import { collectReferenceSha256s, findCachedJob } from "../image/cache.service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { jobEvents, jobs } from "../../infrastructure/db/schema.js";
import { jobEventChannel } from "../../infrastructure/redis/client.js";
import { enqueueVideoJob } from "../../infrastructure/queue/producer.js";
import { buildStorageKey, getBucket } from "../../infrastructure/storage/s3.js";

/**
 * Standalone video generation for the video studio page — mirrors
 * generateImage: content-based cache, then enqueue a q.video.std job.
 * References map to frames positionally (first = first frame, second = last).
 */
export async function generateVideo(input: VideoGenerateInput): Promise<VideoGenerateOutput> {
  const model = getVideoModel(input.model_id);
  if (!model) {
    throw new Error("input.unsupported_model");
  }

  if (input.mode === "i2v" && !model.supports_reference) {
    throw new Error("input.unsupported_model");
  }

  const { assets: refAssets, sha256s } = await collectReferenceSha256s(input.reference_asset_ids);

  const prompt = composeVideoPrompt({
    prompt: input.prompt,
    stylePresetId: input.style_preset_id,
    motionPresetId: input.motion_preset_id,
    motionIntensity: input.motion_intensity,
    negativePrompt: input.negative_prompt,
  });

  const cacheKey = buildVideoCacheKey({
    model_id: input.model_id,
    prompt,
    first_frame_sha256: sha256s[0] ?? null,
    last_frame_sha256: sha256s[1] ?? null,
    duration_sec: input.duration_sec,
    resolution: input.resolution,
    aspect_ratio: input.aspect_ratio,
    fps: input.fps,
  });

  if (!input.force) {
    const cached = await findCachedJob(cacheKey);
    if (cached?.outputAssetId) {
      const db = getDb();
      await db.insert(jobEvents).values({
        jobId: cached.id,
        eventType: "completed",
        payload: { cache_hit: true },
      });
      return {
        job_id: cached.id,
        status: "cached",
        cache_hit: true,
        output_asset_id: cached.outputAssetId,
      };
    }
  }

  const resolved = await resolveVideoModel(input.model_id);
  const apiKey = resolved.api_key ?? config.apiKeyFor(resolved.provider);
  if (!apiKey) {
    throw new Error("provider.invalid_key");
  }

  const jobId = randomUUID();
  const jobType = input.mode === "t2v" ? "video.t2v" : "video.i2v";
  const inputSnapshot = {
    mode: input.mode,
    prompt: input.prompt,
    model_id: input.model_id,
    duration_sec: input.duration_sec,
    resolution: input.resolution,
    aspect_ratio: input.aspect_ratio,
    fps: input.fps,
    style_preset_id: input.style_preset_id,
    motion_preset_id: input.motion_preset_id,
  };

  const payload: VideoJobPayload = {
    job_id: jobId,
    job_type: jobType,
    model_id: input.model_id,
    credential: {
      class_path: resolved.class_path ?? model.class_path,
      api_key: apiKey,
      base_url: resolved.base_url,
      model: resolved.model,
    },
    fallback_credentials: await resolveVideoFallbackModels(resolved.id),
    input: {
      prompt,
      first_frame_storage_key: refAssets[0]?.storageKey,
      last_frame_storage_key: refAssets[1]?.storageKey,
      duration_sec: input.duration_sec,
      resolution: input.resolution,
      aspect_ratio: input.aspect_ratio,
      fps: input.fps,
    },
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: cacheKey,
    timeout_ms: 600_000,
  };

  const db = getDb();
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName: "q.video.std",
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey,
    status: "queued",
    progress: 0,
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Video generation queued" },
  });

  await enqueueVideoJob(payload);

  return {
    job_id: jobId,
    status: "queued",
    cache_hit: false,
  };
}

export async function getVideoJob(jobId: string) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}
