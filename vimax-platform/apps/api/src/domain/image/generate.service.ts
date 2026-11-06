import { randomUUID } from "node:crypto";
import type { ImageGenerateInput, ImageGenerateOutput, ImageJobPayload } from "@vimax/contracts";
import { composeImagePrompt } from "@vimax/contracts";
import { eq } from "drizzle-orm";
import { config } from "../../config/env.js";
import {
  buildImageCacheKey,
  collectReferenceSha256s,
  findCachedJob,
} from "./cache.service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { jobEvents, jobs } from "../../infrastructure/db/schema.js";
import { jobEventChannel } from "../../infrastructure/redis/client.js";
import { enqueueImageJob } from "../../infrastructure/queue/producer.js";
import { buildStorageKey, getBucket } from "../../infrastructure/storage/s3.js";

export async function generateImage(input: ImageGenerateInput): Promise<ImageGenerateOutput> {
  // 与画布节点执行同源：DB 模型优先（studio 列表展示的就是 DB 模型），
  // 注册表 id 兜底，最终回退租户默认图像模型；i2i 再按 DEFAULT_I2I_IMAGE_MODEL
  // 换用支持参考图的档位。
  const { resolveImageModelForMode, resolveImageFallbackModels } = await import("../canvas/node-executor.service.js");
  const model = await resolveImageModelForMode(input.model_id, input.mode);
  if (input.mode === "i2i" && !model.supports_reference) {
    throw new Error("input.unsupported_model");
  }
  const modelId = model.id;

  const { assets: refAssets, sha256s } = await collectReferenceSha256s(input.reference_asset_ids);
  // 负面词折叠进发送给模型的 prompt（云 API 无独立参数）；缓存键随合成
  // 后的 prompt 变化，快照保留原始字段供历史展示。
  const effectivePrompt = composeImagePrompt(
    input.prompt,
    undefined,
    undefined,
    input.negative_prompt,
  );
  const cacheKey = buildImageCacheKey({
    mode: input.mode,
    prompt: effectivePrompt,
    model_id: modelId,
    size: input.size,
    reference_sha256s: sha256s,
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

  const apiKey = model.api_key ?? config.apiKeyFor(model.provider);
  if (!apiKey) {
    throw new Error("provider.invalid_key");
  }

  const jobId = randomUUID();
  const jobType = input.mode === "t2i" ? "image.t2i" : "image.i2i";
  const inputSnapshot = {
    mode: input.mode,
    prompt: input.prompt,
    negative_prompt: input.negative_prompt ?? "",
    model_id: modelId,
    size: input.size,
    reference_asset_ids: input.reference_asset_ids ?? [],
    reference_storage_keys: refAssets.map((a) => a.storageKey),
  };

  const payload: ImageJobPayload = {
    job_id: jobId,
    job_type: jobType,
    model_id: modelId,
    credential: {
      class_path: model.class_path,
      api_key: apiKey,
      base_url: model.base_url,
      model: model.model,
    },
    fallback_credentials: await resolveImageFallbackModels(modelId, input.mode === "i2i"),
    input: {
      prompt: effectivePrompt,
      size: input.size,
      reference_storage_keys: refAssets.map((a) => a.storageKey),
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
  await db.insert(jobs).values({
    id: jobId,
    jobType,
    queueName: "q.image.std",
    bullmqJobId: jobId,
    inputSnapshot,
    cacheKey,
    status: "queued",
    progress: 0,
  });

  await db.insert(jobEvents).values({
    jobId,
    eventType: "queued",
    payload: { message: "Job queued" },
  });

  await enqueueImageJob(payload);

  return {
    job_id: jobId,
    status: "queued",
    cache_hit: false,
  };
}

export async function getImageJob(jobId: string) {
  const db = getDb();
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return job ?? null;
}
