export const IMAGE_JOB_TYPES = [
  "image.t2i",
  "image.i2i",
  "image.edit",
] as const;

/** Image-pipeline jobs that post-process or analyse an existing image. */
export const IMAGE_POST_JOB_TYPES = [
  "image.text",
  "image.compliance",
] as const;

/** Canvas-originated job types that still use the image generation pipeline. */
export const CANVAS_IMAGE_JOB_TYPES = [
  "shot.first_frame",
  "shot.last_frame",
  "character.portrait.front",
  "character.portrait.side",
  "character.portrait.back",
] as const;

export const ALL_IMAGE_JOB_TYPES = [
  ...IMAGE_JOB_TYPES,
  ...IMAGE_POST_JOB_TYPES,
  ...CANVAS_IMAGE_JOB_TYPES,
] as const;

export type ImageJobType = (typeof IMAGE_JOB_TYPES)[number];
export type CanvasImageJobType = (typeof CANVAS_IMAGE_JOB_TYPES)[number];
export type AllImageJobType = (typeof ALL_IMAGE_JOB_TYPES)[number];

export const IMAGE_EDIT_OPS = ["inpaint", "outpaint", "remove_bg", "replace_bg"] as const;
export type ImageEditOp = (typeof IMAGE_EDIT_OPS)[number];

/** 平台合规预检支持的平台（check_compliance / image.compliance）。 */
export const COMPLIANCE_PLATFORMS = ["amazon", "tiktok_shop", "shopee", "shopify"] as const;
export type CompliancePlatform = (typeof COMPLIANCE_PLATFORMS)[number];

/** A rendered text layer burned onto an existing image (image.text). */
export interface ImageTextLayer {
  text: string;
  /** 0-1 normalized top-left anchor. */
  x: number;
  y: number;
  font_size: number;
  /** CSS-style hex color, e.g. "#ffffff". */
  color: string;
  align?: "left" | "center" | "right";
  /** Registered font name; falls back to the worker's CJK default. */
  font?: string;
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cached",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_EVENT_TYPES = [
  "queued",
  "started",
  "progress",
  "log",
  "completed",
  "failed",
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export const IMAGE_SIZES = [
  "1024x1024",
  "1600x900",
  "1024x1792",
  "1792x1024",
  "1344x768",
  "768x1344",
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const IMAGE_MODES = ["t2i", "i2i"] as const;
export type ImageMode = (typeof IMAGE_MODES)[number];

export interface ImageJobCredential {
  class_path: string;
  api_key: string;
  base_url?: string;
  model?: string;
}

/** 容量类失败（拥堵/限流/配额尽）时依次降级尝试的备用模型。 */
export interface FallbackCredential {
  class_path: string;
  api_key: string;
  base_url?: string;
  model?: string;
  label?: string;
}

export interface ImageJobInput {
  prompt: string;
  /** 画布电商比例可产出 IMAGE_SIZES 之外的合法 WxH（如 1024x1536）。 */
  size: string;
  reference_storage_keys?: string[];
  /** 输入图（image.edit / image.text / image.compliance 的操作对象）。 */
  source_storage_key?: string;
  /** image.edit 的局部重绘遮罩（与 source 同尺寸的 PNG alpha 遮罩）。 */
  mask_storage_key?: string;
  edit_op?: ImageEditOp;
  /** seed_lock：固定随机种子保证批量变体的商品一致性。 */
  seed?: number;
  /** image.text：压在 source 上的文字图层。 */
  text_layers?: ImageTextLayer[];
  /** image.compliance：要校验的平台 id（amazon/tiktok_shop/shopee/shopify）。 */
  compliance_platforms?: string[];
}

export interface ImageJobCallback {
  event_channel: string;
  upload_bucket: string;
  upload_prefix: string;
}

export interface ImageJobPayload {
  job_id: string;
  job_type: AllImageJobType;
  model_id: string;
  credential: ImageJobCredential;
  /** 主模型容量类失败时依次降级尝试的备用模型链（可选） */
  fallback_credentials?: FallbackCredential[];
  input: ImageJobInput;
  callback: ImageJobCallback;
  cache_key: string;
  timeout_ms: number;
  /** Python worker 侧已尝试次数；首次执行缺省 0。 */
  attempt?: number;
  /** W3C traceparent（TS 决策层 → Python worker 观测关联）。 */
  traceparent?: string;
}

export interface ImageJobOutput {
  storage_key: string;
  width: number;
  height: number;
  sha256: string;
  mime_type: string;
  size_bytes: number;
}

// ── Video job types ─────────────────────────────────────────────────

export const VIDEO_JOB_TYPES = ["shot.video"] as const;
export type VideoJobType = (typeof VIDEO_JOB_TYPES)[number];

/** Studio-originated standalone video jobs (video studio page). */
export const VIDEO_STUDIO_JOB_TYPES = ["video.t2v", "video.i2v"] as const;
export type VideoStudioJobType = (typeof VIDEO_STUDIO_JOB_TYPES)[number];

export const CONCAT_JOB_TYPES = ["concat.videos"] as const;
export type ConcatJobType = (typeof CONCAT_JOB_TYPES)[number];

/** All job types that can reach the Python workers. */
export const ALL_WORKER_JOB_TYPES = [
  ...ALL_IMAGE_JOB_TYPES,
  ...VIDEO_JOB_TYPES,
] as const;

export interface VideoJobInput {
  prompt: string;
  first_frame_storage_key?: string;
  last_frame_storage_key?: string;
  duration_sec?: number;
  resolution?: string;
  aspect_ratio?: string;
  fps?: number;
}

export interface VideoJobPayload {
  job_id: string;
  job_type: VideoJobType | VideoStudioJobType;
  model_id: string;
  credential: {
    class_path: string;
    api_key: string;
    base_url?: string;
    model?: string;
  };
  /** 容量类失败时依次降级尝试的备用模型链（可选） */
  fallback_credentials?: FallbackCredential[];
  input: VideoJobInput;
  callback: {
    event_channel: string;
    upload_bucket: string;
    upload_prefix: string;
  };
  cache_key: string;
  timeout_ms: number;
}

export interface VideoJobOutput {
  storage_key: string;
  width: number;
  height: number;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  duration_sec?: number;
}

export interface JobCompletedEvent {
  type: "completed";
  ts: string;
  job_id: string;
  output: ImageJobOutput;
}

export interface JobFailedEvent {
  type: "failed";
  ts: string;
  job_id: string;
  error_code: string;
  error_message: string;
  retryable: boolean;
}

export interface JobProgressEvent {
  type: "progress";
  ts: string;
  job_id: string;
  percent: number;
  message: string;
}

export interface JobStartedEvent {
  type: "started";
  ts: string;
  job_id: string;
}

export type JobEvent =
  | JobStartedEvent
  | JobProgressEvent
  | JobCompletedEvent
  | JobFailedEvent;

export interface ImageModelDescriptor {
  id: string;
  label: string;
  provider: "doubao" | "google" | "yunwu" | "zhipu" | "modelscope" | "agnes";
  class_path: string;
  sizes: ImageSize[];
  supports_reference: boolean;
  credits_per_image: number;
  init_args?: Record<string, string>;
}

export const IMAGE_MODELS: ImageModelDescriptor[] = [
  {
    id: "doubao-seedream-4-0",
    label: "Doubao Seedream 4.0",
    provider: "doubao",
    class_path: "tools.ImageGeneratorDoubaoSeedreamYunwuAPI",
    sizes: ["1024x1024", "1600x900", "1024x1792"],
    supports_reference: true,
    credits_per_image: 1,
    init_args: {
      model: "doubao-seedream-4-0-250828",
      base_url: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    },
  },
  {
    id: "nanobanana-google",
    label: "NanoBanana (Google)",
    provider: "google",
    class_path: "tools.ImageGeneratorNanobananaGoogleAPI",
    sizes: ["1024x1024", "1600x900"],
    supports_reference: true,
    credits_per_image: 2,
  },
  {
    id: "cogview-3-flash",
    label: "CogView-3-Flash (Zhipu Free)",
    provider: "zhipu",
    class_path: "tools.ImageGeneratorCogViewZhipuAPI",
    sizes: ["1024x1024", "1344x768", "768x1344"],
    supports_reference: false,
    credits_per_image: 0,
    init_args: {
      base_url: "https://open.bigmodel.cn",
      model: "cogview-3-flash",
    },
  },
  {
    id: "modelscope-qwen-image",
    label: "Qwen-Image (ModelScope Free)",
    provider: "modelscope",
    class_path: "tools.ImageGeneratorModelScopeAPI",
    sizes: ["1024x1024", "1344x768", "768x1344"],
    supports_reference: false,
    credits_per_image: 0,
    init_args: {
      base_url: "https://api-inference.modelscope.cn",
      model: "Qwen/Qwen-Image",
    },
  },
  {
    id: "modelscope-qwen-image-edit",
    label: "Qwen-Image-Edit-2509 (ModelScope Free)",
    provider: "modelscope",
    class_path: "tools.ImageGeneratorQwenImageEditModelScopeAPI",
    sizes: ["1024x1024", "1344x768", "768x1344"],
    supports_reference: true,
    credits_per_image: 0,
    init_args: {
      base_url: "https://api-inference.modelscope.cn",
      model: "Qwen/Qwen-Image-Edit-2509",
    },
  },
  {
    id: "agnes-image-2.5-flash",
    label: "Agnes Image 2.5 Flash",
    provider: "agnes",
    class_path: "tools.ImageGeneratorAgnesAPI",
    sizes: ["1024x1024", "1600x900", "1024x1792", "1792x1024"],
    supports_reference: true,
    credits_per_image: 0,
    init_args: {
      base_url: "https://apihub.agnes-ai.com/v1",
      model: "agnes-image-2.5-flash",
    },
  },
];

export function getImageModel(modelId: string): ImageModelDescriptor | undefined {
  return IMAGE_MODELS.find((m) => m.id === modelId);
}

// ── Video Motion Presets (大师运镜) ────────────────────────────────

export const VIDEO_MOTION_PRESETS = [
  // 基础运镜
  { id: "push_in", label: "推 (Push In)", category: "basic", description: "缓慢推向主体，制造紧张感" },
  { id: "pull_out", label: "拉 (Pull Out)", category: "basic", description: "从主体缓慢拉远，展现场景全貌" },
  { id: "pan_left", label: "摇左 (Pan Left)", category: "basic", description: "水平向左摇镜头" },
  { id: "pan_right", label: "摇右 (Pan Right)", category: "basic", description: "水平向右摇镜头" },
  { id: "tilt_up", label: "仰 (Tilt Up)", category: "basic", description: "从下向上仰拍，展现宏伟" },
  { id: "tilt_down", label: "俯 (Tilt Down)", category: "basic", description: "从上向下俯拍，展现全貌" },
  { id: "zoom_in", label: "变焦推近 (Zoom In)", category: "basic", description: "镜头变焦推近，聚焦细节" },
  { id: "zoom_out", label: "变焦拉远 (Zoom Out)", category: "basic", description: "镜头变焦拉远，展现环境" },
  // 运动运镜
  { id: "tracking", label: "跟拍 (Tracking)", category: "movement", description: "跟随主体移动，保持距离" },
  { id: "orbit", label: "环绕 (Orbit)", category: "movement", description: "围绕主体360度旋转拍摄" },
  { id: "aerial", label: "航拍 (Aerial)", category: "movement", description: "高空俯视航拍大场景" },
  { id: "crane", label: "升降 (Crane)", category: "movement", description: "摇臂升降运动，从地面到高空" },
  { id: "dolly", label: "滑轨 (Dolly)", category: "movement", description: "沿滑轨平滑推进或拉远" },
  // 效果运镜
  { id: "handheld", label: "手持晃动 (Handheld)", category: "effect", description: "手持摄影晃动效果，增加真实感" },
  { id: "static", label: "静止 (Static)", category: "effect", description: "固定机位静止画面" },
  { id: "whip_pan", label: "甩镜 (Whip Pan)", category: "effect", description: "快速甩镜转场，连接两个画面" },
  { id: "roll", label: "旋转 (Roll)", category: "effect", description: "镜头绕光轴旋转" },
  { id: "rack_focus", label: "移焦 (Rack Focus)", category: "effect", description: "焦点从一个主体转移到另一个" },
] as const;

export type VideoMotionPresetId = (typeof VIDEO_MOTION_PRESETS)[number]["id"];

export function getMotionPreset(id: string) {
  return VIDEO_MOTION_PRESETS.find((p) => p.id === id);
}

// ── Video Style Presets (视觉风格预设) ──────────────────────────────

export interface VideoStylePreset {
  id: string;
  label: string;
  /** Style fragment appended to the user prompt at generation time. */
  prompt: string;
}

/** Visual style presets for video generation (视频风格 12 选 1). */
export const VIDEO_STYLE_PRESETS: readonly VideoStylePreset[] = [
  { id: "none", label: "默认", prompt: "" },
  { id: "cyberpunk", label: "赛博幻境", prompt: "cyberpunk aesthetic, deep-blue neon streets, volumetric lighting, 8k hyper-realistic rendering" },
  { id: "anime", label: "日漫奇旅", prompt: "japanese anime style, cel shading, vibrant colors, expressive key animation" },
  { id: "cinematic", label: "电影质感", prompt: "cinematic film look, anamorphic lens flare, dramatic color grading, shallow depth of field" },
  { id: "3d-animation", label: "3D 动画", prompt: "polished 3D animation style, soft global illumination, pixar-like character design" },
  { id: "vaporwave", label: "蒸汽波", prompt: "vaporwave aesthetic, retro synth gradients, chromatic aberration, 80s nostalgia" },
  { id: "neo-chinese", label: "新中式科幻", prompt: "neo-chinese sci-fi aesthetic, ink-wash meets futuristic tech, oriental minimalism" },
  { id: "documentary", label: "写实纪录", prompt: "documentary realism, natural lighting, handheld authenticity, 35mm texture" },
  { id: "watercolor", label: "水彩插画", prompt: "watercolor illustration style, flowing pigments, soft paper texture, artistic brush strokes" },
  { id: "film-noir", label: "黑白胶片", prompt: "black-and-white film noir, high contrast monochrome, 1950s grain, dramatic shadows" },
  { id: "claymation", label: "黏土定格", prompt: "claymation stop-motion style, handmade plasticine texture, tactile imperfections" },
  { id: "dark-epic", label: "暗黑史诗", prompt: "dark epic fantasy, moody atmosphere, monumental scale, rim-lit silhouettes" },
];

export function getVideoStylePreset(id: string | undefined) {
  return VIDEO_STYLE_PRESETS.find((p) => p.id === id);
}

// ── Video Aspect Ratios (视频画幅) ──────────────────────────────────

export interface VideoAspectRatioPreset {
  id: string;
  label: string;
  /** Ratio string passed to the provider (e.g. "16:9"). */
  ratio: string;
}

/** Aspect ratios for video generation. */
export const VIDEO_ASPECT_RATIOS: readonly VideoAspectRatioPreset[] = [
  { id: "16-9", label: "16:9 横屏", ratio: "16:9" },
  { id: "9-16", label: "9:16 竖屏", ratio: "9:16" },
  { id: "2-35-1", label: "2.35:1 宽幅", ratio: "2.35:1" },
  { id: "1-1", label: "1:1 正方", ratio: "1:1" },
];

export function getVideoAspectRatio(id: string | undefined) {
  return VIDEO_ASPECT_RATIOS.find((p) => p.id === id);
}

/**
 * Compose the prompt actually sent to the video model: user prompt plus
 * style preset fragment, motion preset description and motion intensity
 * (the provider API takes camera/style as prompt text, not params).
 */
export function composeVideoPrompt(input: {
  prompt: string;
  stylePresetId?: string;
  motionPresetId?: string;
  motionIntensity?: number;
  negativePrompt?: string;
}): string {
  const style = getVideoStylePreset(input.stylePresetId);
  const motion = getMotionPreset(input.motionPresetId ?? "");
  const parts = [input.prompt.trim()];
  if (style?.prompt) parts.push(style.prompt);
  if (motion) parts.push(`Camera movement: ${motion.label}: ${motion.description}`);
  if (input.motionIntensity != null) {
    parts.push(`Motion intensity: ${input.motionIntensity}/10`);
  }
  if (input.negativePrompt?.trim()) {
    parts.push(`Avoid: ${input.negativePrompt.trim()}`);
  }
  return parts.filter(Boolean).join(", ");
}

// ── Video Model Descriptors ────────────────────────────────────────

export interface VideoModelDescriptor {
  id: string;
  label: string;
  provider: "doubao" | "google" | "yunwu" | "zhipu" | "agnes";
  class_path: string;
  maxDuration: number;
  resolutions: string[];
  supports_reference: boolean;
  credits_per_second: number;
  init_args?: Record<string, string>;
}

export const VIDEO_MODELS: VideoModelDescriptor[] = [
  {
    id: "doubao-seedance-1-0-lite",
    label: "Doubao Seedance 1.0 Lite",
    provider: "doubao",
    class_path: "tools.VideoGeneratorDoubaoSeedanceYunwuAPI",
    maxDuration: 10,
    resolutions: ["480p", "720p", "1080p"],
    supports_reference: true,
    credits_per_second: 1,
    init_args: {
      base_url: "https://yunwu.ai/volc/v1/contents/generations/tasks",
    },
  },
  {
    id: "veo-yunwu",
    label: "Veo 3.1 (Yunwu)",
    provider: "yunwu",
    class_path: "tools.VideoGeneratorVeoYunwuAPI",
    maxDuration: 8,
    resolutions: ["720p", "1080p"],
    supports_reference: true,
    credits_per_second: 2,
    init_args: {
      base_url: "https://yunwu.ai",
    },
  },
  {
    id: "veo-google",
    label: "Veo 3.1 (Google)",
    provider: "google",
    class_path: "tools.VideoGeneratorVeoGoogleAPI",
    maxDuration: 8,
    resolutions: ["720p", "1080p"],
    supports_reference: true,
    credits_per_second: 3,
  },
  {
    id: "cogvideox-flash",
    label: "CogVideoX-Flash (Zhipu Free)",
    provider: "zhipu",
    class_path: "tools.VideoGeneratorCogVideoXZhipuAPI",
    maxDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    supports_reference: true,
    credits_per_second: 0,
    init_args: {
      base_url: "https://open.bigmodel.cn",
      model: "cogvideox-flash",
    },
  },
  {
    id: "agnes-video-2.5",
    label: "Agnes Video 2.5",
    provider: "agnes",
    class_path: "tools.VideoGeneratorAgnesAPI",
    maxDuration: 12,
    resolutions: ["720p", "1080p"],
    supports_reference: true,
    credits_per_second: 1,
    init_args: {
      base_url: "https://apihub.agnes-ai.com/v1",
      model: "agnes-video-2.5",
    },
  },
  {
    id: "agnes-video-2.5-flash",
    label: "Agnes Video 2.5 Flash (Free)",
    provider: "agnes",
    class_path: "tools.VideoGeneratorAgnesAPI",
    maxDuration: 12,
    resolutions: ["720p"],
    supports_reference: true,
    credits_per_second: 0,
    init_args: {
      base_url: "https://apihub.agnes-ai.com/v1",
      model: "agnes-video-2.5-flash",
    },
  },
];

export function getVideoModel(modelId: string): VideoModelDescriptor | undefined {
  return VIDEO_MODELS.find((m) => m.id === modelId);
}

// ── Default Text Model (fallback when no DB model configured) ──────────

export const DEFAULT_TEXT_MODEL_ID = "doubao-pro-32k";

export const DEFAULT_TEXT_MODEL = {
  id: DEFAULT_TEXT_MODEL_ID,
  label: "Doubao Pro 32K",
  provider: "doubao" as const,
  vendorId: "openai-compatible",
  vendorModelId: "doubao-pro-32k",
  maxTokens: 32768,
  supportsThinking: true,
};

// ── Default TTS Model (口播配音 fallback) ──────────────────────────────

export const DEFAULT_TTS_MODEL = {
  id: "yunwu-tts-1",
  label: "OpenAI TTS (Yunwu)",
  provider: "yunwu" as const,
  classPath: "tools.TtsGeneratorOpenAIAPI",
  baseUrl: "https://yunwu.ai/v1/audio/speech",
  vendorModelId: "tts-1",
  voice: "alloy",
};

// ── Pipeline Job Types (ViMax agent bridges) ───────────────────────
//
// Each type maps 1:1 to a bridge function in the Python pipeline worker
// (vimax_image_worker/pipeline_handler.py PIPELINE_JOB_HANDLERS).

export const PIPELINE_JOB_TYPES = [
  "pipeline.script2storyboard",
  "pipeline.story_push",
  "pipeline.idea2script",
  "pipeline.script2characters",
  "pipeline.plan_script",
  "pipeline.enhance_script",
  "pipeline.novel2scenes",
  "pipeline.select_reference",
  "pipeline.select_best_image",
  "pipeline.camera_tree",
  "pipeline.character_portraits",
] as const;
export type PipelineJobType = (typeof PIPELINE_JOB_TYPES)[number];

// ── Audio Job Types ────────────────────────────────────────────────

export const AUDIO_JOB_TYPES = ["audio.generate", "audio.tts"] as const;
export type AudioJobType = (typeof AUDIO_JOB_TYPES)[number];
