import { z } from "zod";
import { ALL_IMAGE_JOB_TYPES, COMPLIANCE_PLATFORMS, IMAGE_EDIT_OPS, IMAGE_MODES, IMAGE_SIZES, PIPELINE_JOB_TYPES, AUDIO_JOB_TYPES, VIDEO_ASPECT_RATIOS } from "./job-types.js";

export const ImageGenerateInputSchema = z
  .object({
    mode: z.enum(IMAGE_MODES),
    prompt: z.string().min(1).max(4000),
    model_id: z.string().min(1),
    size: z.enum(IMAGE_SIZES),
    // 无独立负面词参数的云 API —— API 侧折叠为 "Avoid: ..." 文本（见
    // composeImagePrompt），payload/worker 不感知该字段。
    negative_prompt: z.string().max(1000).optional(),
    reference_asset_ids: z.array(z.string().uuid()).max(4).optional(),
    force: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "i2i" && (!val.reference_asset_ids || val.reference_asset_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "i2i mode requires at least one reference_asset_id",
        path: ["reference_asset_ids"],
      });
    }
  });

export type ImageGenerateInput = z.infer<typeof ImageGenerateInputSchema>;

export const ImageGenerateOutputSchema = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["queued", "cached"]),
  cache_hit: z.boolean(),
  output_asset_id: z.string().uuid().optional(),
});

export type ImageGenerateOutput = z.infer<typeof ImageGenerateOutputSchema>;

// ── Image Studio edit ops（电商后处理：白底/换背景/扩图/局部调整） ──
// worker 侧 image.edit 已就绪；remove_bg 为本地抠图免 prompt，其余依赖
// prompt 约束保证商品主体不变。size 与 worker payload 同格式（WxH），
// 缺省时服务端取源图尺寸。

export const ImageEditInputSchema = z
  .object({
    source_asset_id: z.string().uuid(),
    edit_op: z.enum(IMAGE_EDIT_OPS),
    prompt: z.string().max(4000).optional(),
    model_id: z.string().min(1),
    size: z.string().regex(/^\d{3,4}x\d{3,4}$/).optional(),
    negative_prompt: z.string().max(1000).optional(),
    force: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.edit_op !== "remove_bg" && !val.prompt?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt is required for this edit_op",
        path: ["prompt"],
      });
    }
  });

export type ImageEditInput = z.infer<typeof ImageEditInputSchema>;

// ── Video Studio (standalone generation, mirrors the image studio) ──

export const VIDEO_MODES = ["t2v", "i2v"] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];

export const VideoGenerateInputSchema = z
  .object({
    mode: z.enum(VIDEO_MODES),
    prompt: z.string().min(1).max(4000),
    model_id: z.string().min(1),
    duration_sec: z.number().int().min(1).max(15),
    resolution: z.string().min(2).max(8),
    aspect_ratio: z.string().min(2).max(8).default("16:9"),
    fps: z.union([z.literal(16), z.literal(24)]).default(16),
    negative_prompt: z.string().max(1000).optional(),
    style_preset_id: z.string().max(40).optional(),
    motion_preset_id: z.string().max(40).optional(),
    motion_intensity: z.number().int().min(1).max(10).optional(),
    reference_asset_ids: z.array(z.string().uuid()).max(2).optional(),
    force: z.boolean().default(false),
  })
  .superRefine((val, ctx) => {
    if (val.mode === "i2v" && (!val.reference_asset_ids || val.reference_asset_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "i2v mode requires at least one reference_asset_id",
        path: ["reference_asset_ids"],
      });
    }
    if (!VIDEO_ASPECT_RATIOS.some((r) => r.ratio === val.aspect_ratio)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "unsupported aspect_ratio",
        path: ["aspect_ratio"],
      });
    }
  });

export type VideoGenerateInput = z.infer<typeof VideoGenerateInputSchema>;

export const VideoGenerateOutputSchema = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["queued", "cached"]),
  cache_hit: z.boolean(),
  output_asset_id: z.string().uuid().optional(),
});

export type VideoGenerateOutput = z.infer<typeof VideoGenerateOutputSchema>;

export const AssetUploadRequestSchema = z.object({
  mime_type: z.enum([
    "image/png",
    "image/jpeg",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/m4a",
  ]),
  // 视频手动上云需要更大的单文件额度
  size_bytes: z.number().int().positive().max(512 * 1024 * 1024),
});

export type AssetUploadRequest = z.infer<typeof AssetUploadRequestSchema>;

export const AssetUploadResponseSchema = z.object({
  asset_id: z.string().uuid(),
  upload_url: z.string().url(),
  storage_key: z.string(),
  expires_at: z.string().datetime(),
});

export type AssetUploadResponse = z.infer<typeof AssetUploadResponseSchema>;

export const AssetConfirmUploadSchema = z.object({
  asset_id: z.string().uuid(),
  sha256: z.string().length(64),
  // 音频无宽高；未知尺寸（浏览器端直传）传 0
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});

export type AssetConfirmUpload = z.infer<typeof AssetConfirmUploadSchema>;

export const ImageJobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(ALL_IMAGE_JOB_TYPES),
  model_id: z.string(),
  credential: z.object({
    class_path: z.string(),
    api_key: z.string(),
    base_url: z.string().optional(),
    model: z.string().optional(),
  }),
  input: z.object({
    prompt: z.string(),
    // 画布侧电商比例会产出 IMAGE_SIZES 之外的合法 WxH（如 1024x1536），
    // 桥接层只校验形状，具体尺寸由模型能力兜底。
    size: z.string().regex(/^\d{3,4}x\d{3,4}$/),
    reference_storage_keys: z.array(z.string()).optional(),
    source_storage_key: z.string().optional(),
    mask_storage_key: z.string().optional(),
    edit_op: z.enum(IMAGE_EDIT_OPS).optional(),
    seed: z.number().int().min(0).optional(),
    text_layers: z
      .array(
        z.object({
          text: z.string().min(1),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          font_size: z.number().int().min(8).max(512),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          align: z.enum(["left", "center", "right"]).optional(),
          font: z.string().optional(),
        }),
      )
      .optional(),
    compliance_platforms: z.array(z.enum(COMPLIANCE_PLATFORMS)).optional(),
  }),
  callback: z.object({
    event_channel: z.string(),
    upload_bucket: z.string(),
    upload_prefix: z.string(),
  }),
  cache_key: z.string(),
  timeout_ms: z.number().int().positive(),
  // provider 瞬时失败（rate_limited/timeout）时 Python worker 的已尝试次数，
  // 首次执行缺省为 0；重试由 worker 侧退避后重入队完成。
  attempt: z.number().int().min(0).max(5).optional(),
  // W3C traceparent，贯通 TS 决策层 → BullMQ → Python worker 的观测链。
  traceparent: z.string().optional(),
});

export type ImageJobPayloadValidated = z.infer<typeof ImageJobPayloadSchema>;

// ── Video job payload (forshot.video) ──────────────────────────────

export const VideoJobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(["shot.video", "video.t2v", "video.i2v"]),
  model_id: z.string(),
  credential: z.object({
    class_path: z.string(),
    api_key: z.string(),
    base_url: z.string().optional(),
    model: z.string().optional(),
  }),
  // 容量类失败（免费档拥堵/限流）时依次降级尝试的备用模型链
  fallback_credentials: z
    .array(
      z.object({
        class_path: z.string(),
        api_key: z.string(),
        base_url: z.string().optional(),
        model: z.string().optional(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  input: z.object({
    prompt: z.string(),
    first_frame_storage_key: z.string().optional(),
    last_frame_storage_key: z.string().optional(),
    duration_sec: z.number().int().positive().optional(),
    resolution: z.string().optional(),
    aspect_ratio: z.string().optional(),
    fps: z.number().int().optional(),
  }),
  callback: z.object({
    event_channel: z.string(),
    upload_bucket: z.string(),
    upload_prefix: z.string(),
  }),
  cache_key: z.string(),
  timeout_ms: z.number().int().positive(),
});

export type VideoJobPayloadValidated = z.infer<typeof VideoJobPayloadSchema>;

// ── Concat job payload ────────────────────────────────────────────────

export const ConcatJobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(["concat.videos"]),
  input: z.object({
    storage_keys: z.array(z.string()),
    // Per-clip subtitle text (aligned with storage_keys; null = no subtitle
    // for that clip). Present only when the concat node opts into burning.
    subtitles: z.array(z.string().nullable()).optional(),
  }),
  callback: z.object({
    event_channel: z.string(),
    upload_bucket: z.string(),
    upload_prefix: z.string(),
  }),
  cache_key: z.string(),
  timeout_ms: z.number().int().positive(),
});

export type ConcatJobPayloadValidated = z.infer<typeof ConcatJobPayloadSchema>;

export const JobEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("started"),
    ts: z.string(),
    job_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal("progress"),
    ts: z.string(),
    job_id: z.string().uuid(),
    percent: z.number().min(0).max(100),
    message: z.string(),
  }),
  z.object({
    type: z.literal("completed"),
    ts: z.string(),
    job_id: z.string().uuid(),
    output: z.object({
      storage_key: z.string(),
      // Video assets have no PIL-measurable dimensions — null is valid.
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      sha256: z.string(),
      mime_type: z.string(),
      size_bytes: z.number().int(),
      cells: z
        .array(
          z.object({
            shotBrief: z.string(),
            cameraIdx: z.number(),
            ffDesc: z.string().optional(),
            lfDesc: z.string().optional(),
            motionDesc: z.string().optional(),
            audioDesc: z.string().optional(),
            shotIdx: z.number().optional(),
          }),
        )
        .optional(),
      // Agent bridge results (characters, scripts, selections, trees).
      result: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    type: z.literal("failed"),
    ts: z.string(),
    job_id: z.string().uuid(),
    error_code: z.string(),
    error_message: z.string(),
    retryable: z.boolean(),
  }),
]);

export type JobEventValidated = z.infer<typeof JobEventSchema>;

// ── Pipeline job payload ───────────────────────────────────────────

export const PipelineJobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(PIPELINE_JOB_TYPES),
  credential: z.object({
    class_path: z.string(),
    api_key: z.string(),
    base_url: z.string().optional(),
    model: z.string().optional(),
    model_provider: z.string().optional(),
  }),
  input: z.object({
    content: z.string(),
    characters: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      )
      .optional(),
    user_requirement: z.string().optional(),
    reference_storage_keys: z.array(z.string()).optional(),
    // ── ViMax agent bridge inputs ──
    idea: z.string().optional(),
    story: z.string().optional(),
    novel_text: z.string().optional(),
    max_events: z.number().int().positive().optional(),
    max_scenes_per_event: z.number().int().positive().optional(),
    character: z
      .object({
        name: z.string(),
        description: z.string(),
      })
      .optional(),
    style: z.string().optional(),
    reference_pairs: z
      .array(
        z.object({
          storage_key: z.string(),
          text: z.string(),
        }),
      )
      .optional(),
    candidate_storage_keys: z.array(z.string()).optional(),
    target_description: z.string().optional(),
    cameras: z.array(z.record(z.string(), z.unknown())).optional(),
    shot_descs: z.array(z.record(z.string(), z.unknown())).optional(),
    ff_desc: z.string().optional(),
    lf_desc: z.string().optional(),
    motion_desc: z.string().optional(),
  }),
  callback: z.object({
    event_channel: z.string(),
    upload_bucket: z.string(),
    upload_prefix: z.string(),
  }),
  cache_key: z.string(),
  timeout_ms: z.number().int().positive(),
});

export type PipelineJobPayloadValidated = z.infer<typeof PipelineJobPayloadSchema>;

// ── Audio job payload ──────────────────────────────────────────────

export const AudioJobPayloadSchema = z.object({
  job_id: z.string().uuid(),
  job_type: z.enum(AUDIO_JOB_TYPES),
  input: z.object({
    prompt: z.string(),
    duration_sec: z.number().int().positive().optional(),
    // ── TTS (audio.tts) ──
    text: z.string().optional(),
    voice: z.string().optional(),
  }),
  // TTS routes through a vendor generator (same credential contract as
  // image/video jobs); the silent-WAV stub ignores it.
  credential: z
    .object({
      class_path: z.string(),
      api_key: z.string(),
      base_url: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  callback: z.object({
    event_channel: z.string(),
    upload_bucket: z.string(),
    upload_prefix: z.string(),
  }),
  cache_key: z.string(),
  timeout_ms: z.number().int().positive(),
});

export type AudioJobPayloadValidated = z.infer<typeof AudioJobPayloadSchema>;
