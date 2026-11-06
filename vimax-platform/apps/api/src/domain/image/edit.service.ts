import { randomUUID } from "node:crypto";
import type { ImageEditInput, ImageGenerateOutput, ImageJobPayload } from "@vimax/contracts";
import { composeImagePrompt } from "@vimax/contracts";
import { config } from "../../config/env.js";
import { buildImageCacheKey, collectReferenceSha256s, findCachedJob } from "./cache.service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { jobEvents, jobs } from "../../infrastructure/db/schema.js";
import { jobEventChannel } from "../../infrastructure/redis/client.js";
import { enqueueImageJob } from "../../infrastructure/queue/producer.js";
import { buildStorageKey, getBucket } from "../../infrastructure/storage/s3.js";
import type { Asset } from "../../infrastructure/db/schema.js";

export interface ImageEditPlan {
  jobType: "image.edit";
  cacheKey: string;
  size: string;
  effectivePrompt: string;
  payloadInput: ImageJobPayload["input"];
  inputSnapshot: Record<string, unknown>;
}

/** Pure decision core of an edit job — mirrors runImageEditJob's payload /
 * cache / snapshot construction so it is unit-testable without infra.
 * `model.id` is the effective model（i2i 回退后可能与 input.model_id 不同）. */
export function planImageEdit(
  input: ImageEditInput,
  model: { id: string; supports_reference?: boolean },
  source: Pick<Asset, "storageKey" | "width" | "height" | "sha256">,
): ImageEditPlan {
  if (!model.supports_reference) {
    throw new Error("input.unsupported_model");
  }

  // 编辑输出默认与源图同尺寸；上传时未知宽高回退 1024 方图
  const size =
    input.size
    ?? (source.width && source.height ? `${source.width}x${source.height}` : "1024x1024");

  const effectivePrompt = composeImagePrompt(
    input.prompt ?? "",
    undefined,
    undefined,
    input.negative_prompt,
  );
  const cacheKey = buildImageCacheKey({
    mode: "i2i",
    prompt: effectivePrompt,
    model_id: model.id,
    size,
    reference_sha256s: [],
    edit_op: input.edit_op,
    source_sha256: source.sha256,
  });

  return {
    jobType: "image.edit",
    cacheKey,
    size,
    effectivePrompt,
    payloadInput: {
      prompt: effectivePrompt,
      size,
      reference_storage_keys: [],
      source_storage_key: source.storageKey,
      edit_op: input.edit_op,
    },
    inputSnapshot: {
      mode: "i2i",
      edit_op: input.edit_op,
      prompt: input.prompt ?? "",
      negative_prompt: input.negative_prompt ?? "",
      model_id: model.id,
      size,
      source_asset_id: input.source_asset_id,
      reference_asset_ids: [],
    },
  };
}

export async function editImage(input: ImageEditInput): Promise<ImageGenerateOutput> {
  // 与 generateImage 同源的模型解析：DB 模型优先，注册表兜底；编辑必为 i2i，
  // 不支持参考图的档位回退到 DEFAULT_I2I_IMAGE_MODEL。
  const { resolveImageModelForMode } = await import("../canvas/node-executor.service.js");
  const model = await resolveImageModelForMode(input.model_id, "i2i");

  const { assets: sourceAssets } = await collectReferenceSha256s([input.source_asset_id]);
  const plan = planImageEdit(input, model, sourceAssets[0]);

  if (!input.force) {
    const cached = await findCachedJob(plan.cacheKey);
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
  const payload: ImageJobPayload = {
    job_id: jobId,
    job_type: plan.jobType,
    model_id: model.id,
    credential: {
      class_path: model.class_path,
      api_key: apiKey,
      base_url: model.base_url,
      model: model.model,
    },
    input: plan.payloadInput,
    callback: {
      event_channel: jobEventChannel(jobId),
      upload_bucket: getBucket(),
      upload_prefix: buildStorageKey("generated", jobId),
    },
    cache_key: plan.cacheKey,
    timeout_ms: 120_000,
  };

  const db = getDb();
  await db.insert(jobs).values({
    id: jobId,
    jobType: plan.jobType,
    queueName: "q.image.std",
    bullmqJobId: jobId,
    inputSnapshot: plan.inputSnapshot,
    cacheKey: plan.cacheKey,
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
