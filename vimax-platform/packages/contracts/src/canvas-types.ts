// ── Canvas Node Types ──────────────────────────────────────────────

import type { ImageTextLayer } from "./job-types.js";

export const CANVAS_NODE_TYPES = [
  "script",
  "character",
  "storyboard_cell",
  "shot",
  "image",
  "video",
  "audio",
  "concat",
] as const;

export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

export const CANVAS_NODE_STATUSES = [
  "idle",
  "running",
  "done",
  "dirty",
  "failed",
] as const;

export type CanvasNodeStatus = (typeof CANVAS_NODE_STATUSES)[number];

// ── Canvas Job Types (for job_type column) ─────────────────────────

export const CANVAS_JOB_TYPES = [
  "shot.first_frame",
  "shot.last_frame",
  "shot.video",
  "pipeline.idea2video",
  "pipeline.script2video",
  "character.portrait.side",
  "character.portrait.back",
  // ── New job types ──
  "pipeline.script2storyboard",
  "shot.multi_camera_grid",
  "image.predict_motion",
  "image.split_grid",
  "pipeline.story_push",
  "audio.generate",
  // ── ViMax agent bridge job types (full agent surface) ──
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

export type CanvasJobType = (typeof CANVAS_JOB_TYPES)[number];

/** All job types across the platform — canvas jobs + image jobs. */
export const ALL_JOB_TYPES = [
  "image.t2i",
  "image.i2i",
  ...CANVAS_JOB_TYPES,
] as const;

// ── Queue assignment ───────────────────────────────────────────────

export const CANVAS_QUEUES = {
  "image.t2i": "q.image.std",
  "image.i2i": "q.image.std",
  "shot.first_frame": "q.image.refine",
  "shot.last_frame": "q.image.refine",
  "shot.video": "q.video.std",
  "pipeline.idea2video": "q.pipeline.full",
  "pipeline.script2video": "q.pipeline.full",
  "character.portrait.side": "q.image.refine",
  "character.portrait.back": "q.image.refine",
  // ── New queue assignments ──
  "pipeline.script2storyboard": "q.pipeline.full",
  "shot.multi_camera_grid": "q.image.refine",
  "image.predict_motion": "q.image.refine",
  "image.split_grid": "q.image.std",
  "pipeline.story_push": "q.pipeline.full",
  "audio.generate": "q.audio.std",
  // ── ViMax agent bridges all run on the pipeline worker ──
  "pipeline.idea2script": "q.pipeline.full",
  "pipeline.script2characters": "q.pipeline.full",
  "pipeline.plan_script": "q.pipeline.full",
  "pipeline.enhance_script": "q.pipeline.full",
  "pipeline.novel2scenes": "q.pipeline.full",
  "pipeline.select_reference": "q.pipeline.full",
  "pipeline.select_best_image": "q.pipeline.full",
  "pipeline.camera_tree": "q.pipeline.full",
  "pipeline.character_portraits": "q.pipeline.full",
} as const satisfies Record<string, string>;

// ── Node Data Shapes (stored in canvas_nodes.data JSONB) ───────────

export interface ScriptNodeData {
  content: string;
}

export interface CharacterNodeData {
  name: string;
  description: string;
  frontAssetId?: string; // uploaded character front view asset
  sideAssetId?: string; // generated side view asset
  backAssetId?: string; // generated back view asset
}

export interface StoryboardCellNodeData {
  shotBrief: string;
  cameraIdx: number;
  /** Optional audio/dialogue cue carried over from the storyboard; forwarded
   * into the decomposed shot node. */
  audioDesc?: string;
}

export interface ShotNodeData {
  ffDesc: string;
  lfDesc: string;
  motionDesc: string;
  audioDesc: string;
  variationType: "large" | "medium" | "small";
  ffVisCharIdxs: number[];
  lfVisCharIdxs: number[];
  /** 折叠为首帧 prompt 的 "Avoid: ..." 从句（见 runShotNode）。 */
  negativePrompt?: string;
  /** 口播文案（广告镜头的台词）。TTS 以此合成配音；无则回退 audioDesc。 */
  voiceoverText?: string;
  /** 已合成的口播音频资产（audio.tts 完成后回填）。 */
  voiceoverAssetId?: string;
  /** IDs of character nodes whose portraits (front view) are fed as
   * references when generating this shot's first frame — drives cross-shot
   * character consistency (mirrors idea2video's ff_vis_char_idxs). */
  visibleCharIds?: string[];
  // ── Lighting control (电影级灯光控制) ──
  keyLightPosition?: string;
  keyLightIntensity?: number;   // 0-100
  rimLight?: string;
  ambientLight?: string;        // "warm" | "cool" | "neutral"
  // ── Focus / DOF (镜头聚焦) ──
  focusPoint?: { x: number; y: number }; // 0-1 normalized
  focusRadius?: number;          // 0-100
  bokehStrength?: number;        // 0-100
}

export interface ImageNodeData {
  prompt: string;
  negativePrompt?: string;
  modelId: string;
  size: string;
  seed?: number;
  /** Direct reference assets (in addition to upstream node outputs). */
  referenceAssetIds?: string[];
  /** E-commerce domain kind — drives icon, defaults and preset UI. */
  kind?: ImageNodeKind;
  /** Selected e-commerce aspect-ratio preset id (see ECOMMERCE_ASPECT_RATIOS). */
  aspectRatio?: string;
  /** Selected e-commerce scene preset id (see ECOMMERCE_SCENES). */
  scene?: string;
  // ── 编辑/后处理（image.edit / image.text / image.compliance）──
  /** 编辑操作：inpaint/outpaint 走模型（可带 mask），remove_bg/replace_bg 见 editOp。 */
  editOp?: "inpaint" | "outpaint" | "remove_bg" | "replace_bg";
  /** 编辑/压字/合规检查的输入图资产。 */
  sourceAssetId?: string;
  /** inpaint 遮罩资产（PNG，与 source 同尺寸）。 */
  maskAssetId?: string;
  /** 压在 sourceAssetId 上的文字图层（burn_text）。 */
  textLayers?: ImageTextLayer[];
  /** 平台合规预检目标（check_compliance）。 */
  compliancePlatforms?: string[];
  /** 合规检查结果（image.compliance 完成后回填，每平台一份）。 */
  complianceReports?: ComplianceReport[];
  /** 自动评估结果（evaluate 流水线回填）。 */
  evaluation?: ImageEvaluation;
  /** 自动 refine 已尝试次数（上限 1）。 */
  evaluateAttempt?: number;
}

/** 平台合规检查报告（worker compliance.py 产出）。 */
export interface ComplianceReport {
  platform: string;
  passed: boolean;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail?: string;
    manual_review?: boolean;
  }>;
}

/** 生图自动评估分（evaluate 流水线回填，四维 0-1）。 */
export interface ImageEvaluation {
  overall: number;
  dimensions: {
    fidelity: number;
    text: number;
    aesthetics: number;
    compliance: number;
  };
  critique?: string;
}

/**
 * Domain flavor of an image node. "generic" is the plain text-to-image node.
 * E-commerce kinds (product/scene/model/ad) and creative-asset kinds
 * (portrait/environment/character_design/prop) only differ in the style
 * fragment folded into the prompt at generation time.
 */
export type ImageNodeKind =
  | "generic"
  | "product"
  | "scene"
  | "model"
  | "ad"
  | "portrait"
  | "environment"
  | "character_design"
  | "prop";

// ── E-commerce presets ─────────────────────────────────────────────

export interface AspectRatioPreset {
  id: string;
  label: string;
  /** Pixel size passed to the model as `size`. */
  size: string;
}

export interface ScenePreset {
  id: string;
  label: string;
  /** Prompt fragment appended to describe the scene/background. */
  prompt: string;
}

/** Common e-commerce aspect ratios (主图 / 详情 / Banner / 信息流). */
export const ECOMMERCE_ASPECT_RATIOS: readonly AspectRatioPreset[] = [
  { id: "sq-1-1", label: "主图 1:1", size: "1024x1024" },
  { id: "pt-3-4", label: "详情 3:4", size: "1024x1536" },
  { id: "ls-4-3", label: "横版 4:3", size: "1536x1152" },
  { id: "bn-16-9", label: "Banner 16:9", size: "1536x864" },
  { id: "fv-9-16", label: "信息流 9:16", size: "864x1536" },
];

/** Scene/background presets for product photography. */
export const ECOMMERCE_SCENES: readonly ScenePreset[] = [
  { id: "studio", label: "棚拍纯色背景", prompt: "professional studio photography, clean seamless background, soft even lighting, high-end product shot" },
  { id: "clean-white", label: "纯白电商底", prompt: "pure white background, bright e-commerce product photo, crisp shadows, centered composition" },
  { id: "home", label: "家居场景", prompt: "placed in a cozy modern home interior, natural window light, lifestyle product photography" },
  { id: "outdoor", label: "户外自然", prompt: "outdoor natural setting, golden hour sunlight, fresh and vibrant, lifestyle product photography" },
  { id: "beach", label: "海滩度假", prompt: "on a sunny beach, golden sand and ocean bokeh, summer lifestyle product photography" },
  { id: "minimal", label: "极简几何", prompt: "minimalist geometric set, pastel tones, soft studio shadows, modern product photography" },
];

/** Style preset per creative-asset image kind (人物/场景/角色/道具素材). */
export interface ImageKindPreset {
  kind: ImageNodeKind;
  label: string;
  /** Style fragment appended to the user prompt at generation time. */
  prompt: string;
  /** Suggested size applied when the kind is picked. */
  size: string;
}

export const IMAGE_KIND_PRESETS: readonly ImageKindPreset[] = [
  {
    kind: "portrait",
    label: "人物形象",
    prompt: "photorealistic portrait of a person, expressive face, professional photography lighting, shallow depth of field, high detail",
    size: "1024x1536",
  },
  {
    kind: "environment",
    label: "场景概念",
    prompt: "cinematic environment concept art, atmospheric depth, production design, wide composition, film grade",
    size: "1600x900",
  },
  {
    kind: "character_design",
    label: "角色设定",
    prompt: "character design reference sheet, full body front view, plain clean background, consistent character design, high detail",
    size: "1536x1152",
  },
  {
    kind: "prop",
    label: "道具素材",
    prompt: "single prop asset, centered on a plain clean background, studio lighting, crisp detail",
    size: "1024x1024",
  },
];

export function getImageKindPreset(kind: string | undefined): ImageKindPreset | undefined {
  return IMAGE_KIND_PRESETS.find((p) => p.kind === kind);
}

export function getAspectRatioPreset(id: string | undefined): AspectRatioPreset | undefined {
  return ECOMMERCE_ASPECT_RATIOS.find((p) => p.id === id);
}

export function getScenePreset(id: string | undefined): ScenePreset | undefined {
  return ECOMMERCE_SCENES.find((p) => p.id === id);
}

/**
 * The prompt actually sent to the model: the user prompt plus the kind's
 * style fragment and the scene preset fragment (if any), with the negative
 * words folded in as a trailing "Avoid: ..." clause (mirrors
 * composeVideoPrompt — provider APIs take negatives as prompt text).
 * Used for both generation and the cache key so different kind/scene/negative
 * combinations never collapse onto one cached result.
 */
export function composeImagePrompt(
  prompt: string,
  sceneId?: string,
  kind?: string,
  negativePrompt?: string,
): string {
  const base = prompt.trim();
  const kindPreset = getImageKindPreset(kind);
  const scene = getScenePreset(sceneId);
  const parts = [base, kindPreset?.prompt, scene?.prompt];
  if (negativePrompt?.trim()) parts.push(`Avoid: ${negativePrompt.trim()}`);
  return parts.filter(Boolean).join(", ");
}

export interface VideoNodeData {
  motionPreset: string;
  durationSec: number;
  modelId: string;
  /** Optional generation params surfaced by the video console. */
  aspectRatio?: string;      // VIDEO_ASPECT_RATIOS preset id
  fps?: number;              // 16 | 24
  negativePrompt?: string;
  stylePresetId?: string;    // VIDEO_STYLE_PRESETS preset id
}

export interface ConcatNodeData {
  transition: string;
  /** Ordered list of upstream video node IDs (optional — defaults to edge order). */
  clipOrder?: string[];
}

/** Discriminated union of all node data shapes. */
export type CanvasNodeData =
  | { type: "script"; data: ScriptNodeData }
  | { type: "character"; data: CharacterNodeData }
  | { type: "storyboard_cell"; data: StoryboardCellNodeData }
  | { type: "shot"; data: ShotNodeData }
  | { type: "image"; data: ImageNodeData }
  | { type: "video"; data: VideoNodeData }
  | { type: "concat"; data: ConcatNodeData };

// ── Canvas, Node, Edge domain objects ──────────────────────────────

export interface CanvasNode {
  id: string; // uuid — client-assigned
  canvasId: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>; // validated per type on run
  outputAssetId?: string | null;
  status: CanvasNodeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasEdge {
  id: string; // uuid — client-assigned
  canvasId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null; // e.g. "output", "first_frame"
  targetHandle?: string | null; // e.g. "reference", "input"
  createdAt: string;
}

export interface Canvas {
  id: string;
  tenantId: string;
  name: string;
  viewport: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt: string;
}

export interface CanvasSnapshot {
  canvas: Canvas;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

// ── Runnable node types (shared web/api execution contract) ────────

/**
 * Node types that produce an output asset when run. Must mirror the
 * `switch` in `runNode` (node-executor.service.ts): nodes outside this set
 * (e.g. `script`, `storyboard_cell`) never run, so an edge from them is a
 * logical grouping — not a data dependency.
 */
export const RUNNABLE_NODE_TYPES = [

  "image",
  "character",
  "shot",
  "video",
  "concat",
  "audio",
] as const;

export type RunnableNodeType = (typeof RUNNABLE_NODE_TYPES)[number];

export const RUNNABLE_NODE_TYPE_SET: ReadonlySet<string> = new Set(RUNNABLE_NODE_TYPES);

// ── Manual connection rules ────────────────────────────────────────

/**
 * Legal node-type pairs for manual connections: source type → the target
 * types its output can feed. Mirrors what the executors consume: image/shot
 * nodes use any upstream asset as an i2i reference, video consumes
 * first/last-frame bindings, concat requires video inputs, script/storyboard_cell
 * only organize downstream structure.
 */
export const VALID_CONNECTION_TARGETS: Record<CanvasNodeType, readonly CanvasNodeType[]> = {
  script: ["storyboard_cell", "character"],
  character: ["shot", "image"],
  storyboard_cell: ["shot"],
  shot: ["image", "shot", "video", "audio"],
  image: ["image", "shot", "video", "audio"],
  video: ["video", "concat", "audio"],
  concat: [],
  audio: [],
};

export function isValidConnectionType(sourceType: string, targetType: string): boolean {
  return (
    VALID_CONNECTION_TARGETS[sourceType as CanvasNodeType]?.includes(
      targetType as CanvasNodeType,
    ) ?? false
  );
}

// ── Node → upstream dependency mapping (for DAG execution) ─────────

/** Maps a target handle to the upstream node's output. */
export interface NodeUpstream {
  /** The source node. */
  nodeId: string;
  nodeType: CanvasNodeType;
  outputAssetId: string | null;
  /** Which handle on the target this feeds into. */
  targetHandle: string;
  /** Which handle on the source this comes from. */
  sourceHandle: string;
}

// ── Lighting constants ─────────────────────────────────────────────

export const KEY_LIGHT_POSITIONS = [
  { id: "front-center", label: "正面中央" },
  { id: "front-left-30", label: "前左30度" },
  { id: "front-left-45", label: "前左45度" },
  { id: "front-left-60", label: "前左60度" },
  { id: "front-right-30", label: "前右30度" },
  { id: "front-right-45", label: "前右45度" },
  { id: "front-right-60", label: "前右60度" },
  { id: "side-left-90", label: "左侧90度" },
  { id: "side-right-90", label: "右侧90度" },
  { id: "back-left-120", label: "后左120度" },
  { id: "back-left-135", label: "后左135度" },
  { id: "back-left-150", label: "后左150度" },
  { id: "back-right-120", label: "后右120度" },
  { id: "back-right-135", label: "后右135度" },
  { id: "back-right-150", label: "后右150度" },
  { id: "back-center", label: "正后方" },
  { id: "top-center", label: "顶部中央" },
  { id: "top-front-45", label: "顶前45度" },
  { id: "top-back-45", label: "顶后45度" },
  { id: "top-left", label: "顶左" },
  { id: "top-right", label: "顶右" },
  { id: "bottom-front", label: "底前45度 (鬼光)" },
  { id: "bottom-left", label: "底左" },
  { id: "bottom-right", label: "底右" },
] as const;

export const RIM_LIGHT_PRESETS = [
  { id: "none", label: "无轮廓光" },
  { id: "warm-backlight", label: "暖色逆光" },
  { id: "cool-backlight", label: "冷色逆光" },
  { id: "warm-side-left", label: "暖色左侧光" },
  { id: "warm-side-right", label: "暖色右侧光" },
  { id: "cool-side-left", label: "冷色左侧光" },
  { id: "cool-side-right", label: "冷色右侧光" },
  { id: "rim-hair", label: "发丝光" },
  { id: "double-rim", label: "双侧轮廓光" },
] as const;

export const AMBIENT_LIGHT_OPTIONS = [
  { id: "neutral", label: "中性" },
  { id: "warm", label: "暖色" },
  { id: "cool", label: "冷色" },
  { id: "golden-hour", label: "黄金时刻" },
  { id: "blue-hour", label: "蓝调时刻" },
  { id: "overcast", label: "阴天漫射" },
] as const;

// ── Pipeline result types ──────────────────────────────────────────

export interface Script2StoryboardCell {
  shotBrief: string;
  cameraIdx: number;
  ffDesc: string;
  lfDesc: string;
  motionDesc: string;
  audioDesc?: string;
  shotIdx?: number;
}

export interface Script2StoryboardResult {
  cells: Script2StoryboardCell[];
}

// ── Workflow templates ─────────────────────────────────────────────

export type TemplateCategory = "ecommerce" | "short-drama" | "ad" | "general";

/** A node produced by instantiating a template (client-facing shape). */
export interface InstantiatedNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

/** An edge produced by instantiating a template (client-facing shape). */
export interface InstantiatedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Template metadata for the picker — omits the graph payload. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  nodeCount: number;
}

/** One generated variant of an image node, gathered in a gallery. */
export interface VariantEntry {
  assetId: string;
  jobId: string;
  index: number;
}
